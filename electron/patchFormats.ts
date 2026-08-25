import { crc32 } from "node:zlib";

/**
 * Pure decoders for the four patch containers PlayStation-era translations are
 * actually distributed in. They take buffers and return buffers: nothing here
 * touches the filesystem, so every format is testable against a round trip.
 *
 * The distinction that matters downstream is not the format but whether a patch
 * can *prove* it was built against the disc image it is being applied to. BPS
 * and UPS carry a CRC32 of their own source and target, so a wrong image is
 * rejected by the patch itself. IPS and PPF carry no such thing — PPF2/PPF3 can
 * optionally embed a 1 KiB sample of the original image, which is a real check
 * but a weak one, and PPF1 and IPS offer nothing at all. `verification` reports
 * which of those happened so the caller can refuse to write an unproven image
 * rather than silently producing a corrupt one.
 */
export type PatchFormat = "ips" | "ups" | "bps" | "ppf";
export type PatchVerification = "source-and-target-crc" | "source-sample" | "none";
export type PatchApplication = {
  output: Buffer;
  format: PatchFormat;
  verification: PatchVerification;
};

export class PatchError extends Error {}

const IPS_MAGIC = "PATCH";
const IPS_EOF = "EOF";
const PPF_BLOCK_CHECK_OFFSET = 0x9320;
const PPF_BLOCK_CHECK_LENGTH = 1024;
const PPF_DESCRIPTION_END = 0x38;
const FILE_ID_DIZ = Buffer.from("@BEGIN_FILE_ID.DIZ", "ascii");

const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

export const crc32of = (data: Buffer) => crc32(data) >>> 0;

export const detectPatchFormat = (patch: Buffer): PatchFormat | null => {
  if (patch.length >= 5 && patch.subarray(0, 5).toString("ascii") === IPS_MAGIC) return "ips";
  if (patch.length >= 4 && patch.subarray(0, 4).toString("ascii") === "UPS1") return "ups";
  if (patch.length >= 4 && patch.subarray(0, 4).toString("ascii") === "BPS1") return "bps";
  if (patch.length >= 5 && patch.subarray(0, 3).toString("ascii") === "PPF") return "ppf";
  return null;
};

/**
 * BPS and UPS share a variable-length integer whose continuation bit is the
 * high bit of each octet. Every group after the first is biased by the range
 * the shorter encodings already covered, so no value has two representations.
 * Multiplication rather than `<<` because a PlayStation image is larger than a
 * 32-bit shift can address.
 */
const createReader = (patch: Buffer) => {
  let at = 0;
  const need = (count: number) => {
    if (at + count > patch.length) throw new PatchError("The patch file ends mid-record and is truncated or corrupt.");
  };
  return {
    get position() { return at; },
    set position(value: number) { at = value; },
    byte() { need(1); return patch[at++]; },
    bytes(count: number) { need(count); const slice = patch.subarray(at, at + count); at += count; return slice; },
    vli() {
      let value = 0;
      let shift = 1;
      for (;;) {
        const octet = this.byte();
        value += (octet & 0x7f) * shift;
        if (octet & 0x80) return value;
        shift *= 128;
        value += shift;
      }
    },
  };
};

const applyIps = (source: Buffer, patch: Buffer): PatchApplication => {
  const reader = createReader(patch);
  reader.bytes(IPS_MAGIC.length);
  const chunks: { at: number; data: Buffer }[] = [];
  let truncate: number | undefined;
  for (;;) {
    const marker = reader.bytes(3);
    if (marker.toString("ascii") === IPS_EOF) {
      // An optional three-byte length after EOF shrinks the output.
      if (reader.position + 3 <= patch.length) truncate = reader.bytes(3).readUIntBE(0, 3);
      break;
    }
    const at = marker.readUIntBE(0, 3);
    const size = reader.bytes(2).readUInt16BE(0);
    if (size === 0) {
      const runLength = reader.bytes(2).readUInt16BE(0);
      chunks.push({ at, data: Buffer.alloc(runLength, reader.byte()) });
    } else {
      chunks.push({ at, data: Buffer.from(reader.bytes(size)) });
    }
  }
  const end = chunks.reduce((longest, chunk) => Math.max(longest, chunk.at + chunk.data.length), source.length);
  const output = Buffer.alloc(end);
  source.copy(output);
  for (const chunk of chunks) chunk.data.copy(output, chunk.at);
  return {
    output: truncate === undefined ? output : output.subarray(0, truncate),
    format: "ips",
    verification: "none",
  };
};

const applyUps = (source: Buffer, patch: Buffer): PatchApplication => {
  if (patch.length < 4 + 12) throw new PatchError("The UPS patch is too short to contain a checksum trailer.");
  const body = patch.length - 12;
  const expectedSource = patch.readUInt32LE(body);
  const expectedTarget = patch.readUInt32LE(body + 4);
  const expectedPatch = patch.readUInt32LE(body + 8);
  const actualPatch = crc32of(patch.subarray(0, body + 8));
  if (actualPatch !== expectedPatch)
    throw new PatchError(`The UPS patch file is corrupt: its own checksum is ${hex(actualPatch)}, not ${hex(expectedPatch)}.`);

  const actualSource = crc32of(source);
  if (actualSource !== expectedSource)
    throw new PatchError(
      `This patch was built for a different disc image. It expects source CRC32 ${hex(expectedSource)}; this file is ${hex(actualSource)}.`,
    );

  const reader = createReader(patch);
  reader.bytes(4);
  const sourceSize = reader.vli();
  const targetSize = reader.vli();
  if (sourceSize !== source.length)
    throw new PatchError(`This patch expects a ${sourceSize}-byte source image; this file is ${source.length} bytes.`);

  const output = Buffer.alloc(targetSize);
  source.copy(output, 0, 0, Math.min(source.length, targetSize));
  let at = 0;
  while (reader.position < body) {
    at += reader.vli();
    for (;;) {
      const octet = reader.byte();
      if (at < targetSize) output[at] ^= octet;
      at += 1;
      if (octet === 0) break;
    }
  }

  const actualTarget = crc32of(output);
  if (actualTarget !== expectedTarget)
    throw new PatchError(
      `The patched image does not match what the patch says it should produce (${hex(actualTarget)} instead of ${hex(expectedTarget)}).`,
    );
  return { output, format: "ups", verification: "source-and-target-crc" };
};

const applyBps = (source: Buffer, patch: Buffer): PatchApplication => {
  if (patch.length < 4 + 12) throw new PatchError("The BPS patch is too short to contain a checksum trailer.");
  const body = patch.length - 12;
  const expectedSource = patch.readUInt32LE(body);
  const expectedTarget = patch.readUInt32LE(body + 4);
  const expectedPatch = patch.readUInt32LE(body + 8);
  const actualPatch = crc32of(patch.subarray(0, body + 8));
  if (actualPatch !== expectedPatch)
    throw new PatchError(`The BPS patch file is corrupt: its own checksum is ${hex(actualPatch)}, not ${hex(expectedPatch)}.`);

  const actualSource = crc32of(source);
  if (actualSource !== expectedSource)
    throw new PatchError(
      `This patch was built for a different disc image. It expects source CRC32 ${hex(expectedSource)}; this file is ${hex(actualSource)}.`,
    );

  const reader = createReader(patch);
  reader.bytes(4);
  const sourceSize = reader.vli();
  const targetSize = reader.vli();
  reader.bytes(reader.vli()); // metadata, unused
  if (sourceSize !== source.length)
    throw new PatchError(`This patch expects a ${sourceSize}-byte source image; this file is ${source.length} bytes.`);

  const output = Buffer.alloc(targetSize);
  let outputAt = 0;
  let sourceAt = 0;
  let targetAt = 0;
  while (reader.position < body) {
    const action = reader.vli();
    const command = action % 4;
    const length = Math.floor(action / 4) + 1;
    if (outputAt + length > targetSize) throw new PatchError("The BPS patch writes past the end of its declared output.");
    if (command === 0) {
      source.copy(output, outputAt, outputAt, outputAt + length);
      outputAt += length;
    } else if (command === 1) {
      reader.bytes(length).copy(output, outputAt);
      outputAt += length;
    } else {
      const delta = reader.vli();
      const step = (delta % 2 ? -1 : 1) * Math.floor(delta / 2);
      if (command === 2) {
        sourceAt += step;
        source.copy(output, outputAt, sourceAt, sourceAt + length);
        outputAt += length;
        sourceAt += length;
      } else {
        targetAt += step;
        // Byte at a time: a TargetCopy run is allowed to overlap itself, which
        // is how BPS encodes a repeat, so a bulk copy would read stale bytes.
        for (let index = 0; index < length; index += 1) output[outputAt++] = output[targetAt++];
      }
    }
  }

  const actualTarget = crc32of(output);
  if (actualTarget !== expectedTarget)
    throw new PatchError(
      `The patched image does not match what the patch says it should produce (${hex(actualTarget)} instead of ${hex(expectedTarget)}).`,
    );
  return { output, format: "bps", verification: "source-and-target-crc" };
};

/**
 * A PPF may carry a FILE_ID.DIZ release note after its patch records. The
 * marker is eighteen ASCII bytes, so finding it inside binary patch data is
 * vanishingly unlikely, and the cost of being wrong is a truncated patch that
 * fails its output check rather than a silently corrupt image.
 */
const ppfRecordEnd = (patch: Buffer, from: number) => {
  const marker = patch.lastIndexOf(FILE_ID_DIZ);
  return marker >= from ? marker : patch.length;
};

const applyPpf = (source: Buffer, patch: Buffer): PatchApplication => {
  const version = patch[5];
  if (version > 2) throw new PatchError(`Unsupported PPF encoding version ${version + 1}.`);
  const reader = createReader(patch);
  const output = Buffer.from(source);
  let verification: PatchVerification = "none";
  let blockCheck: Buffer | undefined;
  let undoData = false;

  if (version === 0) {
    reader.position = PPF_DESCRIPTION_END;
  } else if (version === 1) {
    reader.position = PPF_DESCRIPTION_END;
    const originalSize = reader.bytes(4).readUInt32LE(0);
    if (originalSize !== source.length)
      throw new PatchError(`This patch expects a ${originalSize}-byte source image; this file is ${source.length} bytes.`);
    blockCheck = Buffer.from(reader.bytes(PPF_BLOCK_CHECK_LENGTH));
  } else {
    reader.position = PPF_DESCRIPTION_END;
    reader.byte(); // image type
    const hasBlockCheck = reader.byte() === 1;
    undoData = reader.byte() === 1;
    reader.byte(); // dummy
    if (hasBlockCheck) blockCheck = Buffer.from(reader.bytes(PPF_BLOCK_CHECK_LENGTH));
  }

  if (blockCheck) {
    const sample = source.subarray(PPF_BLOCK_CHECK_OFFSET, PPF_BLOCK_CHECK_OFFSET + PPF_BLOCK_CHECK_LENGTH);
    if (!sample.equals(blockCheck))
      throw new PatchError("This patch was built for a different disc image: its block check does not match this file.");
    verification = "source-sample";
  }

  const end = ppfRecordEnd(patch, reader.position);
  while (reader.position < end) {
    const at = version === 2 ? Number(reader.bytes(8).readBigUInt64LE(0)) : reader.bytes(4).readUInt32LE(0);
    const size = reader.byte();
    const data = reader.bytes(size);
    if (undoData) reader.bytes(size);
    if (at + size > output.length)
      throw new PatchError("This patch writes past the end of the image, so it does not belong to this file.");
    data.copy(output, at);
  }
  return { output, format: "ppf", verification };
};

export const applyPatch = (source: Buffer, patch: Buffer): PatchApplication => {
  const format = detectPatchFormat(patch);
  if (!format) throw new PatchError("Unrecognized patch file. GameStore applies IPS, UPS, BPS and PPF patches.");
  if (format === "ips") return applyIps(source, patch);
  if (format === "ups") return applyUps(source, patch);
  if (format === "bps") return applyBps(source, patch);
  return applyPpf(source, patch);
};

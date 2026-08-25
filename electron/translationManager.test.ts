import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { crc32of } from "./patchFormats";
import {
  applyTranslation,
  readProvenance,
  retargetCueSheet,
  TranslationRefused,
  TranslationTarget,
} from "./translationManager";

const sha1 = (data: Buffer) => createHash("sha1").update(data).digest("hex");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const u32le = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const vli = (value: number) => {
  const out: number[] = [];
  for (;;) {
    const septet = value % 128;
    value = Math.floor(value / 128);
    if (value === 0) { out.push(0x80 | septet); break; }
    out.push(septet);
    value -= 1;
  }
  return Buffer.from(out);
};

/** A disc image stand-in: real content, small enough to hash in a test. */
const image = () => Buffer.from("SOURCE IMAGE CONTENT, ORIGINAL JAPANESE TEXT", "ascii");
const CANONICAL = "Harmful Park (Japan).bin";

/** PPF1: no size field, no block check, no checksum of anything. */
const ppf1 = (at: number, data: string) =>
  Buffer.concat([
    Buffer.from("PPF10", "ascii"),
    Buffer.from([0x00]),
    Buffer.alloc(50, 0x20),
    u32le(at),
    Buffer.from([data.length]),
    Buffer.from(data, "ascii"),
  ]);

const bps = (source: Buffer, target: Buffer) => {
  const action = (command: number, length: number) => vli((length - 1) * 4 + command);
  const head = Buffer.concat([
    Buffer.from("BPS1", "ascii"),
    vli(source.length),
    vli(target.length),
    vli(0),
    action(1, target.length),
    target,
    u32le(crc32of(source)),
    u32le(crc32of(target)),
  ]);
  return Buffer.concat([head, u32le(crc32of(head))]);
};

describe("translation manager", () => {
  let root = "";
  let sourcePath = "";
  let patchPath = "";
  let destination = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "gamestore-translation-"));
    destination = path.join(root, "Games", "PSX", "Harmful Park (English)");
    sourcePath = path.join(root, "Harmful Park (Japan).bin");
    patchPath = path.join(root, "harmful-park-english.ppf");
    await fs.writeFile(sourcePath, image());
    await fs.writeFile(patchPath, ppf1(0, "ENGLISH"));
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const targetFor = (data: Buffer): TranslationTarget => ({
    release: "Harmful Park (Japan)",
    serial: "SLPS-00498",
    size: data.length,
    crc32: crc32of(data).toString(16),
    sha1: sha1(data),
  });
  const request = (overrides: Partial<Parameters<typeof applyTranslation>[1]> = {}) => ({
    gameId: "harmful-park",
    sourcePath,
    patchPath,
    destinationDirectory: destination,
    outputName: CANONICAL,
    team: "LIPEMCO! Translations",
    ...overrides,
  });

  /**
   * The PPF and IPS containers PlayStation translations ship as carry no
   * checksum of the disc they were built from. Without a manifest release to
   * check against there is nothing to verify, and a patch applied to the wrong
   * image produces a broken disc rather than an error, so this refuses.
   */
  it("refuses an unverifiable patch rather than producing an unproven image", async () => {
    await expect(applyTranslation(root, request())).rejects.toThrow(TranslationRefused);
    await expect(fs.readdir(destination)).rejects.toThrow();
  });

  /** Same length as the real dump, so only the hash can tell them apart. */
  it("refuses a source image that is not the release the patch targets", async () => {
    const target = targetFor(Buffer.from("A DIFFERENT DUMP ENTIRELY".padEnd(image().length, "!"), "ascii"));
    await expect(applyTranslation(root, request({ target }))).rejects.toThrow(/does not match/i);
    await expect(fs.readdir(destination)).rejects.toThrow();
  });

  it("refuses a source image of the wrong size before hashing it", async () => {
    const target = targetFor(Buffer.concat([image(), Buffer.from("EXTRA")]));
    await expect(applyTranslation(root, request({ target }))).rejects.toThrow(/bytes;.*is \d+/i);
    await expect(fs.readdir(destination)).rejects.toThrow();
  });

  it("refuses a patch file that is not the one recorded for the game", async () => {
    await expect(
      applyTranslation(root, request({ target: targetFor(image()), expectedPatchSha256: "0".repeat(64) })),
    ).rejects.toThrow(/not the one recorded/i);
  });

  it("writes a separate copy under the canonical name and leaves the source untouched", async () => {
    const before = await fs.readFile(sourcePath);
    const entry = await applyTranslation(root, request({ target: targetFor(image()) }));

    expect(await fs.readFile(sourcePath)).toEqual(before);
    const output = await fs.readFile(path.join(destination, CANONICAL));
    expect(output.subarray(0, 7).toString()).toBe("ENGLISH");
    expect(output.length).toBe(before.length);
    // The translated copy is marked by its folder and its provenance record,
    // never by a filename the artwork scraper would then fail to match.
    expect(entry.output.file).toBe(CANONICAL);
    expect(entry.verification).toBe("manifest-sha1");
    expect(entry.unverifiedSourceAccepted).toBe(false);
  });

  it("records what was applied to what, by hash", async () => {
    const source = image();
    await applyTranslation(root, request({ target: targetFor(source) }));
    const [entry] = await readProvenance(root);
    expect(entry.gameId).toBe("harmful-park");
    expect(entry.team).toBe("LIPEMCO! Translations");
    expect(entry.container).toBe("ppf");
    expect(entry.source.sha1).toBe(sha1(source));
    expect(entry.patch.sha256).toBe(sha256(ppf1(0, "ENGLISH")));
    expect(entry.output.sha1).toBe(sha1(await fs.readFile(path.join(destination, CANONICAL))));
    expect(entry.target?.serial).toBe("SLPS-00498");
  });

  /**
   * BPS and UPS embed a CRC32 of their own source, so they are self-verifying
   * and do not need a curated release to be applied safely.
   */
  it("accepts a self-verifying container with no manifest entry", async () => {
    const source = image();
    const translated = Buffer.from("TRANSLATED IMAGE CONTENT, ENGLISH TEXT HERE!", "ascii");
    await fs.writeFile(patchPath, bps(source, translated));
    const entry = await applyTranslation(root, request());
    expect(entry.verification).toBe("source-and-target-crc");
    expect(await fs.readFile(path.join(destination, CANONICAL))).toEqual(translated);
  });

  it("marks an explicitly overridden verification in the permanent record", async () => {
    const entry = await applyTranslation(root, request({ allowUnverifiedSource: true }));
    expect(entry.unverifiedSourceAccepted).toBe(true);
    expect(entry.verification).toBe("none");
  });

  it("refuses to write the translated copy over the source image", async () => {
    await expect(
      applyTranslation(root, request({
        target: targetFor(image()),
        destinationDirectory: path.dirname(sourcePath),
        outputName: path.basename(sourcePath),
      })),
    ).rejects.toThrow(/overwrite the source/i);
    expect(await fs.readFile(sourcePath)).toEqual(image());
  });

  it("copies a cue sheet beside the patched image", async () => {
    await fs.writeFile(
      sourcePath.replace(/\.bin$/, ".cue"),
      'FILE "Harmful Park (Japan).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n',
    );
    await applyTranslation(root, request({ target: targetFor(image()) }));
    const cue = await fs.readFile(path.join(destination, CANONICAL.replace(/\.bin$/, ".cue")), "utf8");
    expect(cue).toContain('FILE "Harmful Park (Japan).bin" BINARY');
  });

  it("retargets a cue sheet whose source file was named something else", () => {
    const cue = 'FILE "some-random-rip.bin" BINARY\n  TRACK 01 MODE2/2352\n';
    expect(retargetCueSheet(cue, "some-random-rip.bin", CANONICAL))
      .toContain(`FILE "${CANONICAL}" BINARY`);
    // A sheet naming a file this operation did not touch is left alone.
    expect(retargetCueSheet(cue, "unrelated.bin", CANONICAL)).toBe(cue);
  });
});

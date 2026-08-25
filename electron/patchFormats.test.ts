import { describe, expect, it } from "vitest";
import { crc32of, detectPatchFormat, applyPatch, PatchError } from "./patchFormats";

/**
 * Patch bytes here are laid out by hand from each format's specification rather
 * than produced by an encoder written next to the decoder, because a shared
 * misreading of a spec would pass a round trip built from both halves.
 */
const bytes = (...values: (number | string | Buffer)[]) =>
  Buffer.concat(values.map((value) =>
    typeof value === "number" ? Buffer.from([value])
      : typeof value === "string" ? Buffer.from(value, "ascii")
        : value));
const u16be = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
const u24be = (value: number) => { const b = Buffer.alloc(3); b.writeUIntBE(value, 0, 3); return b; };
const u32le = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const u64le = (value: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };

/** BPS/UPS variable-length integer, continuation bit high, later groups biased. */
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

const withChecksums = (body: Buffer, source: Buffer, target: Buffer) => {
  const head = Buffer.concat([body, u32le(crc32of(source)), u32le(crc32of(target))]);
  return Buffer.concat([head, u32le(crc32of(head))]);
};

describe("patch containers", () => {
  it("encodes the shared variable-length integer the way both specs describe", () => {
    expect([...vli(0)]).toEqual([0x80]);
    expect([...vli(127)]).toEqual([0xff]);
    expect([...vli(128)]).toEqual([0x00, 0x80]);
  });

  it("identifies each container by its magic", () => {
    expect(detectPatchFormat(bytes("PATCH"))).toBe("ips");
    expect(detectPatchFormat(bytes("UPS1"))).toBe("ups");
    expect(detectPatchFormat(bytes("BPS1"))).toBe("bps");
    expect(detectPatchFormat(bytes("PPF30", 2))).toBe("ppf");
    expect(detectPatchFormat(Buffer.from([0xd6, 0xc3, 0xc4, 0x00]))).toBe("xdelta");
    expect(detectPatchFormat(bytes("not a patch at all"))).toBeNull();
  });

  describe("IPS", () => {
    const source = Buffer.from("Hello, world!", "ascii");

    it("applies a literal record", () => {
      const patch = bytes("PATCH", u24be(7), u16be(5), "there", "EOF");
      expect(applyPatch(source, patch).output.toString()).toBe("Hello, there!");
    });

    it("expands a run-length record", () => {
      const patch = bytes("PATCH", u24be(0), u16be(0), u16be(3), 0x41, "EOF");
      expect(applyPatch(source, patch).output.toString()).toBe("AAAlo, world!");
    });

    it("honours the optional truncation length after EOF", () => {
      const patch = bytes("PATCH", u24be(0), u16be(1), "J", "EOF", u24be(5));
      expect(applyPatch(source, patch).output.toString()).toBe("Jello");
    });

    it("grows the image when a record writes past its end", () => {
      const patch = bytes("PATCH", u24be(13), u16be(3), "!!!", "EOF");
      expect(applyPatch(source, patch).output.toString()).toBe("Hello, world!!!!");
    });

    /**
     * IPS carries no checksum of any kind, so nothing about the container can
     * tell a caller it was handed the wrong disc. The caller has to decide.
     */
    it("reports that it proved nothing about the source", () => {
      const patch = bytes("PATCH", u24be(7), u16be(5), "there", "EOF");
      expect(applyPatch(source, patch).verification).toBe("none");
    });
  });

  describe("UPS", () => {
    const source = Buffer.from("Hello, world!", "ascii");
    const target = Buffer.from("Hello, there!", "ascii");
    // One hunk: skip to offset 7, XOR "world" into "there", terminate with 0.
    const xored = Buffer.from(
      Array.from({ length: 5 }, (_, index) => source[7 + index] ^ target[7 + index]),
    );
    const patch = withChecksums(
      bytes("UPS1", vli(source.length), vli(target.length), vli(7), xored, 0x00),
      source,
      target,
    );

    it("applies an XOR hunk and confirms both checksums", () => {
      const applied = applyPatch(source, patch);
      expect(applied.output.toString()).toBe("Hello, there!");
      expect(applied.verification).toBe("source-and-target-crc");
    });

    it("refuses a source image the patch was not built against", () => {
      expect(() => applyPatch(Buffer.from("Hello, WORLD!", "ascii"), patch))
        .toThrow(/built for a different disc image/i);
    });

    it("refuses a patch file whose own checksum does not hold", () => {
      const corrupt = Buffer.from(patch);
      corrupt[10] ^= 0xff;
      expect(() => applyPatch(source, corrupt)).toThrow(PatchError);
    });
  });

  describe("BPS", () => {
    const action = (command: number, length: number) => vli((length - 1) * 4 + command);

    it("replays SourceRead and TargetRead actions", () => {
      const source = Buffer.from("ABCDEFGH", "ascii");
      const target = Buffer.from("ABCXYZGH", "ascii");
      const patch = withChecksums(
        bytes(
          "BPS1", vli(source.length), vli(target.length), vli(0),
          action(0, 3),
          action(1, 3), "XYZ",
          action(0, 2),
        ),
        source,
        target,
      );
      const applied = applyPatch(source, patch);
      expect(applied.output.toString()).toBe("ABCXYZGH");
      expect(applied.verification).toBe("source-and-target-crc");
    });

    it("follows signed relative offsets in a SourceCopy", () => {
      const source = Buffer.from("ABCD", "ascii");
      const target = Buffer.from("CDAB", "ascii");
      const patch = withChecksums(
        bytes(
          "BPS1", vli(source.length), vli(target.length), vli(0),
          action(2, 2), vli(2 * 2),      // +2 -> read "CD"
          action(2, 2), vli(4 * 2 + 1),  // -4 -> read "AB"
        ),
        source,
        target,
      );
      expect(applyPatch(source, patch).output.toString()).toBe("CDAB");
    });

    /**
     * A TargetCopy run may read bytes the same run is still writing; that
     * self-overlap is how BPS encodes a repeat. Copying the range in bulk would
     * read the pre-run contents and silently produce the wrong image.
     */
    it("lets a TargetCopy run overlap itself to encode a repeat", () => {
      const source = Buffer.from("A", "ascii");
      const target = Buffer.from("AAAA", "ascii");
      const patch = withChecksums(
        bytes("BPS1", vli(source.length), vli(target.length), vli(0), action(0, 1), action(3, 3), vli(0)),
        source,
        target,
      );
      expect(applyPatch(source, patch).output.toString()).toBe("AAAA");
    });

    it("refuses a source image the patch was not built against", () => {
      const source = Buffer.from("ABCDEFGH", "ascii");
      const target = Buffer.from("ABCXYZGH", "ascii");
      const patch = withChecksums(
        bytes("BPS1", vli(source.length), vli(target.length), vli(0), action(0, 3), action(1, 3), "XYZ", action(0, 2)),
        source,
        target,
      );
      expect(() => applyPatch(Buffer.from("HGFEDCBA", "ascii"), patch))
        .toThrow(/built for a different disc image/i);
    });
  });

  describe("PPF", () => {
    const description = Buffer.alloc(50, 0x20);
    // The block check samples 1 KiB at 0x9320, so a fixture has to be a
    // plausible disc image rather than a few bytes.
    const image = () => {
      const buffer = Buffer.alloc(40000);
      for (let index = 0; index < buffer.length; index += 1) buffer[index] = (index * 7 + 11) & 0xff;
      return buffer;
    };
    const blockCheck = (source: Buffer) => source.subarray(0x9320, 0x9320 + 1024);

    it("applies PPF1 records, which prove nothing about the source", () => {
      const source = image();
      const patch = bytes("PPF10", 0x00, description, u32le(16), 3, "ENG");
      const applied = applyPatch(source, patch);
      expect(applied.output.subarray(16, 19).toString()).toBe("ENG");
      expect(applied.verification).toBe("none");
      expect(applied.output.length).toBe(source.length);
    });

    it("checks the PPF2 size and 1 KiB sample before writing", () => {
      const source = image();
      const patch = bytes("PPF20", 0x01, description, u32le(source.length), blockCheck(source), u32le(16), 3, "ENG");
      const applied = applyPatch(source, patch);
      expect(applied.output.subarray(16, 19).toString()).toBe("ENG");
      expect(applied.verification).toBe("source-sample");
    });

    it("refuses a PPF2 patch whose sample does not match the image", () => {
      const source = image();
      const other = image();
      other[0x9320] ^= 0xff;
      const patch = bytes("PPF20", 0x01, description, u32le(source.length), blockCheck(other), u32le(16), 3, "ENG");
      expect(() => applyPatch(source, patch)).toThrow(/block check does not match/i);
    });

    it("reads PPF3 64-bit offsets and skips interleaved undo data", () => {
      const source = image();
      const undo = source.subarray(16, 19);
      const patch = bytes(
        "PPF30", 0x02, description,
        0x00, 0x01, 0x01, 0x00,
        blockCheck(source),
        u64le(16), 3, "ENG", undo,
      );
      const applied = applyPatch(source, patch);
      expect(applied.output.subarray(16, 19).toString()).toBe("ENG");
      expect(applied.verification).toBe("source-sample");
    });

    it("ignores a FILE_ID.DIZ release note appended after the records", () => {
      const source = image();
      const patch = bytes(
        "PPF30", 0x02, description,
        0x00, 0x00, 0x00, 0x00,
        u64le(16), 3, "ENG",
        "@BEGIN_FILE_ID.DIZ", "Translation by a team", "@END_FILE_ID.DIZ", u32le(21),
      );
      const applied = applyPatch(source, patch);
      expect(applied.output.subarray(16, 19).toString()).toBe("ENG");
      // A PPF3 without a block check cannot vouch for the image it was given.
      expect(applied.verification).toBe("none");
    });

    it("refuses a record that would write past the end of the image", () => {
      const source = image();
      const patch = bytes("PPF10", 0x00, description, u32le(source.length - 1), 3, "ENG");
      expect(() => applyPatch(source, patch)).toThrow(/past the end/i);
    });
  });
});

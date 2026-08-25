import { describe, expect, it } from "vitest";
import { decodeAnswers, encodeQuery, resolveMdns } from "./mdns";

/**
 * Packet bytes are written out from RFC 1035 rather than produced by feeding
 * the encoder into the decoder, because a shared misreading of the wire format
 * would pass a round trip built from both halves.
 */
const header = (answers: number, questions = 0) => {
  const buffer = Buffer.alloc(12);
  buffer.writeUInt16BE(0x8400, 2); // response, authoritative
  buffer.writeUInt16BE(questions, 4);
  buffer.writeUInt16BE(answers, 6);
  return buffer;
};
const labels = (name: string) =>
  Buffer.concat([
    ...name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, "ascii")])),
    Buffer.from([0]),
  ]);
const aRecord = (name: Buffer, address: number[]) => {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(1, 0); // TYPE A
  fixed.writeUInt16BE(1, 2); // CLASS IN
  fixed.writeUInt32BE(120, 4);
  fixed.writeUInt16BE(4, 8);
  return Buffer.concat([name, fixed, Buffer.from(address)]);
};

describe("mDNS", () => {
  it("encodes a query as length-prefixed labels asking for a unicast reply", () => {
    const query = encodeQuery("MiSTer.local", 0);
    expect([...query.subarray(0, 12)]).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect([...query.subarray(12, 19)]).toEqual([6, 0x4d, 0x69, 0x53, 0x54, 0x65, 0x72]); // "MiSTer"
    expect([...query.subarray(19, 26)]).toEqual([5, 0x6c, 0x6f, 0x63, 0x61, 0x6c, 0]); // "local"
    expect(query.readUInt16BE(26)).toBe(1); // TYPE A
    // Top bit of QCLASS is the unicast-response request that lets this run on
    // an ephemeral port instead of fighting avahi for 5353.
    expect(query.readUInt16BE(28)).toBe(0x8001);
  });

  it("rejects a label longer than the wire format allows", () => {
    expect(() => encodeQuery(`${"m".repeat(64)}.local`)).toThrow(/label too long/i);
  });

  it("reads an A record out of a response", () => {
    const packet = Buffer.concat([header(1), aRecord(labels("MiSTer.local"), [192, 168, 1, 42])]);
    expect(decodeAnswers(packet)).toEqual([{ name: "mister.local", address: "192.168.1.42" }]);
  });

  /**
   * Responders routinely compress the answer name into a pointer back at the
   * question. Following it wrong silently yields the wrong hostname, which
   * would attach a stranger's address to the configured device.
   */
  it("follows a compression pointer back to the question", () => {
    const question = Buffer.concat([labels("MiSTer.local"), Buffer.from([0, 1, 0, 1])]);
    const pointer = Buffer.from([0xc0, 12]); // offset 12 == start of the question
    const packet = Buffer.concat([header(1, 1), question, aRecord(pointer, [10, 0, 0, 7])]);
    expect(decodeAnswers(packet)).toEqual([{ name: "mister.local", address: "10.0.0.7" }]);
  });

  it("skips records that are not addresses and keeps reading past them", () => {
    const txt = Buffer.concat([labels("MiSTer.local"), Buffer.from([0, 16, 0, 1, 0, 0, 0, 120, 0, 3]), Buffer.from("abc")]);
    const packet = Buffer.concat([header(2), txt, aRecord(labels("MiSTer.local"), [10, 0, 0, 8])]);
    expect(decodeAnswers(packet)).toEqual([{ name: "mister.local", address: "10.0.0.8" }]);
  });

  it("returns nothing rather than throwing on a truncated or hostile packet", () => {
    expect(decodeAnswers(Buffer.alloc(0))).toEqual([]);
    expect(decodeAnswers(Buffer.concat([header(1), Buffer.from([3, 0x61])]))).toEqual([]);
    // A pointer to itself must terminate instead of spinning.
    const loop = Buffer.concat([header(1), Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, 1, 2, 3, 4])]);
    expect(() => decodeAnswers(loop)).not.toThrow();
  });

  /**
   * A machine with no route to the multicast group must produce an empty
   * result, not an error the caller has to special-case; discovery falls
   * through to the address sweep in that situation.
   */
  it("resolves to an empty map when nothing answers", async () => {
    await expect(resolveMdns(["definitely-not-a-real-host-9e3f.local"], 250)).resolves.toEqual(new Map());
  });
});

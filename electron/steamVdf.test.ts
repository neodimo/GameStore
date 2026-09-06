import { describe, expect, it } from "vitest";
import { crc32, decodeBinaryVdf, encodeBinaryVdf, shortcutAppId, shortcutRunGameId } from "./steamVdf";

/** Builds the byte-level shape Steam actually writes, without using our encoder. */
const handWritten = () => {
  const str = (key: string, value: string) =>
    Buffer.concat([Buffer.from([0x01]), Buffer.from(`${key}\0${value}\0`, "utf8")]);
  const int = (key: string, value: number) => {
    const body = Buffer.alloc(4);
    body.writeInt32LE(value > 0x7fffffff ? value - 0x100000000 : value);
    return Buffer.concat([Buffer.from([0x02]), Buffer.from(`${key}\0`, "utf8"), body]);
  };
  return Buffer.concat([
    Buffer.from([0x00]), Buffer.from("shortcuts\0", "utf8"),
    Buffer.from([0x00]), Buffer.from("0\0", "utf8"),
    int("appid", 0x91a0f0ea),
    str("AppName", "Kodi"),
    str("Exe", '"/usr/bin/kodi"'),
    Buffer.from([0x00]), Buffer.from("tags\0", "utf8"),
    str("0", "Media"),
    Buffer.from([0x08]),
    Buffer.from([0x08]),
    Buffer.from([0x08]),
    Buffer.from([0x08]),
  ]);
};

describe("Steam binary VDF", () => {
  it("decodes the byte shape Steam writes, including nested tags and a high-bit appid", () => {
    const { name, value } = decodeBinaryVdf(handWritten());
    expect(name).toBe("shortcuts");
    const entry = value["0"] as Record<string, unknown>;
    expect(entry.AppName).toBe("Kodi");
    expect(entry.Exe).toBe('"/usr/bin/kodi"');
    expect((entry.appid as number) >>> 0).toBe(0x91a0f0ea);
    expect(entry.tags).toEqual({ "0": "Media" });
  });

  it("re-encodes a decoded file byte-for-byte", () => {
    const original = handWritten();
    const { name, value } = decodeBinaryVdf(original);
    expect(encodeBinaryVdf(name, value)).toEqual(original);
  });

  it("preserves unknown keys belonging to somebody else's shortcut", () => {
    const source = encodeBinaryVdf("shortcuts", {
      "0": { AppName: "Theirs", SomeFutureSteamField: "keep me", OpenVR: 0 },
    });
    const { value } = decodeBinaryVdf(source);
    const entry = value["0"] as Record<string, unknown>;
    entry.LaunchOptions = "added";
    const round = decodeBinaryVdf(encodeBinaryVdf("shortcuts", value)).value["0"] as Record<string, unknown>;
    expect(round.SomeFutureSteamField).toBe("keep me");
    expect(round.LaunchOptions).toBe("added");
  });

  it("matches the published CRC-32 check value", () => {
    expect(crc32("123456789")).toBe(0xcbf43926);
  });

  it("derives the documented app id for a known exe and name", () => {
    // Community-documented pair: quoted "/usr/bin/kodi" + Kodi -> 2443196458.
    expect(shortcutAppId('"/usr/bin/kodi"', "Kodi")).toBe(2443196458);
  });

  it("keeps the quotes significant, because unquoted input yields a different id", () => {
    expect(shortcutAppId("/usr/bin/kodi", "Kodi")).not.toBe(shortcutAppId('"/usr/bin/kodi"', "Kodi"));
  });

  it("builds the 64-bit rungameid from the shortcut app id", () => {
    expect(shortcutRunGameId(2443196458)).toBe("10493448884846592000");
  });

  it("refuses a truncated file instead of returning half a library", () => {
    expect(() => decodeBinaryVdf(handWritten().subarray(0, 20))).toThrow(/not closed|unterminated/i);
  });
});

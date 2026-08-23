import { describe, expect, it } from "vitest";
import { matchCollectionFiles, torrentFiles } from "./collectionIndex";

const b = (value: unknown): Buffer => {
  if (typeof value === "number") return Buffer.from(`i${value}e`);
  if (typeof value === "string") return Buffer.concat([Buffer.from(`${Buffer.byteLength(value)}:`), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(b), Buffer.from("e")]);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [z]) => a.localeCompare(z));
  return Buffer.concat([Buffer.from("d"), ...entries.flatMap(([key, item]) => [b(key), b(item)]), Buffer.from("e")]);
};

describe("collection torrent index", () => {
  const torrent = b({ info: { name: "PS1", files: [
    { length: 111, path: ["Incredible Crisis (USA).zip"] },
    { length: 222, path: ["Dino Crisis (USA).zip"] },
    { length: 333, path: ["Incredible Crisis (Europe).zip"] },
  ] } });
  it("decodes multi-file torrent metadata without downloading payloads", () => {
    expect(torrentFiles(torrent)).toHaveLength(3);
    expect(torrentFiles(torrent)[0]).toEqual({ path: "Incredible Crisis (USA).zip", bytes: 111, index: 0 });
  });
  it("ranks the exact regional release above similarly named games", () => {
    const matches = matchCollectionFiles(torrentFiles(torrent), "Incredible Crisis", "USA");
    expect(matches[0].path).toBe("Incredible Crisis (USA).zip");
    expect(matches.some((item) => item.path.startsWith("Dino Crisis"))).toBe(false);
  });
});

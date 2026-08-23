import { afterAll, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  matchCollectionFiles,
  readCollectionManifest,
  releaseVariant,
  removeCollectionManifest,
  torrentFiles,
} from "./collectionIndex";

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

  /**
   * Add to Cart is meant to be one decision. Ranking alone still showed every
   * printing of a game and made the user adjudicate No-Intro tags.
   */
  it("offers only the releases worth choosing between", () => {
    const matches = matchCollectionFiles(torrentFiles(torrent), "Incredible Crisis", "USA");
    expect(matches.map((item) => item.path)).toEqual(["Incredible Crisis (USA).zip"]);
  });

  it("keeps an English translation of an import alongside the region", () => {
    const imports = b({ info: { name: "PS1", files: [
      { length: 1, path: ["Kowloon's Gate (Japan).zip"] },
      { length: 2, path: ["Kowloon's Gate (Japan) [T-En by Team].zip"] },
      { length: 3, path: ["Kowloon's Gate (Japan) (Demo).zip"] },
    ] } });
    const matches = matchCollectionFiles(torrentFiles(imports), "Kowloon's Gate", "Japan");
    const labels = matches.map((item) => item.variant.label);
    expect(labels).toContain("Japan");
    expect(labels).toContain("Japan (English translation)");
  });

  /** A game with no release in its own region must not return an empty picker. */
  it("falls back to every match rather than offering nothing", () => {
    const foreign = b({ info: { name: "PS1", files: [
      { length: 1, path: ["Mizzurna Falls (Japan).zip"] },
    ] } });
    const matches = matchCollectionFiles(torrentFiles(foreign), "Mizzurna Falls", "USA");
    expect(matches).toHaveLength(1);
    expect(matches[0].variant.label).toBe("Japan");
  });

  it("labels an unregioned filename honestly instead of guessing", () => {
    expect(releaseVariant("Some Game.zip").label).toBe("Unlabelled release");
    expect(releaseVariant("Some Game (World).zip").english).toBe(true);
  });
});

/**
 * The manifest is what makes "indexed once when it is inserted into settings"
 * true: searching reads this file instead of re-downloading and re-decoding the
 * source torrent on every click.
 */
describe("collection manifest", () => {
  const dir = path.join(os.tmpdir(), `gamestore-manifest-${process.pid}`);
  const url = "https://example.invalid/ps1.torrent";
  afterAll(() => fsp.rm(dir, { recursive: true, force: true }));

  it("reads back a stored manifest and reports nothing when absent", async () => {
    expect(await readCollectionManifest(dir, url)).toBeNull();
    await fsp.mkdir(dir, { recursive: true });
    const manifest = {
      url,
      name: "PS1",
      platform: "PS1",
      indexedAt: Date.now(),
      files: [{ path: "Tekken 3 (USA).zip", bytes: 9, index: 0 }],
    };
    // Written under the same name the indexer uses, derived from the URL alone.
    const { createHash } = await import("node:crypto");
    const file = path.join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);
    await fsp.writeFile(file, JSON.stringify(manifest), "utf8");
    expect((await readCollectionManifest(dir, url))?.files).toHaveLength(1);
    await removeCollectionManifest(dir, url);
    expect(await readCollectionManifest(dir, url)).toBeNull();
  });
});

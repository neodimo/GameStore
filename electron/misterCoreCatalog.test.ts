import { describe, expect, it } from "vitest";
import { buildCatalog, buildDownloadUrl, matchesInstalledRbf, type CoreSource, type RawDb } from "./misterCoreCatalog";

const officialSource: CoreSource = { id: "official", title: "MiSTer-devel Distribution", dbUrl: "x", tier: "official" };
const jtcoresSource: CoreSource = { id: "jtcores", title: "JTCORES", dbUrl: "x", tier: "unofficial" };
const llapiSource: CoreSource = { id: "llapi", title: "LLAPI Folder", dbUrl: "x", tier: "unofficial" };

/**
 * A trimmed fixture in the exact shape of the real `db.json` published by
 * `MiSTer-devel/Distribution_MiSTer` (structure and tag ids confirmed live
 * against that repository on 2026-08-28), covering the cases that broke the
 * hand-curated list this catalog replaced: a console core with no arcade-style
 * rename to track, and an arcade board with more than one playable romset.
 */
const officialFixture: RawDb = {
  base_files_url: "https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/deadbeef/",
  tag_dictionary: {
    arcadecores: 29,
    cores: 240,
    arcaderbfsonly: 397,
    mra: 33,
    arcadedonkeykong: 98,
    arcadedonkeykong3: 96,
    consolecores: 28,
    psx: 252,
    n64: 251,
    computercores: 30,
    c64: 284,
  },
  files: {
    "_Arcade/cores/Arcade-DonkeyKong_20240526.rbf": { hash: "rbf-dk", size: 3088316, tags: [29, 240, 397, 98] },
    "_Arcade/Donkey Kong (US, Set 1).mra": { hash: "mra-dk-us", size: 87579, tags: [29, 33, 98] },
    "_Arcade/Donkey Kong (Japan Set 1).mra": { hash: "mra-dk-jp", size: 87000, tags: [29, 33, 98] },
    "_Arcade/cores/Arcade-DonkeyKong3_20240526.rbf": { hash: "rbf-dk3", size: 3000000, tags: [29, 240, 397, 96] },
    "_Arcade/Donkey Kong 3 (US).mra": { hash: "mra-dk3", size: 80000, tags: [29, 33, 96] },
    "_Console/PSX_20260807.rbf": { hash: "rbf-psx", size: 4359060, tags: [28, 240, 252] },
    "_Console/N64_20260726.rbf": { hash: "rbf-n64-old", size: 3900000, tags: [28, 240, 251] },
    "_Console/N64_20260101.rbf": { hash: "rbf-n64-older", size: 3800000, tags: [28, 240, 251] },
    "_Computer/C64_20260823.rbf": { hash: "rbf-c64", size: 2000000, tags: [30, 240, 284] },
    // Not one of the installable core folders; must be ignored entirely.
    "Cheats/AtariLynx/Basketbrawl.zip": { hash: "cheat", size: 859, tags: [29] },
  },
};

/** JTCORES ships undated rbf filenames and its own tag dictionary, per the live manifest. */
const jtcoresFixture: RawDb = {
  base_files_url: "https://raw.githubusercontent.com/jotego/jtcores_mister/cafef00d/",
  tag_dictionary: { arcadecores: 1, cores: 2, arcaderbfsonly: 3, arcadedonkeykong: 4 },
  files: {
    "_Arcade/cores/jtdkong.rbf": { hash: "jt-rbf-dk", size: 2000000, tags: [1, 2, 3, 4] },
    "_Arcade/Donkey Kong (bootleg).mra": { hash: "jt-mra-dk", size: 9000, tags: [1, 4] },
  },
};

const llapiFixture: RawDb = {
  base_files_url: "https://raw.githubusercontent.com/MiSTer-LLAPI/LLAPI_folder_MiSTer/beefcafe/",
  tag_dictionary: {},
  files: {
    "_LLAPI/Atari7800_LLAPI_20250209.rbf": { hash: "llapi-a7800", size: 1000000 },
  },
};

describe("MiSTer core catalog (built from update_all.sh's own manifests)", () => {
  it("includes PSX and N64 as plain console cores, the exact gap the hand-curated list had", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    const ids = entries.map((entry) => entry.id);
    expect(ids).toContain("official:console:psx");
    expect(ids).toContain("official:console:n64");
  });

  it("keeps only the newest dated rbf when a system has more than one", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    const n64 = entries.find((entry) => entry.id === "official:console:n64")!;
    expect(n64.rbfPath).toBe("_Console/N64_20260726.rbf");
  });

  it("groups an arcade rbf with only the mras that share its specific tag, not a sibling core's", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    const donkeyKong = entries.find((entry) => entry.id === "official:arcade:arcadedonkeykong")!;
    const donkeyKong3 = entries.find((entry) => entry.id === "official:arcade:arcadedonkeykong3")!;
    expect(donkeyKong.mraFiles.map((f) => f.path).sort()).toEqual([
      "_Arcade/Donkey Kong (Japan Set 1).mra",
      "_Arcade/Donkey Kong (US, Set 1).mra",
    ]);
    expect(donkeyKong3.mraFiles.map((f) => f.path)).toEqual(["_Arcade/Donkey Kong 3 (US).mra"]);
  });

  it("names an arcade core from its flagship mra with the region/set variant stripped", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    const donkeyKong = entries.find((entry) => entry.id === "official:arcade:arcadedonkeykong")!;
    expect(donkeyKong.name).toBe("Donkey Kong");
  });

  it("ignores files outside the installable core folders", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    expect(entries.some((entry) => entry.rbfPath.startsWith("Cheats/"))).toBe(false);
  });

  it("stamps every entry with its source's title and tier", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    expect(entries.every((entry) => entry.source === "MiSTer-devel Distribution" && entry.tier === "official")).toBe(true);
  });

  it("matches an installed rbf regardless of which dated revision is on the device", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    const psx = entries.find((entry) => entry.id === "official:console:psx")!;
    expect(matchesInstalledRbf(psx, "PSX_20240101.rbf")).toBe(true);
    expect(matchesInstalledRbf(psx, "PSX_20260807.rbf")).toBe(true);
    expect(matchesInstalledRbf(psx, "N64_20260807.rbf")).toBe(false);
  });

  it("percent-encodes each path segment of a download URL without touching the separators", () => {
    const url = buildDownloadUrl(
      "https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/deadbeef/",
      "_Arcade/Donkey Kong (US, Set 1).mra",
    );
    expect(url).toBe(
      "https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/deadbeef/_Arcade/Donkey%20Kong%20(US%2C%20Set%201).mra",
    );
  });

  it("handles a source with no dated revisions at all (JTCORES ships bare filenames)", () => {
    const entries = buildCatalog(jtcoresFixture, jtcoresSource);
    const core = entries.find((entry) => entry.id === "jtcores:arcade:arcadedonkeykong")!;
    expect(core.rbfPath).toBe("_Arcade/cores/jtdkong.rbf");
    expect(core.mraFiles.map((f) => f.path)).toEqual(["_Arcade/Donkey Kong (bootleg).mra"]);
  });

  it("never merges two sources' cores even when a family tag string happens to match", () => {
    const official = buildCatalog(officialFixture, officialSource);
    const jt = buildCatalog(jtcoresFixture, jtcoresSource);
    const ids = new Set([...official, ...jt].map((entry) => entry.id));
    expect(ids.has("official:arcade:arcadedonkeykong")).toBe(true);
    expect(ids.has("jtcores:arcade:arcadedonkeykong")).toBe(true);
  });

  it("names a multi-game board by its flagship title plus a count, not just whichever mra sorts first", () => {
    // A real case: JTCORES' CPS2 core plays 320 different games, and naming it
    // "1944 The Loop Master" because that title sorts first would misrepresent
    // one shared arcade board as a single specific game.
    const cps2Fixture: RawDb = {
      base_files_url: "x",
      tag_dictionary: { arcadecores: 1, cores: 2, arcaderbfsonly: 3, arcadejtcps2: 4 },
      files: {
        "_Arcade/cores/jtcps2.rbf": { hash: "h", size: 1, tags: [1, 2, 3, 4] },
        "_Arcade/1944 The Loop Master (Europe).mra": { hash: "h1", size: 1, tags: [4] },
        "_Arcade/19XX The War Against Destiny (Europe).mra": { hash: "h2", size: 1, tags: [4] },
        "_Arcade/Alien vs. Predator (Europe).mra": { hash: "h3", size: 1, tags: [4] },
        "_Arcade/Armored Warriors (Europe).mra": { hash: "h4", size: 1, tags: [4] },
        "_Arcade/Battle Circuit (Europe).mra": { hash: "h5", size: 1, tags: [4] },
      },
    };
    const entries = buildCatalog(cps2Fixture, jtcoresSource);
    expect(entries[0].name).toBe("1944 The Loop Master + 4 more");
  });

  it("still names a small regional-variant cluster after its one game, with no count suffix", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    const donkeyKong = entries.find((entry) => entry.id === "official:arcade:arcadedonkeykong")!;
    expect(donkeyKong.name).toBe("Donkey Kong");
  });

  it("categorizes an LLAPI core into its own _LLAPI-backed category with a clear display name", () => {
    const entries = buildCatalog(llapiFixture, llapiSource);
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("llapi");
    expect(entries[0].name).toBe("Atari7800 (LLAPI)");
    expect(entries[0].rbfPath).toBe("_LLAPI/Atari7800_LLAPI_20250209.rbf");
  });

  it("counts an arcade core's romsets and names its flagship for box-art lookup, regardless of the '+ N more' display suffix", () => {
    const entries = buildCatalog(officialFixture, officialSource);
    const donkeyKong = entries.find((entry) => entry.id === "official:arcade:arcadedonkeykong")!;
    const donkeyKong3 = entries.find((entry) => entry.id === "official:arcade:arcadedonkeykong3")!;
    expect(donkeyKong.gameCount).toBe(2);
    expect(donkeyKong.artTitle).toBe("Donkey Kong");
    expect(donkeyKong3.gameCount).toBe(1);
    expect(donkeyKong3.artTitle).toBe("Donkey Kong 3");
  });

  it("names a multi-game board's art title after its flagship alone, without the '+ N more' count the display name carries", () => {
    const cps2Fixture: RawDb = {
      base_files_url: "x",
      tag_dictionary: { arcadecores: 1, cores: 2, arcaderbfsonly: 3, arcadejtcps2: 4 },
      files: {
        "_Arcade/cores/jtcps2.rbf": { hash: "h", size: 1, tags: [1, 2, 3, 4] },
        "_Arcade/1944 The Loop Master (Europe).mra": { hash: "h1", size: 1, tags: [4] },
        "_Arcade/19XX The War Against Destiny (Europe).mra": { hash: "h2", size: 1, tags: [4] },
        "_Arcade/Alien vs. Predator (Europe).mra": { hash: "h3", size: 1, tags: [4] },
        "_Arcade/Armored Warriors (Europe).mra": { hash: "h4", size: 1, tags: [4] },
        "_Arcade/Battle Circuit (Europe).mra": { hash: "h5", size: 1, tags: [4] },
      },
    };
    const entries = buildCatalog(cps2Fixture, jtcoresSource);
    expect(entries[0].name).toBe("1944 The Loop Master + 4 more");
    expect(entries[0].gameCount).toBe(5);
    expect(entries[0].artTitle).toBe("1944 The Loop Master");
  });

  it("leaves gameCount and artTitle null for platform cores, which have no fixed or single-game identity", () => {
    const official = buildCatalog(officialFixture, officialSource);
    const psx = official.find((entry) => entry.id === "official:console:psx")!;
    const llapi = buildCatalog(llapiFixture, llapiSource)[0];
    expect(psx.gameCount).toBeNull();
    expect(psx.artTitle).toBeNull();
    expect(llapi.gameCount).toBeNull();
    expect(llapi.artTitle).toBeNull();
  });
});

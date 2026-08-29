import { describe, expect, it } from "vitest";
import { buildCatalog, buildDownloadUrl, matchesInstalledRbf, type RawDb } from "./misterCoreCatalog";

/**
 * A trimmed fixture in the exact shape of the real `db.json` published by
 * `MiSTer-devel/Distribution_MiSTer` (structure and tag ids confirmed live
 * against that repository on 2026-08-28), covering the cases that broke the
 * hand-curated list this catalog replaced: a console core with no arcade-style
 * rename to track, and an arcade board with more than one playable romset.
 */
const fixture: RawDb = {
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
    // Not one of the four installable folders; must be ignored entirely.
    "Cheats/AtariLynx/Basketbrawl.zip": { hash: "cheat", size: 859, tags: [29] },
  },
};

describe("MiSTer core catalog (built from the official Distribution manifest)", () => {
  it("includes PSX and N64 as plain console cores, the exact gap the hand-curated list had", () => {
    const { entries } = buildCatalog(fixture);
    const ids = entries.map((entry) => entry.id);
    expect(ids).toContain("console:psx");
    expect(ids).toContain("console:n64");
  });

  it("keeps only the newest dated rbf when a system has more than one", () => {
    const { entries } = buildCatalog(fixture);
    const n64 = entries.find((entry) => entry.id === "console:n64")!;
    expect(n64.rbfPath).toBe("_Console/N64_20260726.rbf");
  });

  it("groups an arcade rbf with only the mras that share its specific tag, not a sibling core's", () => {
    const { entries } = buildCatalog(fixture);
    const donkeyKong = entries.find((entry) => entry.id === "arcade:arcadedonkeykong")!;
    const donkeyKong3 = entries.find((entry) => entry.id === "arcade:arcadedonkeykong3")!;
    expect(donkeyKong.mraFiles.map((f) => f.path).sort()).toEqual([
      "_Arcade/Donkey Kong (Japan Set 1).mra",
      "_Arcade/Donkey Kong (US, Set 1).mra",
    ]);
    expect(donkeyKong3.mraFiles.map((f) => f.path)).toEqual(["_Arcade/Donkey Kong 3 (US).mra"]);
  });

  it("names an arcade core from its flagship mra with the region/set variant stripped", () => {
    const { entries } = buildCatalog(fixture);
    const donkeyKong = entries.find((entry) => entry.id === "arcade:arcadedonkeykong")!;
    expect(donkeyKong.name).toBe("Donkey Kong");
  });

  it("ignores files outside the four installable core folders", () => {
    const { entries } = buildCatalog(fixture);
    expect(entries.some((entry) => entry.rbfPath.startsWith("Cheats/"))).toBe(false);
  });

  it("matches an installed rbf regardless of which dated revision is on the device", () => {
    const { entries } = buildCatalog(fixture);
    const psx = entries.find((entry) => entry.id === "console:psx")!;
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
});

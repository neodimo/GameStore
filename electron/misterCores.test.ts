import { describe, expect, it } from "vitest";
import { CORE_CATEGORIES, MISTER_CORES, coreCategoryFolder, matchesInstalledRbf } from "./misterCores";

describe("MiSTer core registry", () => {
  it("matches a dated installed rbf for a core whose repo and installed names agree", () => {
    const nes = MISTER_CORES.find((core) => core.id === "console-nes")!;
    expect(matchesInstalledRbf(nes, "NES_20260823.rbf")).toBe(true);
    expect(matchesInstalledRbf(nes, "SNES_20260823.rbf")).toBe(false);
  });

  /**
   * The one fact only a real device image exposes: Genesis_MiSTer still
   * publishes `Genesis_<date>.rbf` in its own repo, but the official
   * distribution installs it as `MegaDrive_<date>.rbf`. Matching on the
   * repo's own prefix here would report the core as never installed on a
   * real MiSTer.
   */
  it("matches a core by its installed name even when the repo publishes a different one", () => {
    const genesis = MISTER_CORES.find((core) => core.id === "console-genesis")!;
    expect(genesis.repoRbfPrefix).toBe("Genesis");
    expect(genesis.installedRbfPrefix).toBe("MegaDrive");
    expect(matchesInstalledRbf(genesis, "MegaDrive_20260603.rbf")).toBe(true);
    expect(matchesInstalledRbf(genesis, "Genesis_20260603.rbf")).toBe(false);
  });

  it("matches an arcade core's installed rbf with the Arcade- repo prefix stripped", () => {
    const donkeyKong = MISTER_CORES.find((core) => core.id === "arcade-donkey-kong")!;
    expect(matchesInstalledRbf(donkeyKong, "DonkeyKong_20240526.rbf")).toBe(true);
    expect(matchesInstalledRbf(donkeyKong, "Arcade-DonkeyKong_20240526.rbf")).toBe(false);
  });

  it("never matches a non-rbf file", () => {
    const nes = MISTER_CORES.find((core) => core.id === "console-nes")!;
    expect(matchesInstalledRbf(nes, "NES_20260823.mra")).toBe(false);
  });

  it("gives every category a real MiSTer core folder, with add-ons sharing the console folder", () => {
    expect(coreCategoryFolder("arcade")).toBe("_Arcade");
    expect(coreCategoryFolder("computer")).toBe("_Computer");
    expect(coreCategoryFolder("console")).toBe("_Console");
    expect(coreCategoryFolder("addon")).toBe("_Console");
  });

  it("gives every registered core a category from the published list and, for arcade cores only, an .mra", () => {
    const categoryIds = new Set(CORE_CATEGORIES.map((category) => category.id));
    for (const core of MISTER_CORES) {
      expect(categoryIds.has(core.category)).toBe(true);
      expect(!!core.mraFile).toBe(core.category === "arcade");
    }
  });

  it("has no duplicate core ids", () => {
    const ids = MISTER_CORES.map((core) => core.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

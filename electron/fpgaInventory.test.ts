import { describe, expect, it } from "vitest";
import { matchRemoteTitles, normalizeRemoteTitle } from "./fpgaInventory";
import {
  DEVICE_PLATFORMS,
  deviceEntryTitle,
  devicePlatform,
  isGameEntry,
} from "./devicePlatforms";

describe("MiSTer remote library matching", () => {
  it("matches managed folders while ignoring release tags and punctuation", () => {
    expect(normalizeRemoteTitle("Future Cop - L.A.P.D. (USA)")).toBe("future cop l a p d");
    expect(matchRemoteTitles(["Future Cop - L.A.P.D. (USA)"], [
      { id: "future-cop", title: "Future Cop: L.A.P.D." },
      { id: "other", title: "Other Game" },
    ])).toEqual(["future-cop"]);
  });
});

/**
 * The inventory used to keep only directory entries, which is a disc-console
 * assumption. A real MiSTer N64 folder holds loose `.z64` files, so a full
 * library listed as empty while the one unrelated subdirectory in it — `media`
 * — was reported as the entire installed library.
 */
describe("device entries by console layout", () => {
  const dir = (name: string) => ({ name, type: "d" });
  const file = (name: string) => ({ name, type: "-" });

  it("reads a cartridge folder as loose ROM files, not subdirectories", () => {
    const n64 = devicePlatform("N64");
    const listing = [
      file("Mario Kart 64 (USA).z64"),
      file("GoldenEye 007 (USA).n64"),
      file("Star Fox 64 (USA).v64"),
      dir("media"),
      file("notes.txt"),
      dir("."),
    ];
    const games = listing
      .filter((entry) => isGameEntry(n64, entry))
      .map((entry) => deviceEntryTitle(n64, entry.name));
    expect(games).toEqual([
      "Mario Kart 64 (USA)",
      "GoldenEye 007 (USA)",
      "Star Fox 64 (USA)",
    ]);
    // The exact regression: `media` is not a game and must never be the answer.
    expect(games).not.toContain("media");
  });

  it("reads a disc folder as directories and leaves loose files alone", () => {
    const psx = devicePlatform("PSX");
    const listing = [
      dir("Vagrant Story"),
      file("boot.rom"),
      file("Some Stray Image.chd"),
      dir(".."),
    ];
    expect(
      listing
        .filter((entry) => isGameEntry(psx, entry))
        .map((entry) => deviceEntryTitle(psx, entry.name)),
    ).toEqual(["Vagrant Story"]);
  });

  it("strips only a cartridge filename's extension, never a folder name", () => {
    // A disc title containing a dot must survive intact.
    expect(deviceEntryTitle(devicePlatform("PSX"), "Future Cop - L.A.P.D.")).toBe(
      "Future Cop - L.A.P.D.",
    );
    expect(deviceEntryTitle(devicePlatform("N64"), "Bomberman 64 (USA).z64")).toBe(
      "Bomberman 64 (USA)",
    );
  });

  it("matches a cartridge entry against the catalog after its extension is dropped", () => {
    const n64 = devicePlatform("N64");
    const installed = [file("Mario Kart 64 (USA).z64")]
      .filter((entry) => isGameEntry(n64, entry))
      .map((entry) => deviceEntryTitle(n64, entry.name));
    expect(
      matchRemoteTitles(installed, [
        { id: "n64-mario-kart-64", title: "Mario Kart 64", platform: "N64" },
      ]),
    ).toEqual(["n64-mario-kart-64"]);
  });

  it("pins every console's BIOS to a checkable hash", () => {
    for (const platform of DEVICE_PLATFORMS) {
      expect(platform.bios.length, platform.deviceFolder).toBeGreaterThan(0);
      for (const file of platform.bios)
        expect(file.md5, `${platform.deviceFolder}/${file.name}`).toMatch(
          /^[0-9a-f]{32}$/,
        );
    }
  });
});

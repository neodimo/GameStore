import { describe, expect, it } from "vitest";
import {
  listDeviceGames,
  matchRemoteTitles,
  normalizeRemoteTitle,
} from "./fpgaInventory";
import {
  DEVICE_PLATFORMS,
  deviceEntryTitle,
  deviceFolderForPlatformId,
  deviceFolderForStored,
  devicePlatform,
  isGameEntry,
} from "./devicePlatforms";

describe("MiSTer remote library matching", () => {
  it("normalizes the legacy all-caps Saturn cart name to the real core folder", () => {
    expect(deviceFolderForStored("SATURN")).toBe("Saturn");
    expect(deviceFolderForStored("Saturn")).toBe("Saturn");
  });

  /**
   * Taken from a real MiSTer. A device entry is named after the release, so
   * matching only the catalog's display title missed these: the article moves
   * in the No-Intro name, `Pokémon` loses its accent, and No-Intro's own
   * `Superman - The New Superman Aventures` carries a typo.
   */
  it("matches a device entry against the release name, not just the display title", () => {
    const catalog = [
      { id: "n64-zelda-oot", title: "The Legend of Zelda: Ocarina of Time", coverName: "Legend of Zelda, The - Ocarina of Time (USA)" },
      { id: "n64-pokemon-snap", title: "Pokémon Snap", coverName: "Pokemon Snap (USA)" },
      { id: "n64-superman-adventures", title: "Superman: The New Superman Adventures", coverName: "Superman - The New Superman Aventures (USA) (En,Fr,Es)" },
      { id: "n64-absent", title: "A Game Not Installed", coverName: "A Game Not Installed (USA)" },
    ];
    expect(
      matchRemoteTitles(
        [
          "Legend of Zelda, The - Ocarina of Time (USA) (Rev 2)",
          "Pokemon Snap (USA)",
          "Superman - The New Superman Aventures (USA) (En,Fr,Es)",
        ],
        catalog,
      ),
    ).toEqual(["n64-zelda-oot", "n64-pokemon-snap", "n64-superman-adventures"]);
  });

  it("folds diacritics so an accented catalog title matches a plain device entry", () => {
    expect(normalizeRemoteTitle("Pokémon Stadium 2")).toBe("pokemon stadium 2");
  });

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

  /**
   * `media` sits in the PlayStation folder too, on the same real device the
   * N64 symptom was reported from. Excluding it only from the cartridge layout
   * would have fixed the console it was noticed on and left it listed as a
   * game on the console it was not.
   */
  it("reads a disc folder as directories, and media is not a game there either", () => {
    const psx = devicePlatform("PSX");
    const listing = [
      dir("Vagrant Story"),
      dir("media"),
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

  it("keeps catalog identities separate from MiSTer core-folder names", () => {
    expect(deviceFolderForStored("PS1")).toBeUndefined();
    expect(deviceFolderForPlatformId("PS1")).toBe("PSX");
    expect(deviceFolderForPlatformId("SAT")).toBe("Saturn");
  });

  /**
   * The reported symptom, reproduced against the function that produced it:
   * a MiSTer whose N64 folder holds loose carts plus one `media` subdirectory
   * showed `media` as the whole installed N64 library.
   */
  it("reads a real mixed-layout device without reporting media as a game", async () => {
    const device: Record<string, { name: string; type: string }[]> = {
      "/media/fat/games/PSX": [
        dir("Vagrant Story"),
        dir("Silent Hill"),
        file("boot.rom"),
      ],
      "/media/fat/games/N64": [
        file("Mario Kart 64 (USA).z64"),
        file("Banjo-Kazooie (USA).z64"),
        file("Perfect Dark (USA).z64"),
        dir("media"),
        file("boot.rom"),
      ],
    };
    const client = {
      list: async (path: string) => {
        const entries = device[path];
        // A console folder that does not exist rejects, as SFTP does.
        if (!entries) throw new Error("No such file");
        return entries;
      },
    };

    const folders = await listDeviceGames(client, "/media/fat/games");
    expect(folders.N64).toEqual([
      "Mario Kart 64 (USA)",
      "Banjo-Kazooie (USA)",
      "Perfect Dark (USA)",
    ]);
    expect(folders.PSX).toEqual(["Vagrant Story", "Silent Hill"]);
    // A console with no folder on the device reports empty, never throws.
    expect(folders.Saturn).toEqual([]);
    // BIOS files are not games on either layout.
    expect([...folders.N64, ...folders.PSX]).not.toContain("boot.rom");
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

import { describe, expect, it } from "vitest";
import { games } from "./catalog";
import { thumbnailIndexSample } from "./artMatch.fixture";
import {
  BROWSE_FLOOR,
  exactArtMatch,
  MATCH_FLOOR,
  normalizeTitle,
  parseArtFilename,
  rankArtCandidates,
  resolveArt,
  stripReleaseVersion,
} from "./artMatch";

/**
 * Ground truth was verified by hand against the live 9,339-file Libretro index.
 * Every entry is the real No-Intro filename of the release the catalog means,
 * including the cases the old exact-filename approach could never hit:
 * romanization drift, dropped subtitles, swapped articles and multi-disc sets.
 */
const expected: Record<string, string | string[]> = {
  "incredible-crisis": "Incredible Crisis (USA).png",
  "mr-domino": "No One Can Stop Mr. Domino (USA).png",
  "vib-ribbon": "Vib-Ribbon (Europe) (En,Fr,De,Es,It).png",
  "tail-sun": "Tail of the Sun (USA).png",
  "rising-zan": "Rising Zan - The Samurai Gunman (USA).png",
  "irritating-stick": "Irritating Stick (USA).png",
  "one-piece-mansion": "One Piece Mansion (USA).png",
  "devil-dice": "Devil Dice (USA).png",
  // Two PAL language printings of the same release; either cover is correct.
  "team-buddies": [
    "Team Buddies (USA).png",
    "Team Buddies (Europe) (En,Fr,De).png",
    "Team Buddies (Europe) (En,Es,It).png",
  ],
  "unholy-war": "Unholy War, The (USA).png",
  "poy-poy": "Poy Poy (USA).png",
  "eggs-steel": "Eggs of Steel - Charlie's Eggcellent Adventure (USA).png",
  boombots: "BoomBots (USA).png",
  "harmful-park": "Harmful Park (Japan).png",
  "planet-laika": "Planet Laika (Japan).png",
  "racing-lagoon": "Racing Lagoon (Japan, Asia).png",
  "mizzurna-falls": "Mizzurna Falls (Japan).png",
  paranoiascape: "Paranoia Scape (Japan).png",
  baroque: "Baroque - Yuganda Mousou (Japan).png",
  "remote-control-dandy": "Remote Control Dandy (Japan).png",
  "tobal-2": "Tobal 2 (Japan, Asia).png",
  germs: "Germs - Nerawareta Machi (Japan).png",
  "kowloons-gate": "Kowloon's Gate - Kowloon Fuusuiden (Japan, Asia).png",
  "linda-cube": "Linda^3 Again (Japan).png",
  "ore-no-ryouri": "Ore no Ryouri (Japan).png",
  pepsiman: "Pepsiman (Japan).png",
  "cho-aniki": "Chou Aniki - Kyuukyoku Muteki Ginga Saikyou Otoko (Japan).png",
  "mad-panic-coaster": "Mad Panic Coaster (Japan).png",
  "internal-section": "iS - Internal Section (Japan).png",
  "slap-happy": "Slap Happy Rhythm Busters (Japan).png",
};

describe("art filename parsing", () => {
  it("restores trailing articles and separates release tags", () => {
    expect(parseArtFilename("Unholy War, The (USA) (Rev 1).png")).toEqual({
      core: "The Unholy War",
      tags: ["USA", "Rev 1"],
    });
  });
  it("normalizes punctuation, articles and superscripts", () => {
    expect(normalizeTitle("Linda³ Again")).toBe("linda3 again");
    expect(normalizeTitle("Kowloon’s Gate")).toBe("kowloon s gate");
  });
});

/**
 * The seeded exact lookup is now the primary resolution path, so it has to be
 * held to the fuzzy matcher's result rather than merely being fast.
 */
describe("seeded exact cover lookup", () => {
  it("resolves a seeded No-Intro name straight out of the index", () => {
    const match = exactArtMatch("Incredible Crisis (USA)", thumbnailIndexSample);
    expect(match?.file).toBe("Incredible Crisis (USA).png");
    expect(match?.confidence).toBe("high");
  });

  it("folds version and revision printings onto the same cover", () => {
    expect(stripReleaseVersion("Alundra (USA) (v1.1)")).toBe("Alundra (USA)");
    expect(stripReleaseVersion("Unholy War, The (USA) (Rev 1)")).toBe(
      "Unholy War, The (USA)",
    );
    // A seed naming a printing the index does not carry still finds the cover.
    expect(
      exactArtMatch("Devil Dice (USA) (v1.1)", thumbnailIndexSample)?.file,
    ).toBe("Devil Dice (USA).png");
  });

  it("declines rather than inventing a cover for unknown or absent names", () => {
    expect(exactArtMatch(undefined, thumbnailIndexSample)).toBeNull();
    expect(
      exactArtMatch("Totally Fictional Game 9000 (USA)", thumbnailIndexSample),
    ).toBeNull();
  });

  it("never disagrees with the fuzzy matcher it short-circuits", () => {
    const conflicts: string[] = [];
    let checked = 0;
    for (const game of games) {
      const exact = exactArtMatch(game.coverName, thumbnailIndexSample);
      if (!exact) continue;
      checked += 1;
      const fuzzy = resolveArt(game.title, game.region, thumbnailIndexSample);
      if (fuzzy?.file !== exact.file)
        conflicts.push(`${game.title}: ${exact.file} vs ${fuzzy?.file}`);
    }
    expect(checked).toBeGreaterThan(50);
    expect(conflicts).toEqual([]);
  });
});

describe("automatic box-art resolution", () => {
  it("resolves every catalog game to its correct release artwork", () => {
    const wrong: string[] = [];
    for (const game of games.filter((game) => expected[game.id])) {
      const match = resolveArt(game.title, game.region, thumbnailIndexSample);
      const accepted = [expected[game.id]].flat();
      if (!match || !accepted.includes(match.file))
        wrong.push(`${game.title}: ${match?.file ?? "no match"}`);
    }
    expect(wrong).toEqual([]);
  });

  it("covers the hand-verified adversarial catalog with no holes", () => {
    for (const game of games.filter((game) => expected[game.id]))
      expect(
        resolveArt(game.title, game.region, thumbnailIndexSample),
      ).not.toBeNull();
  });

  it("prefers the catalog region but still matches across regions", () => {
    const usa = resolveArt("Incredible Crisis", "USA", thumbnailIndexSample);
    const europe = resolveArt(
      "Incredible Crisis",
      "Europe",
      thumbnailIndexSample,
    );
    expect(usa?.file).toContain("(USA)");
    expect(europe?.file).toContain("(Europe)");
  });

  it("rejects unrelated titles instead of inventing a cover", () => {
    expect(
      resolveArt("Totally Fictional Game 9000", "USA", thumbnailIndexSample),
    ).toBeNull();
  });

  it("demotes demos, prototypes and later discs", () => {
    const ranked = rankArtCandidates(
      "Kowloon's Gate",
      "Japan",
      thumbnailIndexSample,
    );
    const top = ranked[0];
    expect(top.file).not.toMatch(/Disc [2-9]/);
    expect(top.file).not.toMatch(/Special Disc/);
    for (const candidate of ranked) expect(candidate.score).toBeGreaterThanOrEqual(MATCH_FLOOR);
  });

  it("offers alternate regional printings for a deeper search", () => {
    const ranked = rankArtCandidates("Devil Dice", "USA", thumbnailIndexSample);
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked.map((c) => c.file).join(" ")).toContain("(Europe)");
  });

  it("widens the manual browse floor without loosening the auto-picker", () => {
    const title = "Remote Control Dandy";
    const strict = rankArtCandidates(
      title,
      "Japan",
      thumbnailIndexSample,
      "Named_Boxarts",
      36,
    );
    const browse = rankArtCandidates(
      title,
      "Japan",
      thumbnailIndexSample,
      "Named_Boxarts",
      36,
      BROWSE_FLOOR,
    );
    // The deep-search panel must show strictly more to choose from...
    expect(browse.length).toBeGreaterThan(strict.length);
    // ...while the top pick and the automatic resolver are unchanged.
    expect(browse[0].file).toBe(strict[0].file);
    expect(resolveArt(title, "Japan", thumbnailIndexSample)?.file).toBe(
      strict[0].file,
    );
    for (const candidate of strict)
      expect(candidate.score).toBeGreaterThanOrEqual(MATCH_FLOOR);
  });
});

import { describe, expect, it } from "vitest";
import { thumbnailIndexSample } from "./artMatch.fixture";
import { longplayIndexSample } from "./mediaMatch.fixture";
import {
  LONGPLAY_FLOOR,
  cleanLongplayTitle,
  rankLongplays,
  resolveLongplay,
  resolveScreenshots,
  scoreLongplay,
  sequenceNumbers,
} from "./mediaMatch";

/**
 * The Libretro fixture is a box-art listing, but snaps and title screens use
 * identical No-Intro filenames, so it exercises the screenshot path faithfully.
 */
const indexes = {
  Named_Snaps: thumbnailIndexSample,
  Named_Titles: thumbnailIndexSample,
};

describe("screenshots", () => {
  it("returns a strip rather than a single frame", () => {
    const shots = resolveScreenshots("Tobal No. 2", "Japan", indexes);
    expect(shots.length).toBeGreaterThan(1);
  });

  it("leads with gameplay frames, not title screens", () => {
    const shots = resolveScreenshots("Incredible Crisis", "USA", indexes);
    expect(shots[0].kind).toBe("Screenshot");
  });

  it("keeps both kinds so the strip has title screens further down", () => {
    const kinds = new Set(
      resolveScreenshots("Incredible Crisis", "USA", indexes).map(
        (s) => s.kind,
      ),
    );
    expect(kinds).toEqual(new Set(["Screenshot", "Title screen"]));
  });

  it("survives a missing folder index instead of throwing", () => {
    const shots = resolveScreenshots("Vib-Ribbon", "Europe", {
      Named_Snaps: thumbnailIndexSample,
    });
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => s.kind === "Screenshot")).toBe(true);
  });

  it("returns nothing for a title that is not in the index", () => {
    expect(resolveScreenshots("Totally Invented Game", "USA", indexes)).toEqual(
      [],
    );
  });

  /**
   * Regression: an absolute score floor let every game sharing a common word
   * into the strip. Racing Lagoon collected 28 frames, 27 of which belonged to
   * Ford Racing, 007 Racing, Nicktoons Racing and friends.
   */
  it("does not fill the strip with games that merely share a word", () => {
    const files = resolveScreenshots("Racing Lagoon", "Japan", indexes).map(
      (s) => decodeURIComponent(s.url),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => /Racing Lagoon/i.test(f))).toBe(true);
  });

  it("excludes a different game with a similar name", () => {
    const files = resolveScreenshots("Kowloon's Gate", "Japan", indexes).map(
      (s) => decodeURIComponent(s.url),
    );
    expect(files.some((f) => /Heaven's Gate/i.test(f))).toBe(false);
    expect(files.some((f) => /Elder Gate/i.test(f))).toBe(false);
  });

  /** Multi-disc releases are the same game and must still stack up. */
  it("keeps every disc of a multi-disc release", () => {
    const files = resolveScreenshots("Kowloon's Gate", "Japan", indexes).map(
      (s) => decodeURIComponent(s.url),
    );
    for (const disc of ["Disc 1", "Disc 2", "Disc 3", "Disc 4"])
      expect(files.some((f) => f.includes(disc))).toBe(true);
  });
});

describe("longplay titles", () => {
  it("strips collection boilerplate and catalogue numbers", () => {
    expect(cleanLongplayTitle("PSX Longplay [365] Paranoia Scape")).toBe(
      "Paranoia Scape",
    );
    expect(cleanLongplayTitle("PSX Longplay - Tobal 2")).toBe("Tobal 2");
    expect(cleanLongplayTitle("PSX Longplay Vib Ribbon EU")).toBe("Vib Ribbon");
  });

  it("does not mistake a catalogue number for a sequel number", () => {
    // [365] is the collection index, not part of the game's name.
    expect(sequenceNumbers("PSX Longplay [365] Paranoia Scape")).toEqual([]);
  });
});

describe("longplay resolution", () => {
  const expected: Record<string, string> = {
    "Incredible Crisis": "PSX_Longplay_116_Incredible_Crisis",
    "No One Can Stop Mr. Domino!": "PSX_Longplay_232_No_One_Can_Stop_Mr_Domino",
    "Vib-Ribbon": "psx-longplay-vib-ribbon-eu",
    "Rising Zan: The Samurai Gunman":
      "psx-longplay-rising-zan-the-samurai-gunman-us",
    ParanoiaScape: "PSX_Longplay_365_Paranoia_Scape",
    "Tobal No. 2": "Tobal2",
    "Cho Aniki: Kyuukyoku Muteki Ginga Saikyou Otoko":
      "psx-longplay-cho-aniki-kyuukyoku-muteki-ginga-saikyou-otoko-jp",
    "Internal Section": "PSX_Longplay_358_iS_Internal_Section",
    "Slap Happy Rhythm Busters":
      "PSX_Longplay_-_Slap_Happy_Rhythm_Busters_-_JP",
  };

  for (const [title, identifier] of Object.entries(expected))
    it(`matches ${title}`, () => {
      expect(resolveLongplay(title, longplayIndexSample)?.identifier).toBe(
        identifier,
      );
    });

  /**
   * The single most dangerous case in the corpus: `Tobal No. 1` is one digit
   * away from the catalog's `Tobal No. 2`, and shares the "No." the correct
   * release drops. Pure string similarity ranks the wrong game first.
   */
  it("prefers Tobal 2 over Tobal No. 1", () => {
    const ranked = rankLongplays("Tobal No. 2", longplayIndexSample);
    expect(ranked[0].identifier).toBe("Tobal2");
    const wrong = ranked.find((r) => r.identifier === "TobalNo1");
    expect(wrong?.score ?? 0).toBeLessThan(ranked[0].score);
  });

  it("does not hand Metal Slug X to Metal Slug", () => {
    expect(resolveLongplay("Metal Slug", longplayIndexSample)?.identifier).toBe(
      "PSX_Longplay_258_Metal_Slug",
    );
  });

  /** Every catalog title with no genuine recording must stay empty. */
  const noVideo = [
    "Tail of the Sun",
    "Irritating Stick",
    "One Piece Mansion",
    "Devil Dice",
    "Team Buddies",
    "The Unholy War",
    "Poy Poy",
    "Eggs of Steel",
    "BoomBots",
    "Harmful Park",
    "Planet Laika",
    "Racing Lagoon",
    "Mizzurna Falls",
    "Baroque",
    "Remote Control Dandy",
    "Germs: Nerawareta Machi",
    "Kowloon's Gate",
    "Ore no Ryouri",
    "Pepsiman",
    "Mad Panic Coaster",
  ];
  for (const title of noVideo)
    it(`leaves ${title} without a video rather than guessing`, () => {
      expect(resolveLongplay(title, longplayIndexSample)).toBeNull();
    });

  it("keeps the near-misses below the floor", () => {
    // The scorer may still rank these first; the floor is what rejects them.
    expect(
      scoreLongplay("Pepsiman", {
        identifier: "psx-longplay-superman-eu",
        title: "PSX Longplay Superman EU",
      }),
    ).toBeLessThan(LONGPLAY_FLOOR);
    expect(
      scoreLongplay("BoomBots", {
        identifier: "PSX_Longplay_605_Bomb_Boat",
        title: "PSX Longplay [605] Bomb Boat",
      }),
    ).toBeLessThan(LONGPLAY_FLOOR);
  });
});

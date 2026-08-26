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
/** The fixture is a PlayStation listing; see the note in `artMatch.test.ts`. */
const PSX = "Sony%20-%20PlayStation";

describe("screenshots", () => {
  it("returns a strip rather than a single frame", () => {
    const shots = resolveScreenshots("Tobal No. 2", "Japan", indexes, PSX);
    expect(shots.length).toBeGreaterThan(1);
  });

  it("leads with gameplay frames, not title screens", () => {
    const shots = resolveScreenshots("Incredible Crisis", "USA", indexes, PSX);
    expect(shots[0].kind).toBe("Screenshot");
  });

  it("keeps both kinds so the strip has title screens further down", () => {
    const kinds = new Set(
      resolveScreenshots("Incredible Crisis", "USA", indexes, PSX).map(
        (s) => s.kind,
      ),
    );
    expect(kinds).toEqual(new Set(["Screenshot", "Title screen"]));
  });

  it("survives a missing folder index instead of throwing", () => {
    const shots = resolveScreenshots(
      "Vib-Ribbon",
      "Europe",
      { Named_Snaps: thumbnailIndexSample },
      PSX,
    );
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => s.kind === "Screenshot")).toBe(true);
  });

  it("returns nothing for a title that is not in the index", () => {
    expect(resolveScreenshots("Totally Invented Game", "USA", indexes, PSX)).toEqual(
      [],
    );
  });

  /**
   * Regression: an absolute score floor let every game sharing a common word
   * into the strip. Racing Lagoon collected 28 frames, 27 of which belonged to
   * Ford Racing, 007 Racing, Nicktoons Racing and friends.
   */
  it("does not fill the strip with games that merely share a word", () => {
    const files = resolveScreenshots("Racing Lagoon", "Japan", indexes, PSX).map(
      (s) => decodeURIComponent(s.url),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => /Racing Lagoon/i.test(f))).toBe(true);
  });

  it("excludes a different game with a similar name", () => {
    const files = resolveScreenshots("Kowloon's Gate", "Japan", indexes, PSX).map(
      (s) => decodeURIComponent(s.url),
    );
    expect(files.some((f) => /Heaven's Gate/i.test(f))).toBe(false);
    expect(files.some((f) => /Elder Gate/i.test(f))).toBe(false);
  });

  /**
   * Pooling every printing turned the gallery into a region grab-bag: the USA
   * menu, the PAL menu and the Japanese menu presented as one game's frames.
   */
  it("shows only the primary variant, not every regional printing", () => {
    const files = resolveScreenshots("Incredible Crisis", "USA", indexes, PSX).map(
      (s) => decodeURIComponent(s.url),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => /\(USA\)/.test(f))).toBe(true);
    expect(files.some((f) => /\(Europe\)/.test(f))).toBe(false);
  });

  it("follows the catalog region rather than always preferring USA", () => {
    const files = resolveScreenshots("Vib-Ribbon", "Europe", indexes, PSX).map((s) =>
      decodeURIComponent(s.url),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => /\(Europe\)/.test(f))).toBe(true);
  });

  it("does not claim an untagged frame belongs to the primary region", () => {
    const release = ["Strict Test (USA).png", "Strict Test.png"];
    const files = resolveScreenshots(
      "Strict Test",
      "USA",
      { Named_Snaps: release, Named_Titles: release },
      PSX,
    ).map((shot) => decodeURIComponent(shot.url));
    expect(files).toHaveLength(2);
    expect(files.every((file) => /\(USA\)/.test(file))).toBe(true);
  });

  /** One regional printing, with a single Disc 1 start screen. */
  it("keeps one retail printing and only one primary title screen", () => {
    const shots = resolveScreenshots("Kowloon's Gate", "Japan", indexes, PSX);
    const files = shots.map((s) => decodeURIComponent(s.url));
    expect(files.some((file) => file.includes("Disc 1"))).toBe(true);
    expect(files.some((file) => file.includes("Disc 4"))).toBe(true);
    const scopes = new Set(
      files.map((file) => (file.includes("Japan, Asia") ? "Japan, Asia" : "Japan")),
    );
    expect(scopes.size).toBe(1);
    const titles = shots.filter((shot) => shot.kind === "Title screen");
    expect(titles).toHaveLength(1);
    expect(decodeURIComponent(titles[0].url)).toContain("Disc 1");
  });

  it("excludes demos, betas and prototypes from the retail gallery", () => {
    const release = [
      "Retail Test (USA).png",
      "Retail Test (USA) (Demo).png",
      "Retail Test (USA) (Beta).png",
      "Retail Test (USA) (Prototype).png",
    ];
    const files = resolveScreenshots(
      "Retail Test",
      "USA",
      { Named_Snaps: release, Named_Titles: release },
      PSX,
    ).map((shot) => decodeURIComponent(shot.url));
    expect(files).toHaveLength(2);
    expect(files.every((file) => !/(Demo|Beta|Prototype)/.test(file))).toBe(true);
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

  /**
   * Each of these was a correct recording that the live index already held and
   * the matcher rejected: measured against the real 998-item index they scored
   * 0.65, 0.67, 0.44 and 0.43 under a 0.72 floor. Coverage over the 100-game
   * catalog went from 53 to 67 once they resolved.
   */
  describe("recovered matches", () => {
    const item = (title: string) => ({ identifier: title.replace(/\W+/g, "_"), title });
    const index = [
      item("PSX Longplay [251] Suikoden 2"),
      item("PSX Longplay 201 Suikoden 1"),
      item("PSX Longplay [079] Future Cop LAPD"),
      item("PSX Longplay 145 Alundra 1"),
      item("PSX Longplay - Kurushi Final (EU)"),
      item("PSX Longplay [004] Resident Evil"),
      item("PS1 Longplay Crash Bandicoot"),
      item("PS1 Longplay Crash Bandicoot 2 Cortex Strikes Back"),
      item("PSX Longplay [614] Crash Bandicoot 3 - Buttobi! Sekai Isshuu"),
    ];
    const resolved = (title: string) => resolveLongplay(title, index)?.title;

    it("reads a roman numeral and an arabic numeral as the same entry", () => {
      expect(resolved("Suikoden II")).toBe("PSX Longplay [251] Suikoden 2");
    });

    it("reads a dotted initialism as one word", () => {
      expect(resolved("Future Cop: L.A.P.D.")).toBe(
        "PSX Longplay [079] Future Cop LAPD",
      );
    });

    it("accepts the 1 an uploader adds to the first game in a series", () => {
      expect(resolved("Suikoden")).toBe("PSX Longplay 201 Suikoden 1");
      expect(resolved("Alundra")).toBe("PSX Longplay 145 Alundra 1");
    });

    it("still refuses the previous entry in a series", () => {
      expect(resolveLongplay("Resident Evil 2", index)).toBeNull();
    });

    it("accepts a dropped subtitle when the remainder names one game", () => {
      expect(resolved("Kurushi Final: Mental Blocks")).toBe(
        "PSX Longplay - Kurushi Final (EU)",
      );
    });

    /**
     * The reverse case, and the reason the subtitle rule is gated. `Crash
     * Bandicoot` leads three entries here, so it identifies none of them —
     * without the guard `Crash Bandicoot: Warped` took the first game's video
     * at 0.92, and plain similarity alone still cleared the floor at 0.81.
     */
    it("refuses a dropped subtitle when the remainder is a whole series", () => {
      expect(resolveLongplay("Crash Bandicoot: Warped", index)).toBeNull();
      expect(resolved("Crash Bandicoot")).toBe("PS1 Longplay Crash Bandicoot");
    });
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

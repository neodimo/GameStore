import { describe, expect, it } from "vitest";
import { matchSnap, snapKey, type SnapFile } from "./emuMovies";

const file = (name: string, bytes = 4_000_000): SnapFile => ({
  name,
  path: `/Sony PlayStation/Video_Snaps_HD/${name}`,
  bytes,
});

describe("snapKey", () => {
  it("folds roman and arabic volume numbers together", () => {
    expect(snapKey("Suikoden II")).toBe(snapKey("Suikoden 2 (USA).mp4"));
    expect(snapKey("Final Fantasy VII")).toBe(snapKey("Final Fantasy 7 (USA) (Disc 1).mp4"));
  });

  it("folds dotted initialisms", () => {
    expect(snapKey("Future Cop: L.A.P.D.")).toBe(snapKey("Future Cop - LAPD (USA).mp4"));
  });

  it("normalises a trailing article to the front", () => {
    expect(snapKey("Legend of Dragoon, The (USA).mp4")).toBe(
      snapKey("The Legend of Dragoon"),
    );
  });

  it("drops region, disc and revision tags", () => {
    expect(snapKey("Silent Hill (USA) (Rev 1) (Disc 1).mp4")).toBe("silent hill");
  });

  it("keeps distinct games distinct", () => {
    expect(snapKey("Suikoden")).not.toBe(snapKey("Suikoden II"));
    expect(snapKey("Tekken 2")).not.toBe(snapKey("Tekken 3"));
  });
});

describe("matchSnap", () => {
  const library = [
    file("Silent Hill (USA).mp4"),
    file("Silent Hill (Europe).mp4"),
    file("Silent Hill (Japan).mp4"),
    file("Suikoden II (USA).mp4"),
    file("Suikoden (USA).mp4"),
  ];

  it("returns the release matching the catalog region", () => {
    expect(matchSnap(library, "Silent Hill", "USA")?.name).toBe(
      "Silent Hill (USA).mp4",
    );
    expect(matchSnap(library, "Silent Hill", "Europe")?.name).toBe(
      "Silent Hill (Europe).mp4",
    );
  });

  it("falls back to an English release when the region is absent", () => {
    const imports = [file("Racing Lagoon (Japan).mp4"), file("Racing Lagoon (Europe).mp4")];
    expect(matchSnap(imports, "Racing Lagoon", "USA")?.name).toBe(
      "Racing Lagoon (Europe).mp4",
    );
  });

  it("prefers the first disc of a multi-disc release", () => {
    const discs = [
      file("Final Fantasy VII (USA) (Disc 3).mp4"),
      file("Final Fantasy VII (USA) (Disc 1).mp4"),
      file("Final Fantasy VII (USA) (Disc 2).mp4"),
    ];
    expect(matchSnap(discs, "Final Fantasy VII", "USA")?.name).toBe(
      "Final Fantasy VII (USA) (Disc 1).mp4",
    );
  });

  it("does not settle for a different entry in the same series", () => {
    expect(matchSnap(library, "Suikoden III", "USA")).toBeNull();
    expect(matchSnap(library, "Suikoden", "USA")?.name).toBe("Suikoden (USA).mp4");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(matchSnap(library, "Vagrant Story", "USA")).toBeNull();
    expect(matchSnap([], "Silent Hill", "USA")).toBeNull();
    expect(matchSnap(library, "", "USA")).toBeNull();
  });

  it("matches a differently punctuated printing of the same game", () => {
    const odd = [file("Future Cop - L.A.P.D. (USA).mp4")];
    expect(matchSnap(odd, "Future Cop: LAPD", "USA")?.name).toBe(
      "Future Cop - L.A.P.D. (USA).mp4",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  auditSnapCoverage,
  findSnapFolders,
  matchSnap,
  snapKey,
  SnapSessionLost,
  type SnapFile,
} from "./emuMovies";
import type { FileInfo } from "basic-ftp";

const file = (name: string, bytes = 4_000_000): SnapFile => ({
  name,
  path: `/Sony PlayStation/Video_Snaps_HD/${name}`,
  bytes,
});

const directory = (name: string) =>
  ({ name, isDirectory: true, isFile: false, size: 0 }) as FileInfo;
const video = (name: string) =>
  ({ name, isDirectory: false, isFile: true, size: 4_000_000 }) as FileInfo;
const fakeClient = (tree: Record<string, FileInfo[]>) =>
  ({ list: async (remote = "/") => tree[remote] ?? [] }) as never;

/**
 * A crawl that swallows every listing error runs its whole queue against a dead
 * socket, then reports the silence as a content verdict — "no snap folder was
 * visible to this account" — which blames the user's membership for a network
 * fault, after minutes of a UI that only says "Connecting".
 */
describe("EmuMovies sign-in is bounded and honest about why it stopped", () => {
  const deadClient = () =>
    ({
      list: async () => {
        throw new Error("Timeout (control socket)");
      },
    }) as never;

  it("reports a lost session instead of crawling on and blaming the account", async () => {
    await expect(findSnapFolders(deadClient(), "PS1")).rejects.toBeInstanceOf(
      SnapSessionLost,
    );
  });

  it("gives up after a few consecutive failures, not the whole queue", async () => {
    let calls = 0;
    const client = {
      list: async () => {
        calls += 1;
        throw new Error("Timeout (control socket)");
      },
    } as never;
    await expect(findSnapFolders(client, "PS1")).rejects.toBeInstanceOf(
      SnapSessionLost,
    );
    // The listing cap is 160; a dead session must not pay for all of them.
    expect(calls).toBeLessThanOrEqual(4);
  });

  it("tolerates an isolated unreadable folder without failing the scan", async () => {
    const root = "/Official/Video Snaps (HQ)/Sony PlayStation";
    const tree: Record<string, FileInfo[]> = {
      "/": [directory("Official"), directory("Locked")],
      "/Official": [directory("Video Snaps (HQ)")],
      "/Official/Video Snaps (HQ)": [directory("Sony PlayStation")],
      [root]: [video("Silent Hill (USA).mp4")],
    };
    const client = {
      list: async (remote = "/") => {
        // A directory the entitlement does not cover: refused, but the session
        // is alive, so this is not grounds to abandon the scan.
        if (remote === "/Locked") throw new Error("550 Permission denied");
        return tree[remote] ?? [];
      },
    } as never;
    expect((await findSnapFolders(client, "PS1")).folders).toEqual([
      { path: root, quality: "HQ480" },
    ]);
  });

  it("marks a scan that ran out of budget as truncated, not as empty", async () => {
    // A tree deep enough that a spent budget stops the walk with work left.
    const tree: Record<string, FileInfo[]> = { "/": [directory("Official")] };
    for (let i = 0; i < 40; i += 1)
      tree[`/Official${"/media".repeat(i)}`] = [directory("media")];
    const expired = {
      expired: true,
      remainingMs: 0,
      guard: <T,>(_label: string, work: Promise<T>) => work,
    } as never;
    const scan = await findSnapFolders(fakeClient(tree), "PS1", expired);
    expect(scan.folders).toEqual([]);
    // Empty *and* truncated must never be reported as "your account has none".
    expect(scan.truncated).toBe(true);
  });

  it("marks a fully walked tree as complete so an empty result is trustworthy", async () => {
    const scan = await findSnapFolders(
      fakeClient({ "/": [directory("Official")], "/Official": [] }),
      "PS1",
    );
    expect(scan.folders).toEqual([]);
    expect(scan.truncated).toBe(false);
  });

  it("reports progress as it scans so a long crawl cannot read as a hang", async () => {
    const seen: string[] = [];
    await findSnapFolders(
      fakeClient({
        "/": [directory("Official")],
        "/Official": [directory("Video Snaps (HQ)")],
      }),
      "PS1",
      undefined,
      (message) => seen.push(message),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/finding|scanning/i);
  });
});

describe("EmuMovies FTP layout discovery", () => {
  it.each([
    ["N64", "Nintendo 64"],
    ["SAT", "Sega Saturn"],
  ])("finds %s video folders through its console alias", async (system, folderName) => {
    const root = `/Official/Video Snaps (HQ)/${folderName}`;
    const tree: Record<string, FileInfo[]> = {
      "/": [directory("Official")],
      "/Official": [directory("Video Snaps (HQ)")],
      "/Official/Video Snaps (HQ)": [directory(folderName)],
      [root]: [video("Example Game (USA).mp4")],
    };
    expect((await findSnapFolders(fakeClient(tree), system)).folders).toEqual([
      { path: root, quality: "HQ480" },
    ]);
  });

  it.each([
    ["N64", "Nintendo", "Nintendo 64"],
    ["SAT", "Sega", "Sega Saturn"],
  ])("descends through the %s manufacturer group", async (system, group, folderName) => {
    const root = `/${group}/${folderName}/Video Snaps`;
    const tree: Record<string, FileInfo[]> = {
      "/": [directory(group)],
      [`/${group}`]: [directory(folderName)],
      [`/${group}/${folderName}`]: [directory("Video Snaps")],
      [root]: [video("Example Game (USA).mp4")],
    };
    expect((await findSnapFolders(fakeClient(tree), system)).folders).toEqual([
      { path: root, quality: "Unknown" },
    ]);
  });

  it("recognises a separator in the provider's Nintendo 64 system name", async () => {
    const root = "/Official/Video Snaps (HQ)/Nintendo - Nintendo 64";
    expect((await findSnapFolders(fakeClient({
      "/": [directory("Official")],
      "/Official": [directory("Video Snaps (HQ)")],
      "/Official/Video Snaps (HQ)": [directory("Nintendo - Nintendo 64")],
      [root]: [video("Mario Kart 64 (USA).mp4")],
    }), "N64")).folders).toEqual([{ path: root, quality: "HQ480" }]);
  });

  it("follows neutral manufacturer intermediates to the actual N64 folder", async () => {
    const root = "/Nintendo/Consoles/Nintendo 64/MP4/USA";
    const tree: Record<string, FileInfo[]> = {
      "/": [directory("Nintendo")],
      "/Nintendo": [directory("Consoles")],
      "/Nintendo/Consoles": [directory("Nintendo 64")],
      "/Nintendo/Consoles/Nintendo 64": [directory("MP4")],
      "/Nintendo/Consoles/Nintendo 64/MP4": [directory("USA")],
      [root]: [video("Mario Kart 64 (USA).mp4")],
    };
    expect((await findSnapFolders(fakeClient(tree), "N64")).folders).toEqual([
      { path: root, quality: "Unknown" },
    ]);
  });

  it("accepts direct N64 clips below a generic console subfolder", async () => {
    const root = "/Official/Nintendo 64/HD";
    const tree: Record<string, FileInfo[]> = {
      "/": [directory("Official")],
      "/Official": [directory("Nintendo 64")],
      "/Official/Nintendo 64": [directory("HD")],
      [root]: [video("The Legend of Zelda - Ocarina of Time (USA).mp4")],
    };
    expect((await findSnapFolders(fakeClient(tree), "N64")).folders).toEqual([
      { path: root, quality: "HD1080" },
    ]);
  });

  it("prioritizes the requested console's video branch over broad media siblings", async () => {
    const visited: string[] = [];
    const root = "/Official/Video Snaps (HQ)/Sony Playstation";
    const unrelated = Array.from({ length: 60 }, (_, index) =>
      directory(`Media Downloads ${index}`),
    );
    const tree: Record<string, FileInfo[]> = {
      "/": [directory("Official"), ...unrelated],
      "/Official": [directory("Manuals"), directory("Video Snaps (HQ)")],
      "/Official/Video Snaps (HQ)": [
        directory("Nintendo 64"),
        directory("Sony PlayStation 2"),
        directory("Sony Playstation"),
      ],
      [root]: [video("Silent Hill (USA).mp4")],
    };
    const client = {
      list: async (remote = "/") => {
        visited.push(remote);
        return tree[remote] ?? [];
      },
    } as never;
    expect((await findSnapFolders(client, "PS1")).folders).toEqual([
      { path: root, quality: "HQ480" },
    ]);
    expect(visited.indexOf(root)).toBeLessThan(6);
  });

  it("does not descend into unrelated console groups from the root", async () => {
    const visited: string[] = [];
    const root = "/Official/Video Snaps (HQ)/Sony PlayStation";
    const tree: Record<string, FileInfo[]> = {
      "/": [directory("Official"), directory("Nintendo"), directory("Sega")],
      "/Official": [directory("Video Snaps (HQ)")],
      "/Official/Video Snaps (HQ)": [directory("Sony PlayStation")],
      [root]: [video("Silent Hill (USA).mp4")],
      "/Nintendo": [directory("Nintendo 64")],
      "/Sega": [directory("Dreamcast")],
    };
    const client = {
      list: async (remote = "/") => {
        visited.push(remote);
        return tree[remote] ?? [];
      },
    } as never;
    expect((await findSnapFolders(client, "PS1")).folders).toEqual([
      { path: root, quality: "HQ480" },
    ]);
    expect(visited).not.toContain("/Nintendo");
    expect(visited).not.toContain("/Sega");
  });

  it("finds the current quality-first Official layout", async () => {
    const root = "/Official/Video Snaps (HQ)/Sony PlayStation";
    const folders = await findSnapFolders(
      fakeClient({
        "/": [directory("Official")],
        "/Official": [directory("Video Snaps (HQ)")],
        "/Official/Video Snaps (HQ)": [
          directory("Sony PlayStation"),
          directory("Sony PlayStation 2"),
        ],
        [root]: [video("Silent Hill (USA).mp4")],
      }),
      "PS1",
    );
    expect(folders.folders).toEqual([{ path: root, quality: "HQ480" }]);
  });

  it("also finds a system-first quality layout", async () => {
    const root = "/Sony PlayStation/Video_Snaps_HD";
    const folders = await findSnapFolders(
      fakeClient({
        "/": [directory("Sony PlayStation")],
        "/Sony PlayStation": [directory("Video_Snaps_HD")],
        [root]: [video("Vagrant Story (USA).mp4")],
      }),
      "PS1",
    );
    expect(folders.folders).toEqual([{ path: root, quality: "HD1080" }]);
  });
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

  it("uses the canonical catalog release name before fuzzy title fallback", () => {
    const odd = [file("World Destruction League - Thunder Tanks (USA).mp4")];
    expect(matchSnap(odd, "WDL: Thunder Tanks", "USA", "World Destruction League - Thunder Tanks (USA)")?.name)
      .toBe("World Destruction League - Thunder Tanks (USA).mp4");
  });

  it("fuzzy-matches naming drift while rejecting nearby sequels", () => {
    expect(matchSnap([file("Kowloon's Gate (Japan).mp4")], "Kowloon Gate", "Japan")?.name)
      .toBe("Kowloon's Gate (Japan).mp4");
    expect(matchSnap([file("Tekken 2 (USA).mp4")], "Tekken 3", "USA")).toBeNull();
  });

  it("reports catalog matches instead of calling raw provider files matched", () => {
    expect(auditSnapCoverage(library, [
      { title: "Silent Hill", region: "USA" },
      { title: "Suikoden II", region: "USA" },
      { title: "Vagrant Story", region: "USA" },
    ])).toEqual({ catalog: 3, matched: 2, ambiguous: 0, unmatched: 1 });
  });

  it("fills each game from HD, then HQ, then SQ", () => {
    const tier = (name: string, quality: string): SnapFile => ({
      ...file(name), quality,
    });
    const waterfall = [
      tier("Silent Hill (USA).mp4", "HD1080"),
      tier("Silent Hill (Europe).mp4", "HQ480"),
      tier("Suikoden II (USA).mp4", "HQ480"),
      tier("Vagrant Story (USA).mp4", "SQ240"),
    ];
    expect(matchSnap(waterfall, "Silent Hill", "USA")?.quality).toBe("HD1080");
    expect(matchSnap(waterfall, "Suikoden II", "USA")?.quality).toBe("HQ480");
    expect(matchSnap(waterfall, "Vagrant Story", "USA")?.quality).toBe("SQ240");
    expect(auditSnapCoverage(waterfall, [
      { title: "Silent Hill", region: "USA" },
      { title: "Suikoden II", region: "USA" },
      { title: "Vagrant Story", region: "USA" },
    ]).matched).toBe(3);
  });
});

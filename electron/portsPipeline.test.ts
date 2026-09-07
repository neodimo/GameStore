import { describe, expect, it } from "vitest";
import {
  archiveKind,
  buildPortLaunch,
  pickPortExecutable,
  planPortInstall,
  planSummary,
  portInstallDirectory,
  selectReleaseAsset,
  type PlannablePort,
  type PortRelease,
} from "./portsPipeline";

describe("archiveKind", () => {
  it("recognizes the container formats GameStore can unpack", () => {
    expect(archiveKind("soh-windows.zip")).toBe("zip");
    expect(archiveKind("soh-linux.tar.gz")).toBe("tar.gz");
    expect(archiveKind("soh.tgz")).toBe("tar.gz");
    expect(archiveKind("soh-x86_64.AppImage")).toBe("appimage");
    expect(archiveKind("soh.exe")).toBe("raw");
  });

  it("refuses formats GameStore cannot open rather than download them anyway", () => {
    expect(archiveKind("soh-mac.dmg")).toBeNull();
    expect(archiveKind("soh.7z")).toBeNull();
    expect(archiveKind("soh.rar")).toBeNull();
    expect(archiveKind("soh.deb")).toBeNull();
  });
});

describe("selectReleaseAsset", () => {
  const assets = [
    { name: "SoH-windows-x64.zip", downloadUrl: "https://x/win.zip", size: 100 },
    { name: "SoH-linux-x64.AppImage", downloadUrl: "https://x/lin.AppImage", size: 90 },
    { name: "SoH-macos-universal.zip", downloadUrl: "https://x/mac.zip", size: 95 },
    { name: "SoH-Setup.exe", downloadUrl: "https://x/setup.exe", size: 80 },
    { name: "checksums.sha256", downloadUrl: "https://x/checksums.sha256", size: 1 },
    { name: "source-code.zip", downloadUrl: "https://x/src.zip", size: 200 },
  ];

  it("picks the archive naming the requested OS, never a same-shaped file for another OS", () => {
    expect(selectReleaseAsset(assets, "windows")?.name).toBe("SoH-windows-x64.zip");
    expect(selectReleaseAsset(assets, "mac")?.name).toBe("SoH-macos-universal.zip");
  });

  it("prefers an AppImage over a same-OS zip on Linux", () => {
    expect(selectReleaseAsset(assets, "linux")?.name).toBe("SoH-linux-x64.AppImage");
  });

  it("excludes noise and source archives from consideration", () => {
    const onlyNoise = [assets[4], assets[5]];
    expect(selectReleaseAsset(onlyNoise, "windows")).toBeNull();
  });

  it("excludes foreign-platform assets like Android or Switch", () => {
    const foreign = [{ name: "soh-android.apk", downloadUrl: "https://x/a.apk", size: 10 }];
    expect(selectReleaseAsset(foreign, "windows")).toBeNull();
  });

  it("refuses an asset GameStore cannot unpack even if it names the right OS", () => {
    const macOnly = [{ name: "soh-windows.7z", downloadUrl: "https://x/w.7z", size: 10 }];
    expect(selectReleaseAsset(macOnly, "windows")).toBeNull();
  });

  it("returns null when nothing matches the target OS", () => {
    expect(selectReleaseAsset([assets[1]], "windows")).toBeNull();
  });
});

describe("portInstallDirectory", () => {
  it("uses a Windows path under the user's home", () => {
    expect(portInstallDirectory("windows", "C:\\Users\\dimo", "harbourmasters-shipwright"))
      .toBe("C:\\Users\\dimo\\GameStore\\ports\\harbourmasters-shipwright");
  });

  it("uses XDG data home on Linux, distinct from the emulator ROM tree", () => {
    expect(portInstallDirectory("linux", "/home/dimo", "harbourmasters-shipwright"))
      .toBe("/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright");
  });
});

describe("pickPortExecutable", () => {
  it("wins with an exact hint match regardless of depth", () => {
    const files = ["deps/tool.exe", "soh.exe", "nested/soh.exe"];
    expect(pickPortExecutable(files, "soh.exe")).toBe("soh.exe");
  });

  it("falls back to the shallowest candidate when there is no hint", () => {
    const files = ["assets/tool.exe", "game.exe"];
    expect(pickPortExecutable(files)).toBe("game.exe");
  });

  it("filters out installers, crash reporters and uninstallers", () => {
    const files = ["unins000.exe", "crashreporter.exe", "setup.exe", "game.exe"];
    expect(pickPortExecutable(files)).toBe("game.exe");
  });

  it("returns null when nothing launchable is present", () => {
    expect(pickPortExecutable(["readme.txt", "license.md"])).toBeNull();
  });
});

describe("buildPortLaunch", () => {
  it("starts the port from its own install directory so relative asset lookups resolve", () => {
    const launch = buildPortLaunch("linux", "/home/dimo/.local/share/GameStore/ports/soh", "soh.AppImage");
    expect(launch.exe).toBe('"/home/dimo/.local/share/GameStore/ports/soh/soh.AppImage"');
    expect(launch.startDir).toBe('"/home/dimo/.local/share/GameStore/ports/soh/"');
  });
});

describe("planPortInstall", () => {
  const entry: PlannablePort = {
    id: "harbourmasters-shipwright",
    title: "Ship of Harkinian",
    needsOriginalAssets: true,
    distributionKind: "github-releases",
    deployTargets: ["Windows", "Linux"],
    executableHint: "soh.exe",
  };
  const release: PortRelease = {
    tag: "v8.0",
    htmlUrl: "https://github.com/HarbourMasters/Shipwright/releases/tag/v8.0",
    assets: [{ name: "soh-linux-x64.zip", downloadUrl: "https://x/soh.zip", size: 12345 }],
  };

  it("collects every blocker instead of stopping at the first one", () => {
    const plan = planPortInstall({
      entry: { ...entry, deployTargets: ["Windows"] },
      targetOs: "linux",
      home: "/home/dimo",
      gameDataFiles: [],
      release: null,
    });
    expect(plan.ready).toBe(false);
    expect(plan.blockers.map((b) => b.kind)).toEqual(
      expect.arrayContaining(["no-published-binary", "unsupported-target", "missing-game-data"]),
    );
  });

  it("is ready when a release, a supported target and game data are all present", () => {
    const plan = planPortInstall({
      entry,
      targetOs: "linux",
      home: "/home/dimo",
      gameDataFiles: ["/library/oot.z64"],
      release,
    });
    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.installDirectory).toBe("/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright");
  });

  it("plans acquisition from a curated download source when the library has nothing", () => {
    const plan = planPortInstall({
      entry: { ...entry, downloadUrl: "https://minerva.example/oot" },
      targetOs: "linux",
      home: "/home/dimo",
      gameDataFiles: [],
      release,
    });
    expect(plan.blockers.find((b) => b.kind === "missing-game-data")).toBeUndefined();
    expect(plan.steps.find((s) => s.kind === "acquire-game-data")).toMatchObject({ source: "curated-download" });
  });

  it("names the required ROM revision when the missing-game-data blocker fires", () => {
    const plan = planPortInstall({
      entry: { ...entry, requiredRomRevision: "Majora's Mask US 1.0 (Z64)" },
      targetOs: "linux",
      home: "/home/dimo",
      gameDataFiles: [],
      release,
    });
    const blocker = plan.blockers.find((b) => b.kind === "missing-game-data");
    expect(blocker?.message).toContain("Majora's Mask US 1.0 (Z64)");
  });

  it("blocks when the release has no asset GameStore recognises for the target OS", () => {
    const plan = planPortInstall({
      entry,
      targetOs: "mac",
      home: "/Users/dimo",
      gameDataFiles: ["/library/oot.z64"],
      release,
    });
    expect(plan.blockers.some((b) => b.kind === "unsupported-target")).toBe(true);
  });

  it("summarizes a ready plan with its step count and destination", () => {
    const plan = planPortInstall({
      entry,
      targetOs: "linux",
      home: "/home/dimo",
      gameDataFiles: ["/library/oot.z64"],
      release,
    });
    expect(planSummary(plan)).toBe(`${plan.steps.length} steps — installs to ${plan.installDirectory}`);
  });

  it("summarizes a blocked plan with every blocker's message", () => {
    const plan = planPortInstall({
      entry: { ...entry, deployTargets: [] },
      targetOs: "linux",
      home: "/home/dimo",
      gameDataFiles: [],
      release: null,
    });
    expect(planSummary(plan)).toContain("has no published binary");
    expect(planSummary(plan)).toContain("no Linux build");
  });
});

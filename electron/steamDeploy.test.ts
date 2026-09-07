import { describe, expect, it, vi } from "vitest";
import {
  buildLaunch,
  closeSteamForDeploy,
  coreFile,
  deployToSteam,
  detectFlatpakBranch,
  listDeployedAppIds,
  parseSteamProbe,
  pickPrimaryRom,
  PORTS_COLLECTION,
  relativeTo,
  removeFromSteam,
  romDirectory,
  shortcutsFile,
  type SteamFileTransport,
} from "./steamDeploy";
import { decodeBinaryVdf, encodeBinaryVdf, shortcutAppId } from "./steamVdf";

const memoryTransport = (seed: Record<string, Buffer> = {}) => {
  const files = new Map<string, Buffer>(Object.entries({ "/home/dimo/.local/share/Steam/userdata/112233/config/cloudstorage/cloud-storage-namespace-1.json": Buffer.from("[]"), ...seed }));
  const directories: string[] = [];
  const uploads: [string, string][] = [];
  const transport: SteamFileTransport = {
    mkdirp: async (directory) => { directories.push(directory); },
    readFile: async (remote) => files.get(remote) ?? null,
    writeFile: async (remote, data) => { files.set(remote, data); },
    upload: async (local, remote) => { uploads.push([local, remote]); files.set(remote, Buffer.from(local)); },
  };
  return { transport, files, directories, uploads };
};

const account = { steamRoot: "/home/dimo/.local/share/Steam", accountId: "112233" };

describe("Steam discovery", () => {
  it("collapses the symlinked Linux install roots into one account", () => {
    const status = parseSteamProbe(
      "ACCOUNT|/home/dimo/.local/share/Steam|112233\nACCOUNT|/home/dimo/.local/share/Steam|112233\nHOME|/home/dimo\n",
    );
    expect(status.installed).toBe(true);
    expect(status.accounts).toEqual([{ steamRoot: "/home/dimo/.local/share/Steam", accountId: "112233" }]);
    expect(status.home).toBe("/home/dimo");
    expect(status.blockedReason).toBeUndefined();
  });

  it("reports a running Steam client so the caller can refuse to write", () => {
    const status = parseSteamProbe("ACCOUNT|/home/dimo/.local/share/Steam|112233\nRUNNING\nHOME|/home/dimo\n");
    expect(status.running).toBe(true);
  });

  it("refuses a Flatpak-only Steam instead of writing a shortcut it cannot promise will start", () => {
    const status = parseSteamProbe(
      "ACCOUNT|/home/dimo/.var/app/com.valvesoftware.Steam/.local/share/Steam|112233\nHOME|/home/dimo\n",
    );
    expect(status.installed).toBe(true);
    expect(status.blockedReason).toMatch(/Flatpak/);
  });

  it("says Steam is absent when no profile has a config folder", () => {
    const status = parseSteamProbe("HOME|/home/dimo\n");
    expect(status.installed).toBe(false);
    expect(status.blockedReason).toMatch(/Sign in to Steam/);
  });

  it("parses the Windows probe's registry-derived root", () => {
    const status = parseSteamProbe("ACCOUNT|C:\\Program Files (x86)\\Steam|445566\nHOME|C:\\Users\\dimo\n");
    expect(status.accounts[0]).toEqual({ steamRoot: "C:\\Program Files (x86)\\Steam", accountId: "445566" });
    expect(status.home).toBe("C:\\Users\\dimo");
  });
});

describe("Launch command", () => {
  it("points Linux at the same Flatpak core directory the core installer writes to", () => {
    expect(coreFile("linux", "/home/dimo", "swanstation"))
      .toBe("/home/dimo/.var/app/org.libretro.RetroArch/config/retroarch/cores/swanstation_libretro.so");
  });

  it("keeps Linux games inside RetroArch's own Flatpak tree so the sandbox can read them", () => {
    expect(romDirectory("linux", "/home/dimo", "PS1"))
      .toBe("/home/dimo/.var/app/org.libretro.RetroArch/config/retroarch/gamestore/PS1");
  });

  it("launches Linux through flatpak with the detected branch and forces fullscreen", () => {
    const launch = buildLaunch("linux", "/home/dimo", "kronos", "/home/dimo/game.chd", "beta");
    expect(launch.exe).toBe('"/usr/bin/flatpak"');
    expect(launch.launchOptions).toContain("run --branch=beta --arch=x86_64 org.libretro.RetroArch");
    expect(launch.launchOptions).toContain('-L "/home/dimo/.var/app/org.libretro.RetroArch/config/retroarch/cores/kronos_libretro.so"');
    expect(launch.launchOptions.endsWith('"/home/dimo/game.chd" --fullscreen')).toBe(true);
  });

  it("launches Windows from the winget RetroArch directory and forces fullscreen", () => {
    const launch = buildLaunch("windows", "C:\\Users\\dimo", "mupen64plus_next", "C:\\Users\\dimo\\GameStore\\roms\\N64\\z.z64");
    expect(launch.exe).toBe('"C:\\Users\\dimo\\AppData\\Local\\Programs\\RetroArch-Win64\\retroarch.exe"');
    expect(launch.startDir).toBe('"C:\\Users\\dimo\\AppData\\Local\\Programs\\RetroArch-Win64\\"');
    expect(launch.launchOptions).toContain("mupen64plus_next_libretro.dll");
    expect(launch.launchOptions.endsWith("--fullscreen")).toBe(true);
  });

  it("reads the installed Flatpak branch rather than assuming stable", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "org.libretro.RetroArch\tbeta\norg.kde.Platform\t6.7\n", stderr: "", code: 0 });
    expect(await detectFlatpakBranch(run)).toBe("beta");
  });

  it("falls back to stable when the branch cannot be read", async () => {
    expect(await detectFlatpakBranch(vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 1 }))).toBe("stable");
  });
});

describe("Primary ROM selection", () => {
  it("enters a multi-track disc through its cue sheet, not a raw track", () => {
    expect(pickPrimaryRom(["/l/Game (Track 1).bin", "/l/Game (Track 2).bin", "/l/Game.cue"])).toBe("/l/Game.cue");
  });

  it("enters a multi-disc set through its m3u", () => {
    expect(pickPrimaryRom(["/l/Game (Disc 1).cue", "/l/Game (Disc 2).cue", "/l/Game.m3u"])).toBe("/l/Game.m3u");
  });

  it("uses the single file when a game is one file", () => {
    expect(pickPrimaryRom(["/l/Zelda.z64"])).toBe("/l/Zelda.z64");
  });
});

describe("Deploying into shortcuts.vdf", () => {
  const request = {
    os: "linux" as const,
    home: "/home/dimo",
    account,
    appName: "NiGHTS into Dreams",
    platform: "SAT" as const,
    coreId: "kronos",
    localFiles: ["/library/NiGHTS (Track 1).bin", "/library/NiGHTS.cue"],
    localArtwork: "/cache/nights.jpg",
    now: new Date("2026-09-05T12:00:00Z"),
  };

  it("assigns the deployed app to its console collection and snapshots the store", async () => {
    const { transport, files } = memoryTransport();
    const beforeLibraryWrite = vi.fn().mockResolvedValue(undefined);
    const result = await deployToSteam({ ...request, beforeLibraryWrite }, transport);
    expect(beforeLibraryWrite).toHaveBeenCalledOnce();
    expect(result.collectionName).toBe("Saturn");
    expect(files.get(result.collectionBackupPath)).toEqual(Buffer.from("[]"));
    const rows = JSON.parse(files.get("/home/dimo/.local/share/Steam/userdata/112233/config/cloudstorage/cloud-storage-namespace-1.json")!.toString());
    expect(JSON.parse(rows[0][1].value).added).toContain(result.appId);
  });

  it("does not transfer or write shortcuts when collection storage is malformed", async () => {
    const { transport, uploads, files } = memoryTransport({
      "/home/dimo/.local/share/Steam/userdata/112233/config/cloudstorage/cloud-storage-namespace-1.json": Buffer.from("bad"),
    });
    await expect(deployToSteam(request, transport)).rejects.toThrow();
    expect(uploads).toEqual([]);
    expect(files.has(shortcutsFile("linux", account))).toBe(false);
  });

  it("transfers every file but points Steam at the cue sheet", async () => {
    const { transport, uploads } = memoryTransport();
    const result = await deployToSteam(request, transport);
    expect(uploads.map(([, remote]) => remote)).toContain("/home/dimo/.var/app/org.libretro.RetroArch/config/retroarch/gamestore/SAT/NiGHTS (Track 1).bin");
    expect(result.romPath).toBe("/home/dimo/.var/app/org.libretro.RetroArch/config/retroarch/gamestore/SAT/NiGHTS.cue");
  });

  it("keys the artwork by the same app id it writes into the shortcut", async () => {
    const { transport, files } = memoryTransport();
    const result = await deployToSteam(request, transport);
    expect(result.appId).toBe(shortcutAppId('"/usr/bin/flatpak"', "NiGHTS into Dreams"));
    expect(result.artworkPath).toBe(`/home/dimo/.local/share/Steam/userdata/112233/config/grid/${result.appId}p.jpg`);
    const written = decodeBinaryVdf(files.get(shortcutsFile("linux", account))!).value["0"] as Record<string, unknown>;
    expect((written.appid as number) >>> 0).toBe(result.appId);
    expect(written.icon).toBe(result.artworkPath);
  });

  it("preserves shortcuts GameStore did not create, including their unknown fields", async () => {
    const theirs = encodeBinaryVdf("shortcuts", {
      "0": { appid: 123, AppName: "Heroic", Exe: '"/usr/bin/heroic"', SomeNewSteamField: "keep" },
    });
    const { transport, files } = memoryTransport({ [shortcutsFile("linux", account)]: theirs });
    const result = await deployToSteam(request, transport);
    const root = decodeBinaryVdf(files.get(shortcutsFile("linux", account))!).value;
    expect(Object.keys(root)).toEqual(["0", "1"]);
    expect((root["0"] as Record<string, unknown>).SomeNewSteamField).toBe("keep");
    expect(result.shortcutCount).toBe(2);
    expect(result.replacedExisting).toBe(false);
  });

  it("snapshots the existing file before overwriting it", async () => {
    const theirs = encodeBinaryVdf("shortcuts", { "0": { appid: 123, AppName: "Heroic", Exe: '"/usr/bin/heroic"' } });
    const { transport, files } = memoryTransport({ [shortcutsFile("linux", account)]: theirs });
    const result = await deployToSteam(request, transport);
    expect(result.backupPath).toBe("/home/dimo/.local/share/Steam/userdata/112233/config/shortcuts.vdf.gamestore-2026-09-05T12-00-00-000Z.bak");
    expect(files.get(result.backupPath!)).toEqual(theirs);
  });

  it("updates its own entry in place instead of adding a duplicate on redeploy", async () => {
    const { transport, files } = memoryTransport();
    await deployToSteam(request, transport);
    const second = await deployToSteam({ ...request, coreId: "mednafen_saturn" }, transport);
    expect(second.replacedExisting).toBe(true);
    expect(second.shortcutCount).toBe(1);
    const written = decodeBinaryVdf(files.get(shortcutsFile("linux", account))!).value["0"] as Record<string, unknown>;
    expect(written.LaunchOptions).toContain("mednafen_saturn_libretro.so");
  });

  it("writes a first shortcuts.vdf with no backup when the target has none", async () => {
    const { transport } = memoryTransport();
    const result = await deployToSteam(request, transport);
    expect(result.backupPath).toBeNull();
    expect(result.shortcutCount).toBe(1);
  });

  it("refuses a game with no files rather than registering an unlaunchable tile", async () => {
    const { transport } = memoryTransport();
    await expect(deployToSteam({ ...request, localFiles: [] }, transport)).rejects.toThrow(/no files/i);
  });
});

describe("relativeTo", () => {
  it("keeps a file's path relative to the staging root", () => {
    expect(relativeTo("/staging/soh", "/staging/soh/assets/oot.otr")).toBe("assets/oot.otr");
  });

  it("normalizes Windows separators", () => {
    expect(relativeTo("C:\\staging\\soh", "C:\\staging\\soh\\soh.exe")).toBe("soh.exe");
  });

  it("falls back to the bare filename for a path outside the root", () => {
    expect(relativeTo("/staging/soh", "/elsewhere/soh.exe")).toBe("soh.exe");
  });

  it("falls back to the bare filename rather than let a path escape the root", () => {
    expect(relativeTo("/staging/soh", "/staging/soh/../../etc/passwd")).toBe("passwd");
  });
});

describe("Deploying a port", () => {
  const portRequest = {
    os: "linux" as const,
    home: "/home/dimo",
    account,
    appName: "Ship of Harkinian",
    localFiles: ["/staging/soh/soh.exe", "/staging/soh/assets/oot.otr"],
    now: new Date("2026-09-05T12:00:00Z"),
    port: {
      portId: "harbourmasters-shipwright",
      installDirectory: "/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright",
      sourceRoot: "/staging/soh",
      executable: "soh.exe",
    },
  };

  it("preserves the staged directory tree instead of flattening it into one folder", async () => {
    const { transport, uploads } = memoryTransport();
    await deployToSteam(portRequest, transport);
    expect(uploads.map(([, remote]) => remote)).toEqual([
      "/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright/soh.exe",
      "/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright/assets/oot.otr",
    ]);
  });

  it("launches the port's own executable with the install directory as its working directory", async () => {
    const { transport, files } = memoryTransport();
    const result = await deployToSteam(portRequest, transport);
    const written = decodeBinaryVdf(files.get(shortcutsFile("linux", account))!).value["0"] as Record<string, unknown>;
    expect(written.Exe).toBe('"/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright/soh.exe"');
    expect(written.StartDir).toBe('"/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright/"');
    expect(result.romPath).toBe("/home/dimo/.local/share/GameStore/ports/harbourmasters-shipwright/soh.exe");
  });

  it("joins the shared Ports collection rather than a per-console one", async () => {
    const { transport } = memoryTransport();
    const result = await deployToSteam(portRequest, transport);
    expect(result.collectionName).toBe(PORTS_COLLECTION);
    expect(result.collectionName).toBe("Ports");
  });

  it("requires both a platform and a core for an emulator deploy with no port", async () => {
    const { transport } = memoryTransport();
    await expect(
      deployToSteam({ ...portRequest, port: undefined, platform: undefined, coreId: undefined }, transport),
    ).rejects.toThrow(/platform and a core/i);
  });
});

describe("Removing and listing", () => {
  it("removes only the requested shortcut and keeps the rest", async () => {
    const request = {
      os: "linux" as const, home: "/home/dimo", account, appName: "Metal Gear Solid",
      platform: "PS1" as const, coreId: "swanstation", localFiles: ["/library/mgs.chd"],
    };
    const theirs = encodeBinaryVdf("shortcuts", { "0": { appid: 123, AppName: "Heroic", Exe: '"/usr/bin/heroic"' } });
    const { transport, files } = memoryTransport({ [shortcutsFile("linux", account)]: theirs });
    const deployed = await deployToSteam(request, transport);
    const removal = await removeFromSteam("linux", account, deployed.appId, transport);
    expect(removal.removed).toBe(true);
    expect(removal.shortcutCount).toBe(1);
    const remaining = decodeBinaryVdf(files.get(shortcutsFile("linux", account))!).value["0"] as Record<string, unknown>;
    expect(remaining.AppName).toBe("Heroic");
  });

  it("lists what is already deployed so the UI does not have to guess", async () => {
    const theirs = encodeBinaryVdf("shortcuts", { "0": { appid: 123, AppName: "Heroic", Exe: '"/usr/bin/heroic"' } });
    const { transport } = memoryTransport({ [shortcutsFile("linux", account)]: theirs });
    expect(await listDeployedAppIds("linux", account, transport)).toEqual([{ appId: 123, appName: "Heroic" }]);
  });

  it("reports nothing deployed when the target has no shortcuts file at all", async () => {
    const { transport } = memoryTransport();
    expect(await listDeployedAppIds("linux", account, transport)).toEqual([]);
  });
});


describe("Destination Steam shutdown", () => {
  const result = (stdout: string, code = 0) => ({ stdout, stderr: "", code });
  it("does not start Steam when it is already stopped", async () => {
    const run = vi.fn().mockResolvedValue(result("STOPPED"));
    expect(await closeSteamForDeploy("linux", run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it.each(["linux", "windows"] as const)("requests graceful shutdown on %s and waits for exit", async (os) => {
    const run = vi.fn().mockResolvedValueOnce(result("RUNNING")).mockResolvedValueOnce(result(""))
      .mockResolvedValueOnce(result("RUNNING")).mockResolvedValueOnce(result("STOPPED"));
    const delay = vi.fn().mockResolvedValue(undefined);
    expect(await closeSteamForDeploy(os, run, delay)).toBe(true);
    expect(run.mock.calls[1][0]).toContain("-shutdown");
    expect(delay).toHaveBeenCalledWith(1000);
  });
  it("stops without killing the client when it refuses to exit", async () => {
    const run = vi.fn().mockResolvedValue(result("RUNNING"));
    await expect(closeSteamForDeploy("linux", run, async () => {})).rejects.toThrow(/still running/);
    expect(run.mock.calls.every(([command]) => !command.includes("kill"))).toBe(true);
  });
  it("refuses an inconclusive process probe", async () => {
    await expect(closeSteamForDeploy("linux", vi.fn().mockResolvedValue(result("", 1)))).rejects.toThrow(/Could not verify/);
  });
});

import { readRegistry, saveRegistry, upsertGame, type ManagedGame } from "./managedSteam";
import { platformCollection, prepareCollection } from "./steamCollections";
import { buildPortLaunch } from "./portsPipeline";
import type { PcOs, RunCommand } from "./pcTarget";
import type { RetroPlatform } from "./retroArchCores";
import { decodeBinaryVdf, encodeBinaryVdf, shortcutAppId, unsignedAppId, type VdfMap } from "./steamVdf";

/**
 * Writing a game into somebody's Steam library is the first thing GameStore
 * does that edits a file another program owns and rewrites on its own
 * schedule. Every decision here follows from that: the target's Steam install
 * is discovered rather than assumed, `shortcuts.vdf` is round-tripped instead
 * of regenerated, a snapshot is taken before every write, and a running Steam
 * client is treated as a hard block because it holds the file in memory and
 * would overwrite our entry on exit.
 */

export type SteamAccount = { steamRoot: string; accountId: string };

export type SteamStatus = {
  installed: boolean;
  running: boolean;
  accounts: SteamAccount[];
  /** Set when GameStore found Steam but refuses to deploy, with the reason. */
  blockedReason?: string;
};

export const joinPath = (os: PcOs, ...parts: string[]) => {
  const separator = os === "windows" ? "\\" : "/";
  return parts
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((part, index) => index === 0 || part.length > 0)
    .join(separator);
};

const FLATPAK_STEAM = "com.valvesoftware.Steam";

/**
 * Locates Steam on the target and reports whether it is safe to write to.
 *
 * The Linux probe walks the real install roots rather than one canonical
 * guess, because `~/.steam/steam` is a symlink on some distributions and the
 * genuine directory on others; `readlink -f` collapses the duplicates so the
 * same account is not offered twice. Account `0` is Steam's own placeholder
 * and never a real profile.
 */
export const findSteam = async (os: PcOs, run: RunCommand): Promise<SteamStatus> => {
  if (os === "mac") return { installed: false, running: false, accounts: [], blockedReason: "GameStore does not deploy to macOS Steam yet." };
  const command = os === "windows" ? WINDOWS_PROBE : LINUX_PROBE;
  const result = await run(command).catch(() => ({ stdout: "", stderr: "", code: 1 }));
  return parseSteamProbe(result.stdout);
};

const LINUX_PROBE = [
  'for r in "$HOME/.local/share/Steam" "$HOME/.steam/steam" "$HOME/.steam/root" "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam"; do',
  '[ -d "$r/userdata" ] || continue;',
  'real=$(readlink -f "$r");',
  'for u in "$r"/userdata/*; do',
  '[ -d "$u/config" ] || continue;',
  'id=$(basename "$u");',
  '[ "$id" = "0" ] && continue;',
  'echo "ACCOUNT|$real|$id";',
  "done; done;",
  'pgrep -x steam >/dev/null 2>&1 && echo RUNNING;',
  'echo "HOME|$HOME"; exit 0',
].join(" ");

const WINDOWS_PROBE = [
  "powershell -NoProfile -Command \"$ErrorActionPreference='SilentlyContinue';",
  "$p=(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -Name SteamPath).SteamPath;",
  "if($p){$p=$p -replace '/','\\';",
  "Get-ChildItem (Join-Path $p 'userdata') -Directory |",
  "Where-Object {$_.Name -ne '0' -and (Test-Path (Join-Path $_.FullName 'config'))} |",
  "ForEach-Object { 'ACCOUNT|' + $p + '|' + $_.Name }};",
  "if(Get-Process steam){'RUNNING'};",
  "'HOME|' + $env:USERPROFILE\"",
].join(" ");

/** Pure parse of either probe's output, so both shells are tested the same way. */
export const parseSteamProbe = (stdout: string): SteamStatus & { home?: string } => {
  const accounts: SteamAccount[] = [];
  let running = false;
  let home: string | undefined;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "RUNNING") { running = true; continue; }
    if (line.startsWith("HOME|")) { home = line.slice(5).trim() || undefined; continue; }
    if (!line.startsWith("ACCOUNT|")) continue;
    const [, steamRoot, accountId] = line.split("|");
    if (!steamRoot || !accountId) continue;
    if (accounts.some((a) => a.steamRoot === steamRoot && a.accountId === accountId)) continue;
    accounts.push({ steamRoot, accountId });
  }
  if (!accounts.length) return { installed: false, running, accounts, home, blockedReason: "No Steam profile with a config folder was found on this machine. Sign in to Steam once, then check again." };
  if (accounts.some((a) => a.steamRoot.includes(FLATPAK_STEAM)) && accounts.every((a) => a.steamRoot.includes(FLATPAK_STEAM)))
    return { installed: true, running, accounts, home, blockedReason: "This machine runs Steam as a Flatpak. GameStore has not verified launching a Flatpak RetroArch from inside the Flatpak Steam sandbox, so it will not write a shortcut it cannot promise will start." };
  return { installed: true, running, accounts, home };
};

export const steamConfigDir = (os: PcOs, account: SteamAccount) =>
  joinPath(os, account.steamRoot, "userdata", account.accountId, "config");
export const shortcutsFile = (os: PcOs, account: SteamAccount) =>
  joinPath(os, steamConfigDir(os, account), "shortcuts.vdf");
export const gridDir = (os: PcOs, account: SteamAccount) =>
  joinPath(os, steamConfigDir(os, account), "grid");

const LINUX_RETRO_ROOT = ".var/app/org.libretro.RetroArch/config/retroarch";
const WINDOWS_RETRO_ROOT = "AppData\\Local\\Programs\\RetroArch-Win64";

/** Where the core files the core-management step installs actually live. */
export const coreFile = (os: PcOs, home: string, coreId: string) =>
  os === "windows"
    ? joinPath(os, home, WINDOWS_RETRO_ROOT, "cores", `${coreId}_libretro.dll`)
    : joinPath(os, home, LINUX_RETRO_ROOT, "cores", `${coreId}_libretro.so`);

/**
 * Where transferred games land on the target.
 *
 * On Linux this deliberately sits inside RetroArch's own Flatpak tree next to
 * the cores. A Flatpak app cannot read arbitrary host paths, but its own
 * `~/.var/app/<id>` directory is mounted into the sandbox at that same path,
 * so a game written here is readable by the emulator that has to open it —
 * which a game dropped in `~/Games` would not reliably be.
 */
export const romDirectory = (os: PcOs, home: string, platform: RetroPlatform | "X360") =>
  platform === "X360"
    ? joinPath(os, home, "GameStore", "roms", platform)
    : os === "windows"
      ? joinPath(os, home, "GameStore", "roms", platform)
      : joinPath(os, home, LINUX_RETRO_ROOT, "gamestore", platform);

const PRIMARY_ORDER = [".m3u", ".cue", ".chd", ".pbp", ".iso", ".ccd", ".z64", ".n64", ".v64", ".bin", ".img"];

/**
 * Picks the one file RetroArch should be handed.
 *
 * A disc game is several files and only one of them is the entry point:
 * loading a raw `.bin` from a multi-track dump skips the track layout the
 * `.cue` describes, and a multi-disc set has to enter through its `.m3u` or
 * disc swapping never works. Ordering by container-ness rather than by
 * filename is what keeps that correct.
 */
export const pickPrimaryRom = (files: string[]): string => {
  const base = (file: string) => file.replace(/\\/g, "/").split("/").pop() ?? file;
  const extension = (file: string) => {
    const name = base(file);
    const dot = name.lastIndexOf(".");
    return dot < 0 ? "" : name.slice(dot).toLowerCase();
  };
  const ranked = [...files].sort((a, b) => {
    const rankA = PRIMARY_ORDER.indexOf(extension(a));
    const rankB = PRIMARY_ORDER.indexOf(extension(b));
    return (rankA < 0 ? PRIMARY_ORDER.length : rankA) - (rankB < 0 ? PRIMARY_ORDER.length : rankB);
  });
  const chosen = ranked[0];
  if (!chosen) throw new Error("This game has no files to send.");
  return chosen;
};

export type SteamLaunch = { exe: string; startDir: string; launchOptions: string };

/**
 * Builds the Steam shortcut's command line.
 *
 * `--fullscreen` is passed on every launch rather than relying on RetroArch's
 * saved video setting, because the setting is global and a user who last ran
 * RetroArch windowed would otherwise get a windowed game from a Steam tile
 * they launched from the couch.
 */
export const buildLaunch = (
  os: PcOs,
  home: string,
  coreId: string,
  romPath: string,
  flatpakBranch = "stable",
): SteamLaunch => {
  if (coreId === "xenia") {
    const xeniaRoot = os === "windows"
      ? joinPath(os, home, "AppData", "Local", "GameStore", "Xenia Canary")
      : joinPath(os, home, ".local", "opt", "xenia-canary");
    const exe = os === "windows"
      ? joinPath(os, xeniaRoot, "xenia_canary.exe")
      : joinPath(os, xeniaRoot, "xenia_canary.AppImage");
    return { exe: `"${exe}"`, startDir: `"${xeniaRoot}${os === "windows" ? "\\" : "/"}"`, launchOptions: `"${romPath}"` };
  }
  const core = coreFile(os, home, coreId);
  if (os === "windows") {
    const retroRoot = joinPath(os, home, WINDOWS_RETRO_ROOT);
    return {
      exe: `"${joinPath(os, retroRoot, "retroarch.exe")}"`,
      startDir: `"${retroRoot}\\"`,
      launchOptions: `-L "${core}" "${romPath}" --fullscreen`,
    };
  }
  return {
    exe: '"/usr/bin/flatpak"',
    startDir: '"/usr/bin/"',
    launchOptions: `run --branch=${flatpakBranch} --arch=x86_64 org.libretro.RetroArch -L "${core}" "${romPath}" --fullscreen`,
  };
};

export type SteamFileTransport = {
  mkdirp(directory: string): Promise<void>;
  readFile(remote: string): Promise<Buffer | null>;
  writeFile(remote: string, data: Buffer): Promise<void>;
  upload(localPath: string, remote: string): Promise<void>;
};

/**
 * Set when the thing being deployed is a Ports entry rather than a ROM.
 *
 * A port is a directory tree that launches its own executable, so both halves
 * of the emulator assumption stop holding: there is no core to point at, and
 * the upload has to preserve the archive's internal layout instead of
 * flattening every file into one ROM folder. Its presence switches both.
 */
export type SteamPortDeploy = {
  portId: string;
  /** Destination root on the target, from `portInstallDirectory`. */
  installDirectory: string;
  /** Local staging root; each file's path relative to this is preserved. */
  sourceRoot: string;
  /** Executable to launch, relative to `installDirectory`. */
  executable: string;
};

export type SteamDeployRequest = {
  os: PcOs;
  home: string;
  account: SteamAccount;
  appName: string;
  management?: { kind?: "recomp" | "decomp" | "port"; platform?: string; version?: string; projectUrl?: string };
  /** Emulator deployments only — a port launches itself and belongs to no console. */
  platform?: RetroPlatform | "X360";
  coreId?: string;
  /** Absolute paths on the machine GameStore itself is running on. */
  localFiles: string[];
  /** Cached cover image on the GameStore host, used as the library capsule. */
  localArtwork?: string;
  flatpakBranch?: string;
  now?: Date;
  beforeLibraryWrite?: () => Promise<void>;
  /** Present for Ports installs; absent for emulator ROM deployments. */
  port?: SteamPortDeploy;
};

export type SteamDeployResult = {
  appId: number;
  appName: string;
  collectionName: string;
  collectionBackupPath: string;
  romPath: string;
  backupPath: string | null;
  artworkPath: string | null;
  replacedExisting: boolean;
  shortcutCount: number;
};

const baseName = (file: string) => file.replace(/\\/g, "/").split("/").pop() ?? file;

/** Steam collection every installed port joins, alongside the per-console ones. */
export const PORTS_COLLECTION = "Ports";

/**
 * Path of `file` relative to `root`, normalized to forward slashes.
 *
 * Falls back to the bare filename when the file sits outside the staging root,
 * so an unexpected path installs flat rather than escaping the destination with
 * a `../` that would write outside the port's directory.
 */
export const relativeTo = (root: string, file: string): string => {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRoot = normalize(root);
  const normalizedFile = normalize(file);
  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) return baseName(file);
  const relative = normalizedFile.slice(normalizedRoot.length + 1);
  return relative.includes("../") ? baseName(file) : relative;
};

const shortcutEntry = (appName: string, appId: number, launch: SteamLaunch, iconPath: string): VdfMap => ({
  appid: appId,
  AppName: appName,
  Exe: launch.exe,
  StartDir: launch.startDir,
  icon: iconPath,
  ShortcutPath: "",
  LaunchOptions: launch.launchOptions,
  IsHidden: 0,
  AllowDesktopConfig: 1,
  AllowOverlay: 1,
  OpenVR: 0,
  Devkit: 0,
  DevkitGameID: "",
  DevkitOverrideAppID: 0,
  LastPlayTime: 0,
  FlatpakAppID: "",
  tags: {},
});

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-");

/**
 * Sends a game to the target and registers it in Steam.
 *
 * The existing `shortcuts.vdf` is decoded, edited, and re-encoded rather than
 * replaced, so shortcuts this app did not create — and fields newer Steam
 * clients may have added to them — survive the write untouched.
 */
export const deployToSteam = async (
  request: SteamDeployRequest,
  transport: SteamFileTransport,
): Promise<SteamDeployResult> => {
  const { os, home, account, appName, platform, coreId, localFiles } = request;
  if (!localFiles.length) throw new Error("This game has no files to send.");
  const now = request.now ?? new Date();
  const registryFile = joinPath(os, steamConfigDir(os, account), "gamestore-managed.json");
  let registry = await readRegistry(registryFile, transport);

  const port = request.port;
  if (!port && (!platform || !coreId)) {
    throw new Error("An emulator deployment needs both a platform and a core.");
  }
  const romDir = port ? port.installDirectory : romDirectory(os, home, platform!);
  const romPath = port
    ? joinPath(os, port.installDirectory, port.executable)
    : joinPath(os, romDir, baseName(pickPrimaryRom(localFiles)));

  const launch = port
    ? buildPortLaunch(os, port.installDirectory, port.executable)
    : buildLaunch(os, home, coreId!, romPath, request.flatpakBranch);
  const appId = shortcutAppId(launch.exe, appName);
  const collectionName = port ? PORTS_COLLECTION : platformCollection(platform!);
  const collection = await prepareCollection(
    joinPath(os, steamConfigDir(os, account), "cloudstorage"), os === "windows" ? "\\" : "/",
    collectionName, appId, transport, now,
  );
  await transport.mkdirp(romDir);
  if (port) {
    // Directory layout is load-bearing for a port: its executable resolves
    // assets, config and saves by relative path, so flattening the tree the way
    // ROM uploads do would install something that starts and then cannot find
    // itself. Parent directories are created before each file for the same
    // reason plain `mkdirp(romDir)` is not enough here.
    const created = new Set<string>([port.installDirectory]);
    for (const file of localFiles) {
      const relative = relativeTo(port.sourceRoot, file);
      const destination = joinPath(os, port.installDirectory, relative);
      const parent = destination.slice(0, Math.max(destination.lastIndexOf(os === "windows" ? "\\" : "/"), 0));
      if (parent && !created.has(parent)) {
        await transport.mkdirp(parent);
        created.add(parent);
      }
      await transport.upload(file, destination);
    }
  } else {
    for (const file of localFiles) await transport.upload(file, joinPath(os, romDir, baseName(file)));
  }

  let artworkPath: string | null = null;
  if (request.localArtwork) {
    const extension = (baseName(request.localArtwork).match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
    const grid = gridDir(os, account);
    await transport.mkdirp(grid);
    // `<appid>p` is the portrait library capsule — the tile the user actually
    // looks at. The plain `<appid>` wide capsule is deliberately left alone
    // rather than filled with a stretched portrait.
    artworkPath = joinPath(os, grid, `${appId}p${extension}`);
    await transport.upload(request.localArtwork, artworkPath);
  }

  await request.beforeLibraryWrite?.();
  const shortcutsPath = shortcutsFile(os, account);
  const existing = await transport.readFile(shortcutsPath);
  let backupPath: string | null = null;
  if (existing) {
    backupPath = `${shortcutsPath}.gamestore-${stamp(now)}.bak`;
    await transport.writeFile(backupPath, existing);
  }

  const root: VdfMap = existing ? decodeBinaryVdf(existing).value : {};
  const entries = Object.values(root).filter((value): value is VdfMap => typeof value === "object" && value !== null);
  const entry = shortcutEntry(appName, appId, launch, artworkPath ?? "");
  const matches = (candidate: VdfMap) =>
    (typeof candidate.appid === "number" && unsignedAppId(candidate.appid) === appId) ||
    (candidate.AppName === appName && candidate.Exe === launch.exe);
  const replacedExisting = entries.some(matches);
  const merged = entries.map((candidate) => (matches(candidate) ? { ...candidate, ...entry, tags: candidate.tags ?? entry.tags } : candidate));
  if (!replacedExisting) merged.push(entry);

  const rebuilt: VdfMap = {};
  merged.forEach((value, index) => { rebuilt[String(index)] = value; });
  const managed: ManagedGame = {
    appId, title: appName, kind: port ? request.management?.kind ?? "port" : "emulated",
    platform: platform ?? request.management?.platform ?? "Unknown", coreId, portId: port?.portId,
    version: request.management?.version, projectUrl: request.management?.projectUrl,
    location: port ? port.installDirectory : romPath, collection: collectionName,
    installedAt: now.toISOString(), updatedAt: now.toISOString(), deployment: "pending", shortcut: merged.find(matches)!,
  };
  registry = upsertGame(registry, managed);
  await saveRegistry(registryFile, registry, transport);
  await transport.writeFile(shortcutsPath, encodeBinaryVdf("shortcuts", rebuilt));

  let collectionBackupPath: string;
  try { collectionBackupPath = await collection.commit(); }
  catch (error) {
    throw new Error(`Game files and Steam shortcut were written, but collection assignment failed. Retry deployment after closing Steam. ${error instanceof Error ? error.message : String(error)}`);
  }
  await saveRegistry(registryFile, upsertGame(registry, { ...managed, deployment: "ready" }), transport);
  return { appId, appName, collectionName, collectionBackupPath, romPath, backupPath, artworkPath, replacedExisting, shortcutCount: merged.length };
};

/** Removes a GameStore-written shortcut, leaving every other entry in place. */
export const removeFromSteam = async (
  os: PcOs,
  account: SteamAccount,
  appId: number,
  transport: SteamFileTransport,
  now = new Date(),
): Promise<{ removed: boolean; shortcutCount: number; backupPath: string | null }> => {
  const shortcutsPath = shortcutsFile(os, account);
  const existing = await transport.readFile(shortcutsPath);
  if (!existing) return { removed: false, shortcutCount: 0, backupPath: null };
  const backupPath = `${shortcutsPath}.gamestore-${stamp(now)}.bak`;
  await transport.writeFile(backupPath, existing);

  const root = decodeBinaryVdf(existing).value;
  const entries = Object.values(root).filter((value): value is VdfMap => typeof value === "object" && value !== null);
  const kept = entries.filter((entry) => !(typeof entry.appid === "number" && unsignedAppId(entry.appid) === appId));
  const rebuilt: VdfMap = {};
  kept.forEach((value, index) => { rebuilt[String(index)] = value; });
  await transport.writeFile(shortcutsPath, encodeBinaryVdf("shortcuts", rebuilt));
  return { removed: kept.length !== entries.length, shortcutCount: kept.length, backupPath };
};

/** Lists the app IDs currently present, so the UI can show what is deployed. */
export const listDeployedAppIds = async (
  os: PcOs,
  account: SteamAccount,
  transport: SteamFileTransport,
): Promise<{ appId: number; appName: string }[]> => {
  const existing = await transport.readFile(shortcutsFile(os, account));
  if (!existing) return [];
  const root = decodeBinaryVdf(existing).value;
  return Object.values(root)
    .filter((value): value is VdfMap => typeof value === "object" && value !== null)
    .filter((entry) => typeof entry.appid === "number" && typeof entry.AppName === "string")
    .map((entry) => ({ appId: unsignedAppId(entry.appid as number), appName: entry.AppName as string }));
};

/** Reads the installed Flatpak RetroArch branch so `flatpak run` is unambiguous. */
export const detectFlatpakBranch = async (run: RunCommand): Promise<string> => {
  const result = await run("flatpak list --app --columns=application,branch").catch(() => ({ stdout: "", stderr: "", code: 1 }));
  const line = result.stdout.split(/\r?\n/).find((row) => row.trim().startsWith("org.libretro.RetroArch"));
  const branch = line?.split(/\s+/)[1]?.trim();
  return branch || "stable";
};

/** Ask the selected target's client to exit normally; never kill Steam. */
export async function closeSteamForDeploy(
  os: PcOs,
  run: RunCommand,
  delay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  if (os === 'mac') throw new Error('Steam deployment is not supported on macOS.');
  const probe = os === 'windows'
    ? `powershell -NoProfile -Command "if(Get-Process steam -ErrorAction SilentlyContinue){'RUNNING'}else{'STOPPED'}"`
    : `pgrep -x steam >/dev/null 2>&1; code=$?; if [ "$code" = 0 ]; then echo RUNNING; elif [ "$code" = 1 ]; then echo STOPPED; else exit "$code"; fi`;
  const running = async () => {
    const result = await run(probe);
    if (result.code !== 0 || !['RUNNING', 'STOPPED'].includes(result.stdout.trim()))
      throw new Error('Could not verify whether Steam is running on the destination. No library changes were made.');
    return result.stdout.trim() === 'RUNNING';
  };
  if (!await running()) return false;
  const command = os === 'windows'
    ? `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $p=(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -Name SteamPath).SteamPath; if(!$p){throw 'Steam path not found'}; Start-Process -FilePath (Join-Path $p 'steam.exe') -ArgumentList '-shutdown'"`
    : 'steam -shutdown';
  const result = await run(command);
  if (result.code !== 0) throw new Error('Steam did not accept the shutdown request on the destination. Close it there and retry.');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!await running()) return true;
    await delay(1000);
  }
  throw new Error('Steam is still running on the destination after 30 seconds. Finish any game or Steam dialog there, then retry. No library changes were made.');
}

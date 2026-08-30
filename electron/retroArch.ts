/**
 * Detecting and updating RetroArch on a PC deploy target.
 *
 * Linux is the real, currently-verified target (DiMo's actual PC is Bazzite,
 * which — like most immutable/atomic distros — installs desktop apps via
 * Flatpak rather than a native package manager), so that path uses Flatpak's
 * machine-parseable `--columns` output and is unit tested against realistic
 * fixtures. Windows uses winget, whose default output is a human-formatted
 * table rather than a stable machine format; that parser is a best-effort
 * reading of the same table winget itself prints, not a guarantee, and is
 * explicitly called out as such — this pass has no real Windows target to
 * verify it against, unlike the Linux path.
 */
import type { CommandResult, PcOs, RunCommand } from "./pcTarget";

export type RetroArchInstallMethod = "flatpak" | "winget" | "path";
export type RetroArchReleaseChannel = "stable" | "nightly";

export type RetroArchStatus = {
  installed: boolean;
  method?: RetroArchInstallMethod;
  version?: string;
  updateAvailable?: boolean;
  latestVersion?: string;
  flatpakScope?: "user" | "system";
  /**
   * Set when GameStore has deliberately decided not to attempt an automatic
   * update — e.g. a RetroArch copy installed through Steam shows up to
   * winget with an "Unknown" version, and running `winget upgrade` on it
   * installs a second, separate copy rather than updating the existing one
   * (a real, documented winget-pkgs issue). Refusing beats guessing wrong.
   */
  updateBlockedReason?: string;
};

const FLATPAK_APP_ID = "org.libretro.RetroArch";
const FLATPAK_REMOTE = "flathub";
const WINGET_ID = "Libretro.RetroArch";
const FLATHUB_BETA_REPO = "https://flathub.org/beta-repo/flathub-beta.flatpakrepo";
const WINDOWS_NIGHTLY_INSTALLER =
  "https://buildbot.libretro.com/nightly/windows/x86_64/RetroArch-Win64-setup.exe";

/** Pure parse of `flatpak list --app --columns=application,version`. */
export const parseFlatpakList = (stdout: string): Map<string, string> => {
  const apps = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const [appId, version] = line.split("\t").map((part) => part.trim());
    if (appId) apps.set(appId, version || "");
  }
  return apps;
};

/** Pure parse of the `Version:` line from `flatpak remote-info <remote> <app-id>`. */
export const parseFlatpakRemoteInfoVersion = (stdout: string): string | undefined =>
  /^\s*Version:\s*(\S+)/m.exec(stdout)?.[1];

/**
 * Pure, best-effort parse of `winget list --id <id> --exact`. Winget prints a
 * whitespace-aligned human table (Name / Id / Version / Available / Source)
 * whose exact spacing shifts with terminal width and locale, so this looks
 * for the row containing the exact package id and reads version-shaped
 * tokens from it rather than depending on fixed column offsets. Two such
 * tokens on that row means winget itself is showing an available upgrade
 * (the "Available" column). A row reporting "Unknown" instead of a version
 * is the real, documented sign of a Steam-managed copy.
 */
export const parseWingetList = (
  stdout: string,
): { found: boolean; version?: string; latestVersion?: string; versionUnknown: boolean } => {
  const line = stdout.split("\n").find((candidate) => candidate.includes(WINGET_ID));
  if (!line) return { found: false, versionUnknown: false };
  if (/\bUnknown\b/i.test(line)) return { found: true, versionUnknown: true };
  const versions = [...line.matchAll(/\d+(?:\.\d+){1,3}/g)].map((match) => match[0]);
  return { found: true, versionUnknown: false, version: versions[0], latestVersion: versions[1] };
};

const runOk = async (run: RunCommand, command: string): Promise<CommandResult> =>
  run(command).catch(() => ({ stdout: "", stderr: "", code: 1 }));

const checkLinuxRetroArch = async (run: RunCommand): Promise<RetroArchStatus> => {
  const userListing = await runOk(run, "flatpak list --user --app --columns=application,version");
  const userVersion = parseFlatpakList(userListing.stdout).get(FLATPAK_APP_ID);
  const systemListing = userVersion === undefined
    ? await runOk(run, "flatpak list --system --app --columns=application,version")
    : undefined;
  const systemVersion = systemListing
    ? parseFlatpakList(systemListing.stdout).get(FLATPAK_APP_ID)
    : undefined;
  const flatpakScope = userVersion !== undefined ? "user" : systemVersion !== undefined ? "system" : undefined;
  const installedVersion = userVersion ?? systemVersion;
  if (installedVersion !== undefined) {
    const remoteInfo = await runOk(run, `flatpak remote-info --${flatpakScope} ${FLATPAK_REMOTE} ${FLATPAK_APP_ID}`);
    const latestVersion = parseFlatpakRemoteInfoVersion(remoteInfo.stdout);
    if (!latestVersion)
      return {
        installed: true,
        method: "flatpak",
        flatpakScope,
        version: installedVersion,
        updateBlockedReason: `Could not read the latest version from the "${FLATPAK_REMOTE}" remote — it may not be configured on this machine.`,
      };
    return {
      installed: true,
      method: "flatpak",
      flatpakScope,
      version: installedVersion,
      latestVersion,
      updateAvailable: latestVersion !== installedVersion,
    };
  }

  // No Flatpak copy: fall back to a plain PATH install (AppImage extracted
  // onto PATH, a native distro package, or a manual build). GameStore has no
  // update mechanism for that case, since it does not know how it got there.
  const pathCheck = await runOk(run, "command -v retroarch");
  if (!pathCheck.stdout.trim()) return { installed: false };
  const versionOutput = await runOk(run, "retroarch --version");
  const version = /RetroArch\s+([\w.-]+)/i.exec(versionOutput.stdout)?.[1];
  return {
    installed: true,
    method: "path",
    version,
    updateBlockedReason: "Installed outside Flatpak — GameStore does not know how to update this copy automatically.",
  };
};

const checkWindowsRetroArch = async (run: RunCommand): Promise<RetroArchStatus> => {
  const listing = await runOk(run, `winget list --id ${WINGET_ID} --exact`);
  const parsed = parseWingetList(listing.stdout);
  if (parsed.found) {
    if (parsed.versionUnknown)
      return {
        installed: true,
        method: "winget",
        updateBlockedReason:
          "This copy's version is unreadable to winget, which usually means it was installed through Steam. Running a winget upgrade here would install a second, separate copy rather than updating this one, so GameStore will not attempt it.",
      };
    return {
      installed: true,
      method: "winget",
      version: parsed.version,
      latestVersion: parsed.latestVersion,
      updateAvailable: !!parsed.latestVersion && parsed.latestVersion !== parsed.version,
    };
  }

  const pathCheck = await runOk(
    run,
    'where retroarch.exe 2>nul || if exist "%LOCALAPPDATA%\\Programs\\RetroArch-Win64\\retroarch.exe" echo %LOCALAPPDATA%\\Programs\\RetroArch-Win64\\retroarch.exe',
  );
  if (!pathCheck.stdout.trim() || pathCheck.code !== 0) return { installed: false };
  return {
    installed: true,
    method: "path",
    updateBlockedReason: "Installed outside winget — GameStore does not know how to update this copy automatically.",
  };
};

export const checkRetroArch = (os: PcOs, run: RunCommand): Promise<RetroArchStatus> =>
  os === "windows" ? checkWindowsRetroArch(run) : checkLinuxRetroArch(run);

/** Installs the channel the user explicitly chose on the selected PC target. */
export const installRetroArch = async (
  os: PcOs,
  channel: RetroArchReleaseChannel,
  run: RunCommand,
): Promise<CommandResult> => {
  if (os === "mac") throw new Error("Automatic RetroArch installation is not supported on macOS yet.");
  if (os === "linux") {
    if (channel === "stable") {
      const result = await run(
        `flatpak install -y --noninteractive --user ${FLATPAK_REMOTE} ${FLATPAK_APP_ID}`,
      );
      if (result.code !== 0) throw new Error(result.stderr.trim() || "RetroArch stable installation failed.");
      return result;
    }
    const command = [
      `flatpak remote-add --if-not-exists --user flathub-beta ${FLATHUB_BETA_REPO}`,
      `flatpak install -y --noninteractive --user flathub-beta ${FLATPAK_APP_ID}`,
    ].join(" && ");
    const result = await run(command);
    if (result.code !== 0) throw new Error(result.stderr.trim() || "RetroArch nightly installation failed.");
    return result;
  }
  if (channel === "stable") {
    const result = await run(
      `winget install --id ${WINGET_ID} --exact --silent --accept-package-agreements --accept-source-agreements`,
    );
    if (result.code !== 0) throw new Error(result.stderr.trim() || "RetroArch stable installation failed.");
    return result;
  }
  const command =
    `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $p=Join-Path $env:TEMP 'RetroArch-Win64-nightly-setup.exe'; Invoke-WebRequest -UseBasicParsing '${WINDOWS_NIGHTLY_INSTALLER}' -OutFile $p; try { $proc=Start-Process -FilePath $p -ArgumentList '/S' -Wait -PassThru; if ($proc.ExitCode -ne 0) { throw ('Installer exited with code ' + $proc.ExitCode) } } finally { Remove-Item -Force -ErrorAction SilentlyContinue $p }"`;
  const result = await run(command);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "RetroArch nightly installation failed.");
  return result;
};

/** Applies a previously-detected update. Callers must have just gotten `updateAvailable: true` and a `method` from `checkRetroArch` — this never guesses at how something got installed. */
export const updateRetroArch = async (os: PcOs, method: RetroArchInstallMethod, run: RunCommand, flatpakScope: "user" | "system" = "user"): Promise<CommandResult> => {
  if (os !== "windows" && method === "flatpak") return run(`flatpak update -y --${flatpakScope} ${FLATPAK_APP_ID}`);
  if (os === "windows" && method === "winget")
    return run(`winget upgrade --id ${WINGET_ID} --exact --silent --accept-package-agreements --accept-source-agreements`);
  throw new Error("GameStore does not know how to update this RetroArch installation automatically.");
};

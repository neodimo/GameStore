/**
 * Xenia Canary lifecycle management. Xbox 360 has no libretro core, so it
 * needs a first-class standalone emulator path rather than a fake RetroArch
 * entry. Releases are obtained from the project's own GitHub releases.
 */
import type { CommandResult, PcOs, RunCommand } from "./pcTarget";

export type XeniaInstallMethod = "github-release" | "path";
export type XeniaStatus = {
  installed: boolean;
  method?: XeniaInstallMethod;
  version?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateBlockedReason?: string;
};

const RELEASE_API = "https://api.github.com/repos/xenia-canary/xenia-canary/releases/latest";
const LINUX_DIR = "$HOME/.local/opt/xenia-canary";
const WINDOWS_DIR = "%LOCALAPPDATA%\\GameStore\\Xenia Canary";

const runOk = async (run: RunCommand, command: string): Promise<CommandResult> =>
  run(command).catch(() => ({ stdout: "", stderr: "", code: 1 }));

const latestCommand = (os: PcOs) => os === "windows"
  ? `powershell -NoProfile -Command \"try { (Invoke-RestMethod -UseBasicParsing '${RELEASE_API}').tag_name } catch { exit 1 }\"`
  : `curl -fsSL '${RELEASE_API}' | sed -nE 's/^[[:space:]]*"tag_name"[[:space:]]*:[[:space:]]*"([^\"]+)".*/\\1/p' | head -n 1`;

const parseInstalled = (stdout: string) => {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[0] === "installed" ? lines[1] : undefined;
};

export const checkXenia = async (os: PcOs, run: RunCommand): Promise<XeniaStatus> => {
  if (os === "mac") return { installed: false, updateBlockedReason: "Xenia Canary does not publish a macOS build." };
  const installed = await runOk(run, os === "windows"
    ? `if exist "${WINDOWS_DIR}\\xenia_canary.exe" (echo installed & if exist "${WINDOWS_DIR}\\version.txt" type "${WINDOWS_DIR}\\version.txt")`
    : `if test -x "${LINUX_DIR}/xenia_canary.AppImage"; then echo installed; test -f "${LINUX_DIR}/version.txt" && cat "${LINUX_DIR}/version.txt"; fi`);
  const version = parseInstalled(installed.stdout);
  if (!/installed/m.test(installed.stdout)) return { installed: false };
  const latest = await runOk(run, latestCommand(os));
  const latestVersion = latest.stdout.trim() || undefined;
  return {
    installed: true,
    method: "github-release",
    version,
    latestVersion,
    updateAvailable: Boolean(latestVersion && version && latestVersion !== version),
    ...(latestVersion ? {} : { updateBlockedReason: "Could not read the latest Xenia Canary release from GitHub." }),
  };
};

const installCommand = (os: PcOs) => {
  if (os === "linux") return [
    "set -e",
    `d="${LINUX_DIR}"; mkdir -p "$d"`,
    `api='${RELEASE_API}'`,
    "tag=$(curl -fsSL \"$api\" | sed -nE 's/^[[:space:]]*\"tag_name\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/p' | head -n 1)",
    "url=$(curl -fsSL \"$api\" | sed -nE 's#^[[:space:]]*\"browser_download_url\"[[:space:]]*:[[:space:]]*\"([^\"]*xenia_canary_linux\\.AppImage)\".*#\\1#p' | head -n 1)",
    "test -n \"$tag\" -a -n \"$url\"",
    "tmp=$(mktemp); trap 'rm -f \"$tmp\"' EXIT",
    "curl -fL \"$url\" -o \"$tmp\"",
    "install -m 755 \"$tmp\" \"$d/xenia_canary.AppImage\"",
    "printf '%s\\n' \"$tag\" > \"$d/version.txt\"",
  ].join("; ");
  return `powershell -NoProfile -Command \"$ErrorActionPreference='Stop'; $d=Join-Path $env:LOCALAPPDATA 'GameStore\\Xenia Canary'; New-Item -ItemType Directory -Force -Path $d | Out-Null; $r=Invoke-RestMethod -UseBasicParsing '${RELEASE_API}'; $a=$r.assets | Where-Object { $_.name -eq 'xenia_canary_windows.7z' } | Select-Object -First 1; if (!$a) { throw 'Xenia Canary Windows archive was not found in the latest release.' }; $z=Join-Path $env:TEMP 'xenia_canary_windows.7z'; $tmp=Join-Path $env:TEMP ('xenia-canary-' + [Guid]::NewGuid()); try { Invoke-WebRequest -UseBasicParsing $a.browser_download_url -OutFile $z; New-Item -ItemType Directory -Force -Path $tmp | Out-Null; tar -xf $z -C $tmp; $exe=Get-ChildItem -Path $tmp -Filter xenia_canary.exe -Recurse | Select-Object -First 1; if (!$exe) { throw 'The Xenia archive did not contain xenia_canary.exe.' }; Copy-Item -Path (Join-Path $exe.Directory.FullName '*') -Destination $d -Recurse -Force; Set-Content -NoNewline -Path (Join-Path $d 'version.txt') -Value $r.tag_name } finally { Remove-Item -Force -ErrorAction SilentlyContinue $z; Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp }\"`;
};

export const installXenia = async (os: PcOs, run: RunCommand): Promise<void> => {
  if (os === "mac") throw new Error("Xenia Canary does not publish a macOS build.");
  const result = await run(installCommand(os));
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Xenia Canary installation failed.");
};

export const updateXenia = async (os: PcOs, run: RunCommand): Promise<void> => installXenia(os, run);

export const xeniaExecutable = (os: PcOs, home: string) => os === "windows"
  ? `${home}\\AppData\\Local\\GameStore\\Xenia Canary\\xenia_canary.exe`
  : `${home}/.local/opt/xenia-canary/xenia_canary.AppImage`;

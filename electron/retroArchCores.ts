import type { PcOs, RunCommand } from "./pcTarget";

export type RetroPlatform = "PS1" | "N64" | "SAT";

export type RetroCore = {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  installed: boolean;
};

export type RetroCorePlatform = {
  platform: RetroPlatform;
  label: string;
  cores: RetroCore[];
};

const CORE_CATALOG: Array<Omit<RetroCorePlatform, "cores"> & { cores: Array<Omit<RetroCore, "installed">> }> = [
  {
    platform: "PS1",
    label: "PlayStation",
    cores: [
      { id: "swanstation", name: "SwanStation", description: "Best default for modern x64 PCs; accurate with strong graphics options.", recommended: true },
      { id: "pcsx_rearmed", name: "PCSX-ReARMed", description: "Faster, lighter alternative for lower-power hardware.", recommended: false },
    ],
  },
  {
    platform: "N64",
    label: "Nintendo 64",
    cores: [
      { id: "mupen64plus_next", name: "Mupen64Plus-Next", description: "Best general-purpose compatibility and performance default.", recommended: true },
      { id: "parallel_n64", name: "ParaLLEl N64", description: "Accuracy-focused alternative; useful for games with Mupen issues.", recommended: false },
    ],
  },
  {
    platform: "SAT",
    label: "Sega Saturn",
    cores: [
      { id: "kronos", name: "Kronos", description: "Practical x64 default with hardware-rendered graphics.", recommended: true },
      { id: "mednafen_saturn", name: "Beetle Saturn", description: "Accuracy-focused alternative with higher CPU requirements.", recommended: false },
    ],
  },
];

const BUILD_BOT_IDS = new Set(["swanstation", "pcsx_rearmed", "mupen64plus_next", "parallel_n64", "kronos", "mednafen_saturn"]);

export const coreCatalog = () => CORE_CATALOG.map((platform) => ({
  ...platform,
  cores: platform.cores.map((core) => ({ ...core, installed: false })),
}));

const existsCommand = (os: PcOs, ids: string[]) => {
  if (os === "windows") {
    const tests = ids.map((id) => `if exist "%LOCALAPPDATA%\\Programs\\RetroArch-Win64\\cores\\${id}_libretro.dll" echo ${id}`);
    return tests.join(" & ");
  }
  const tests = ids.map((id) => `test -f "$HOME/.var/app/org.libretro.RetroArch/config/retroarch/cores/${id}_libretro.so" && echo ${id}`);
  return tests.join("; ");
};

export const listRetroCores = async (os: PcOs, run: RunCommand): Promise<RetroCorePlatform[]> => {
  const catalog = coreCatalog();
  const ids = catalog.flatMap((platform) => platform.cores.map((core) => core.id));
  const result = await run(existsCommand(os, ids));
  const installed = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return catalog.map((platform) => ({
    ...platform,
    cores: platform.cores.map((core) => ({ ...core, installed: installed.has(core.id) })),
  }));
};

export const installRetroCore = async (os: PcOs, coreId: string, run: RunCommand): Promise<void> => {
  if (!BUILD_BOT_IDS.has(coreId)) throw new Error("That core is detectable, but GameStore has no verified buildbot package for it.");
  if (os === "mac") throw new Error("Automatic RetroArch core installation is not supported on macOS yet.");
  const ext = os === "windows" ? "dll" : "so";
  const platform = os === "windows" ? "windows" : "linux";
  const url = `https://buildbot.libretro.com/nightly/${platform}/x86_64/latest/${coreId}_libretro.${ext}.zip`;
  if (os === "windows") {
    const command = `powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $d=Join-Path $env:LOCALAPPDATA 'Programs\\RetroArch-Win64\\cores'; New-Item -ItemType Directory -Force -Path $d | Out-Null; $z=Join-Path $env:TEMP '${coreId}.zip'; Invoke-WebRequest -UseBasicParsing '${url}' -OutFile $z; Expand-Archive -Force $z $d; Remove-Item $z"`;
    const result = await run(command);
    if (result.code !== 0) throw new Error(result.stderr.trim() || "RetroArch core installation failed.");
    return;
  }
  const command = `set -e; d="$HOME/.var/app/org.libretro.RetroArch/config/retroarch/cores"; mkdir -p "$d"; z="$(mktemp)"; trap 'rm -f "$z"' EXIT; curl -fL '${url}' -o "$z"; unzip -o "$z" -d "$d"`;
  const result = await run(command);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "RetroArch core installation failed.");
};

export const isBuildbotInstallable = (coreId: string) => BUILD_BOT_IDS.has(coreId);

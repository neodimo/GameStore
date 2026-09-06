/**
 * Ports section — PC-native releases of retro games.
 *
 * Three flavors land here:
 *  - Decomps: source-code reconstructions (e.g. OoT, MM, SM64) that compile into
 *    native PC executables. They do NOT ship the original game data; the user
 *    must supply it from a legally-acquired copy.
 *  - Recomps: RE-style source reconstructions that also rebuild the engine and
 *    assets into a single PC release (e.g. RE_Rendering, SourceNextGen).
 *  - Standalone ports: open-source community ports that always include all data
 *    (rare, but they exist for some classics).
 *
 * Distribution in GameStore flows through the existing Minerva / Real-Debrid
 * pipeline; entries that need original assets must surface that requirement
 * before any download begins. Steam deployment is the same path as PS1/N64/Sat,
 * but the launch target is the project's native executable instead of a core.
 *
 * The priority order below is the order sections appear in the UI.
 */

export type PortPlatform =
  | "N64"
  | "PS1"
  | "Dreamcast"
  | "GameCube"
  | "Wii"
  | "Wii U"
  | "Xbox"
  | "Xbox 360"
  | "Switch"
  | "Saturn"
  | "PS2";

export const PORT_PLATFORMS: PortPlatform[] = [
  "N64",
  "PS1",
  "Dreamcast",
  "GameCube",
  "Wii",
  "Wii U",
  "Xbox",
  "Xbox 360",
  "Switch",
  "Saturn",
  "PS2",
];

export const PORT_PLATFORM_LABELS: Record<PortPlatform, string> = {
  N64: "Nintendo 64",
  PS1: "PlayStation",
  Dreamcast: "Dreamcast",
  GameCube: "GameCube",
  Wii: "Wii",
  "Wii U": "Wii U",
  Xbox: "Xbox",
  "Xbox 360": "Xbox 360",
  Switch: "Switch",
  Saturn: "Saturn",
  PS2: "PlayStation 2",
};

/**
 * One port entry. `downloadUrl` is intentionally optional — real distribution
 * URLs come from DiMo's curation (Minerva / Real-Debrid sources) so this file
 * never bakes in anything that could leak copyrighted game data.
 */
export type PortEntry = {
  /** Stable slug, used as the catalog id and Steam shortcut lookup. */
  id: string;
  title: string;
  /** The retro console the game originally shipped on. */
  sourcePlatform: PortPlatform;
  year: number;
  /** Project name + short tag for the card subtitle. */
  project: string;
  description: string;
  projectUrl: string;
  steamAppId?: number;
  /**
   * True when the user must supply original game data (decomps). The UI must
   * surface this BEFORE any download starts; downloading without the matching
   * assets is guaranteed not to work.
   */
  needsOriginalAssets: boolean;
  /**
   * Hint for the launcher executable once installed. Used by the Send-to-Steam
   * path to build the right launch options. Example: "soh.exe".
   */
  executableHint?: string;
  /** Distribution URL — Minerva / Real-Debrid. Curated, never fabricated. */
  downloadUrl?: string;
  /** SteamGridDB or catalog cover URL; SteamGridDB is used as fallback. */
  coverUrl?: string;
};

/**
 * Starter entries. These are well-known publicly-released projects whose
 * existence and GitHub URLs I can stand behind. Anything beyond this list is
 * DiMo's call — the schema supports it, but I won't seed guesses.
 */
export const portsCatalog: PortEntry[] = [
  {
    id: "ship-of-harkinian",
    title: "The Legend of Zelda: Ocarina of Time",
    sourcePlatform: "N64",
    year: 1998,
    project: "Ship of Harkinian",
    description:
      "Native PC port of Ocarina of Time built from the decomp project. Requires a legally-owned ROM dump of the original N64 release; the port compiles that into a modern PC executable with widescreen, 60 fps, mod support and per-controller input mapping.",
    projectUrl: "https://github.com/HarbourMasters/Shipwright",
    steamAppId: 2098750,
    needsOriginalAssets: true,
    executableHint: "soh.exe",
  },
  {
    id: "2-ship-2-harkinian",
    title: "The Legend of Zelda: Majora's Mask",
    sourcePlatform: "N64",
    year: 2000,
    project: "2 Ship 2 Harkinian",
    description:
      "Native PC port of Majora's Mask built on the same decomp foundations as Ship of Harkinian. Adds a built-in mod loader, model swapping, and the same widescreen / 60 fps quality-of-life features.",
    projectUrl: "https://github.com/HarbourMasters/2ship2harkinian",
    needsOriginalAssets: true,
    executableHint: "2s2h.exe",
  },
  {
    id: "sm64-port",
    title: "Super Mario 64",
    sourcePlatform: "N64",
    year: 1996,
    project: "sm64-port",
    description:
      "The original open-source native PC port of Super Mario 64. Requires the original US/JP ROM; the project compiles it into a standalone PC release that has been forked heavily (sm64ex, sm64ex-coop, Render96, etc.).",
    projectUrl: "https://github.com/sm64-port/sm64-port",
    needsOriginalAssets: true,
    executableHint: "sm64.exe",
  },
  {
    id: "resident-evil-re-rendering",
    title: "Resident Evil",
    sourcePlatform: "PS1",
    year: 1996,
    project: "RE_Rendering",
    description:
      "Source-code reconstruction of the original Resident Evil, rebuilt around modern rendering. Recomp release bundles assets and ships as a standalone PC executable.",
    projectUrl: "https://github.com/ClassicRevival/RE_Rendering",
    needsOriginalAssets: false,
    executableHint: "RE_Remake.exe",
  },
  {
    id: "resident-evil-2-source-nextgen",
    title: "Resident Evil 2",
    sourcePlatform: "PS1",
    year: 1998,
    project: "SourceNextGen (RE2)",
    description:
      "Source reconstruction of Resident Evil 2 with the SourceNextGen engine. Bundled assets, native PC executable, widescreen and modern input by default.",
    projectUrl: "https://github.com/ClassicRevival/resident-evil-2-source-nextgen",
    needsOriginalAssets: false,
    executableHint: "RE2.exe",
  },
];

/** Index by id for quick lookup from the cart / Steam deploy path. */
export const portsById: Record<string, PortEntry> = Object.fromEntries(
  portsCatalog.map((entry) => [entry.id, entry]),
);

/** Group entries by source platform in the UI's priority order. */
export const portsByPlatform: Record<PortPlatform, PortEntry[]> = PORT_PLATFORMS.reduce(
  (acc, platform) => {
    acc[platform] = portsCatalog.filter((entry) => entry.sourcePlatform === platform);
    return acc;
  },
  {} as Record<PortPlatform, PortEntry[]>,
);

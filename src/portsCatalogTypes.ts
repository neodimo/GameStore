/**
 * Ports section types.
 *
 * Three flavors of project land here, and the difference matters to the user:
 *  - Recomps: static recompilation lifts the original machine code into a
 *    native binary. Tied to a specific ROM revision.
 *  - Decomps: the source is reconstructed and rebuilt for PC. Usually tolerant
 *    of any matching regional dump.
 *  - Ports: hand-written native ports of a game's engine.
 *
 * All three ship code rather than content. Almost every entry needs the user's
 * own dump of the original game, which is why `needsOriginalAssets` defaults to
 * true and the install pipeline refuses to proceed without a source ROM.
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
  | "PS2"
  | "PSP"
  | "SNES"
  | "NES"
  | "GBA"
  | "GBC"
  | "GB"
  | "DS"
  | "Mega Drive"
  | "Other";

/**
 * DiMo's stated priority order first, then everything else portsdr covers.
 * This is the order platform filters appear in the UI.
 */
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
  "PSP",
  "SNES",
  "NES",
  "GBA",
  "GBC",
  "GB",
  "DS",
  "Mega Drive",
  "Other",
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
  PSP: "PSP",
  SNES: "SNES",
  NES: "NES",
  GBA: "Game Boy Advance",
  GBC: "Game Boy Color",
  GB: "Game Boy",
  DS: "Nintendo DS",
  "Mega Drive": "Mega Drive",
  Other: "Other",
};

/** How the port was produced. Drives the ROM-revision strictness of the install. */
export type PortTechnique = "recomp" | "decomp" | "port";

export const TECHNIQUE_LABELS: Record<PortTechnique, string> = {
  recomp: "Recomp",
  decomp: "Decomp",
  port: "Port",
};

/**
 * How a port's binary reaches the user.
 *
 *  - `github-releases`: maintainers publish pre-built binaries. `releasesUrl`
 *    points at the tagged release the dataset observed.
 *  - `user-assets-required`: no published binary; the user builds from source
 *    and supplies their own game data.
 */
export type DistributionKind = "github-releases" | "user-assets-required";

/** Operating systems a port publishes builds for, as portsdr lists them. */
export type PortTarget =
  | "Windows"
  | "Linux"
  | "macOS"
  | "Android"
  | "iOS"
  | "Switch"
  | "PS Vita"
  | "PSP"
  | "Wii U";

/** The shape `scripts/generate-ports-catalog.mjs` emits. */
export type GeneratedPortEntry = {
  id: string;
  title: string;
  sourcePlatform: PortPlatform;
  project: string;
  technique: PortTechnique;
  description: string;
  projectUrl: string;
  websiteUrl?: string;
  needsOriginalAssets: boolean;
  distributionKind: DistributionKind;
  releasesUrl?: string;
  releaseVersion?: string;
  /** Marked pre-release upstream — expect rough edges. */
  preRelease?: boolean;
  /** portsdr flags projects produced with AI assistance. Surfaced, not filtered. */
  aiAssisted?: boolean;
  archived?: boolean;
  stars?: number;
  updatedAt?: string;
  portTargets: PortTarget[];
  /** Subset of `portTargets` GameStore can actually deploy to. */
  deployTargets: PortTarget[];
  coverUrl?: string;
};

/**
 * Hand-curation merged over a generated entry.
 *
 * `downloadUrl` is the reason this exists: MiNERVA / Real-Debrid links for the
 * base game are DiMo's to curate and must survive every regeneration of the
 * catalog. The generator never writes this field.
 */
export type PortOverride = Partial<
  Pick<
    GeneratedPortEntry,
    "title" | "description" | "needsOriginalAssets" | "coverUrl" | "sourcePlatform"
  >
> & {
  /** MiNERVA / Real-Debrid source for the original game data. Curated only. */
  downloadUrl?: string;
  /** Executable to launch once installed, e.g. "soh.exe". */
  executableHint?: string;
  /** Steam store page, when the port's base game has one. */
  steamAppId?: number;
  /** Exact ROM revision a recomp needs, when known. */
  requiredRomRevision?: string;
};

export type PortEntry = GeneratedPortEntry & Omit<PortOverride, keyof GeneratedPortEntry>;

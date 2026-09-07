import {
  CATALOG_PLATFORMS,
  devicePlatform,
  type LibraryFolder,
} from "../electron/devicePlatforms";

/**
 * Renderer-side console registry. Device facts (core folder, image extensions,
 * on-disk layout) are not restated here — they are read from the shared table
 * in `electron/devicePlatforms.ts`, which lives there for a build reason
 * documented in that file. This module adds only what the UI needs: display
 * names and the Libretro thumbnail system each console's artwork comes from.
 *
 * Adding a console means adding it in both places once, and its catalog
 * artwork, its Settings collection-torrent slot, its navigation chip and its
 * MiSTer section all appear without further edits.
 */

/** Catalog identity. What a `Game.platform` carries. */
export type PlatformId = "PS1" | "N64" | "SAT" | "PS2" | "X360";

export type PlatformDefinition = {
  id: PlatformId;
  /** Full name, for headings and prose. */
  label: string;
  /** Navigation and filter chip. */
  shortLabel: string;
  /**
   * Folder under `https://thumbnails.libretro.com/`, pre-encoded because it is
   * pasted straight into a request path.
   */
  thumbnailSystem: string;
  deviceFolder: LibraryFolder;
  /**
   * Whether the MiSTer has a core for this console. The two PC-lane consoles
   * are shown everywhere the catalog is shown and hidden from every FPGA
   * control, so a card can be browsed and downloaded without ever offering a
   * transfer that has no hardware behind it.
   */
  mister: boolean;
};

const SHORT_LABELS: Record<PlatformId, string> = {
  PS1: "PS1",
  N64: "N64",
  SAT: "Saturn",
  PS2: "PS2",
  X360: "Xbox 360",
};

/**
 * Thumbnail pack per console. Every name here was read from the live index at
 * `https://thumbnails.libretro.com/` rather than guessed from the console's
 * name — the PS2 and Xbox 360 packs were confirmed to exist there before those
 * consoles were added, because a wrong pack name fails as silently missing art.
 */
const THUMBNAIL_SYSTEMS: Record<PlatformId, string> = {
  PS1: "Sony%20-%20PlayStation",
  N64: "Nintendo%20-%20Nintendo%2064",
  SAT: "Sega%20-%20Saturn",
  PS2: "Sony%20-%20PlayStation%202",
  X360: "Microsoft%20-%20Xbox%20360",
};

export const PLATFORMS: PlatformDefinition[] = CATALOG_PLATFORMS.map((device) => ({
  id: device.catalogId,
  label: device.label,
  shortLabel: SHORT_LABELS[device.catalogId],
  thumbnailSystem: THUMBNAIL_SYSTEMS[device.catalogId],
  deviceFolder: device.deviceFolder,
  mister: device.mister,
}));

/** Consoles with a MiSTer core, for every FPGA-facing control. */
export const MISTER_PLATFORMS = PLATFORMS.filter((platform) => platform.mister);

export const PLATFORM_IDS = PLATFORMS.map((platform) => platform.id);

const byId = new Map(PLATFORMS.map((platform) => [platform.id, platform]));

/** Falls back to PlayStation so a stored record from an older build still reads. */
export const platformOf = (id: string | undefined): PlatformDefinition =>
  byId.get(id as PlatformId) ?? PLATFORMS[0];

export const platformLabel = (id: string | undefined) => platformOf(id).label;

export const deviceFolderFor = (id: string | undefined) =>
  platformOf(id).deviceFolder;

/** Display name for a MiSTer core folder. */
export const deviceFolderLabel = (folder: string | undefined) =>
  devicePlatform(folder).label;

/** The catalog platform a library folder belongs to. */
export const catalogIdOfDeviceFolder = (folder: string | undefined): PlatformId =>
  devicePlatform(folder).catalogId;

/** Whether this console can be sent to the MiSTer at all. */
export const isMisterPlatform = (id: string | undefined) => platformOf(id).mister;

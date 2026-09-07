/**
 * The per-console facts that both processes need, in one table.
 *
 * It lives under `electron/` rather than `src/` for a build reason: the desktop
 * tsconfig compiles `electron/*.ts` flat into `dist-electron/`, so importing a
 * module from `src/` would pull the common root up a level and move `main.js`.
 * The renderer has no such constraint and imports this directly through Vite,
 * so `src/platforms.ts` composes presentation on top instead of restating any
 * of it. Nothing here may import Electron or Node — the renderer bundles it.
 *
 * Two defects came from these facts living wherever they were first needed.
 * Every N64 cover URL 404'd against a module constant reading
 * `Sony - PlayStation`, and MiSTer inventory listed only directories, which is
 * a disc-console assumption that walks straight past a folder of loose carts.
 */

/** MiSTer core folder under `/media/fat/games`. */
export const DEVICE_FOLDERS = ["PSX", "N64", "Saturn"] as const;
export type DeviceFolder = (typeof DEVICE_FOLDERS)[number];

/**
 * Every folder the managed library files a game under.
 *
 * A superset of the MiSTer core folders, because the library predates the PC
 * lane and now holds consoles the MiSTer has no core for. PlayStation 2 and
 * Xbox 360 exist here as storage and catalog identities only; both were
 * verified to have no libretro core (Xbox 360) or MiSTer core (both) before
 * being added, so neither may ever be offered as an FPGA transfer.
 */
export const LIBRARY_FOLDERS = ["PSX", "N64", "Saturn", "PS2", "X360"] as const;
export type LibraryFolder = (typeof LIBRARY_FOLDERS)[number];

export type CatalogPlatformDefinition = {
  /** Library folder, and for MiSTer-capable consoles the core folder too. */
  deviceFolder: LibraryFolder;
  /** Catalog identity. Deliberately separate: the PS1 catalog uses the `PSX` core folder. */
  catalogId: "PS1" | "N64" | "SAT" | "PS2" | "X360";
  label: string;
  /** Accepted image extensions, lowercase and dotted. */
  extensions: string[];
  /**
   * How a release sits on disk. A disc title is several files and gets a folder
   * per game; a cartridge is a single file directly inside the core folder,
   * which is how a real MiSTer N64 directory is actually laid out.
   */
  layout: "folder" | "flat";
  /** Human phrasing when a transfer is handed the wrong file type. */
  transferHint: string;
  /**
   * Whether a MiSTer core exists for this console. False consoles are catalog
   * and PC-lane only: no BIOS install, no inventory listing, no transfer. The
   * flag is read rather than inferred from the folder name so adding a console
   * cannot accidentally offer an FPGA route that does not exist.
   */
  mister: boolean;
  /**
   * BIOS the core needs, pinned to the `ajgowans/BiosDB_MiSTer` database that
   * Update All itself is configured against, with that database's own MD5. The
   * hash is checked before anything is written to the device. Empty for
   * consoles with no MiSTer core.
   */
  bios: { name: string; url: string; md5: string }[];
};

/** A console the MiSTer can actually run, narrowed to its core folder. */
export type DevicePlatformDefinition = Omit<CatalogPlatformDefinition, "deviceFolder"> & {
  deviceFolder: DeviceFolder;
};

export const CATALOG_PLATFORMS: CatalogPlatformDefinition[] = [
  {
    deviceFolder: "PSX",
    catalogId: "PS1",
    label: "Sony PlayStation",
    extensions: [".chd", ".cue", ".bin"],
    layout: "folder",
    transferHint: "PSX transfers accept CHD or BIN/CUE files.",
    mister: true,
    bios: [
      { name: "boot.rom", url: "https://archive.org/download/mister_bios_db/PSX.zip/SCPH7001.BIN", md5: "1e68c231d0896b7eadcad1d7d8e76129" },
      { name: "boot1.rom", url: "https://archive.org/download/mister_bios_db/PSX.zip/SCPH7000.BIN", md5: "8e4c14f567745eff2f0408c8129f72a6" },
      { name: "boot2.rom", url: "https://archive.org/download/mister_bios_db/PSX.zip/SCPH7002.BIN", md5: "b9d9a0286c33dc6b7237bb13cd46fdee" },
    ],
  },
  {
    deviceFolder: "N64",
    catalogId: "N64",
    label: "Nintendo 64",
    extensions: [".z64", ".n64", ".v64"],
    layout: "flat",
    transferHint: "N64 transfers accept Z64, N64, or V64 files.",
    mister: true,
    bios: [
      { name: "boot.rom", url: "https://archive.org/download/mister_bios_db/N64.zip/boot.rom", md5: "5c124e7948ada85da603a522782940d0" },
      { name: "boot1.rom", url: "https://archive.org/download/mister_bios_db/N64.zip/boot1.rom", md5: "d4232dc935cad0650ac2664d52281f3a" },
      { name: "boot3.rom", url: "https://archive.org/download/mister_bios_db/N64.zip/boot3.rom", md5: "8d3d9f294b6e174bc7b1d2fd1c727530" },
      { name: "boot4.rom", url: "https://archive.org/download/mister_bios_db/N64.zip/boot4.rom", md5: "aad37b1492886b892f1821f37fd3ae34" },
      { name: "boot5.rom", url: "https://archive.org/download/mister_bios_db/N64.zip/boot5.rom", md5: "37c36e4286d36892a9fc70eafe4104be" },
    ],
  },
  {
    deviceFolder: "Saturn",
    catalogId: "SAT",
    label: "Sega Saturn",
    extensions: [".chd", ".cue", ".bin"],
    layout: "folder",
    transferHint: "Saturn transfers accept CHD or BIN/CUE files.",
    mister: true,
    // The BIOS database lists exactly one Saturn file, unlike PSX and N64.
    bios: [
      {
        name: "boot.rom",
        url: "https://archive.org/download/mister_bios_db/Saturn.zip/Saturn%2FBios%20GameNavi%20HiSaturn%201.03.bin",
        md5: "0306c0e408d6682dd2d86324bd4ac661",
      },
    ],
  },
  {
    // No MiSTer core exists for PS2, and none is in development that runs
    // commercial titles. It reaches hardware through the PC lane only, where
    // libretro publishes two working cores (verified present on both the
    // windows and linux x86_64 buildbots).
    deviceFolder: "PS2",
    catalogId: "PS2",
    label: "Sony PlayStation 2",
    // CHD is the compressed form PCSX2 reads directly; ISO is the raw dump most
    // collections ship. BIN/CUE covers the split dumps of the same discs.
    extensions: [".chd", ".iso", ".cue", ".bin"],
    layout: "folder",
    transferHint: "PS2 releases are CHD, ISO or BIN/CUE disc images.",
    mister: false,
    bios: [],
  },
  {
    // Xbox 360 has neither a MiSTer core nor a libretro core — checked against
    // the libretro buildbot index, which lists no xenia or xbox entry at all.
    // Its emulation route is standalone Xenia on Windows; its other route is
    // the Ports section, where 28 released 360 recomps already live.
    deviceFolder: "X360",
    catalogId: "X360",
    label: "Xbox 360",
    // A 360 dump is either a disc image or the extracted Games-on-Demand tree
    // whose entry point is a XEX.
    extensions: [".iso", ".xex", ".zar"],
    layout: "folder",
    transferHint: "Xbox 360 releases are ISO disc images or extracted XEX folders.",
    mister: false,
    bios: [],
  },
];

/**
 * The MiSTer-capable subset. Every FPGA path — BIOS install, inventory listing,
 * transfer, the device library grid — iterates this rather than the catalog, so
 * a console with no core can never appear as an FPGA destination.
 */
export const DEVICE_PLATFORMS: DevicePlatformDefinition[] = CATALOG_PLATFORMS.filter(
  (platform): platform is DevicePlatformDefinition => platform.mister,
);

const byFolder = new Map(CATALOG_PLATFORMS.map((p) => [p.deviceFolder, p]));
const byCatalogId = new Map(CATALOG_PLATFORMS.map((p) => [p.catalogId, p]));

export const isDeviceFolder = (value: unknown): value is DeviceFolder =>
  typeof value === "string" && DEVICE_FOLDERS.includes(value as DeviceFolder);

/**
 * Reads a stored core-folder name, including the all-caps spelling written by
 * v0.18.0's library finalizer. The device itself still receives the one
 * canonical path from DEVICE_PLATFORMS (`Saturn`, never `SATURN`).
 *
 * Deliberately narrow to MiSTer-capable consoles: every caller is an FPGA
 * operation, and returning `PS2` here would hand a console with no core to a
 * transfer routine. Storage callers want `libraryFolderForStored`.
 */
export const deviceFolderForStored = (value: unknown): DeviceFolder | undefined => {
  if (typeof value !== "string") return undefined;
  return DEVICE_FOLDERS.find((folder) => folder.toLowerCase() === value.toLowerCase());
};

/** The managed-library folder a stored record names, MiSTer console or not. */
export const libraryFolderForStored = (value: unknown): LibraryFolder | undefined => {
  if (typeof value !== "string") return undefined;
  return LIBRARY_FOLDERS.find((folder) => folder.toLowerCase() === value.toLowerCase());
};

/**
 * Converts either of the two public platform identities to the actual MiSTer
 * core folder. Downloads originate in the catalog (`PS1`, `SAT`); library
 * records and device operations use the core folder (`PSX`, `Saturn`). No
 * caller should need to know which one it received.
 */
export const deviceFolderForPlatformId = (value: unknown): DeviceFolder | undefined => {
  const stored = deviceFolderForStored(value);
  if (stored) return stored;
  if (typeof value !== "string") return undefined;
  return DEVICE_PLATFORMS.find((platform) => platform.catalogId === value)?.deviceFolder;
};

/** As above, across every catalog console rather than only the FPGA ones. */
export const libraryFolderForPlatformId = (value: unknown): LibraryFolder | undefined => {
  const stored = libraryFolderForStored(value);
  if (stored) return stored;
  if (typeof value !== "string") return undefined;
  return CATALOG_PLATFORMS.find((platform) => platform.catalogId === value)?.deviceFolder;
};

/** Falls back to PlayStation so a record written by an older build still reads. */
export const devicePlatform = (folder: string | undefined) =>
  byFolder.get(folder as LibraryFolder) ?? CATALOG_PLATFORMS[0];

/**
 * MiSTer core folder for a catalog id. Falls back to PlayStation, which is safe
 * only because every caller is already an FPGA route; PS2 and Xbox 360 must be
 * refused before reaching one, not silently redirected to PSX.
 */
export const deviceFolderForCatalog = (catalogId: string | undefined) =>
  (DEVICE_PLATFORMS.find((platform) => platform.catalogId === catalogId) ??
    DEVICE_PLATFORMS[0]).deviceFolder;

/** Library folder for a catalog id, across every console the catalog carries. */
export const libraryFolderForCatalog = (catalogId: string | undefined) =>
  (byCatalogId.get(catalogId as CatalogPlatformDefinition["catalogId"]) ??
    CATALOG_PLATFORMS[0]).deviceFolder;

/** Whether this console can be sent to the MiSTer at all. */
export const isMisterPlatform = (catalogIdOrFolder: string | undefined) =>
  Boolean(byFolder.get(catalogIdOrFolder as LibraryFolder)?.mister) ||
  Boolean(byCatalogId.get(catalogIdOrFolder as CatalogPlatformDefinition["catalogId"])?.mister);

/**
 * Directories a MiSTer core folder carries that are not games.
 *
 * `media` is the artwork/media directory MiSTer scrapers create, and it was
 * observed on a real device inside both `games/N64` and `games/PSX`. Excluding
 * it only from the cartridge layout would have fixed the console where it was
 * reported and left it listed as a game on the console where it was not.
 *
 * Deliberately a small named set rather than a pattern: a pattern broad enough
 * to describe "not a game" would eventually match a real game folder, and this
 * list is only extended from something actually seen on a device.
 */
const NON_GAME_ENTRIES = new Set(["media"]);

/**
 * Whether a device entry is one of this platform's games.
 *
 * A folder-layout console shows directories; a flat one shows ROM files, and
 * anything else in the core folder — a BIOS image, `N64-database.txt`, a stray
 * save — is not a game and must not be listed as one.
 */
export const isGameEntry = (
  platform: CatalogPlatformDefinition,
  entry: { name: string; type: string },
) => {
  if (entry.name === "." || entry.name === "..") return false;
  if (NON_GAME_ENTRIES.has(entry.name.toLowerCase())) return false;
  if (platform.layout === "folder") return entry.type === "d";
  if (entry.type === "d") return false;
  const lower = entry.name.toLowerCase();
  return platform.extensions.some((extension) => lower.endsWith(extension));
};

/**
 * The title a device entry represents. A cartridge entry is a filename, so its
 * extension is dropped before the entry is matched against catalog titles.
 */
export const deviceEntryTitle = (
  platform: CatalogPlatformDefinition,
  name: string,
) => (platform.layout === "folder" ? name : name.replace(/\.[^.]+$/, ""));

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

export type DevicePlatformDefinition = {
  deviceFolder: DeviceFolder;
  /** Catalog identity. Deliberately separate: the PS1 catalog uses the `PSX` core folder. */
  catalogId: "PS1" | "N64" | "SAT";
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
   * BIOS the core needs, pinned to the `ajgowans/BiosDB_MiSTer` database that
   * Update All itself is configured against, with that database's own MD5. The
   * hash is checked before anything is written to the device.
   */
  bios: { name: string; url: string; md5: string }[];
};

export const DEVICE_PLATFORMS: DevicePlatformDefinition[] = [
  {
    deviceFolder: "PSX",
    catalogId: "PS1",
    label: "Sony PlayStation",
    extensions: [".chd", ".cue", ".bin"],
    layout: "folder",
    transferHint: "PSX transfers accept CHD or BIN/CUE files.",
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
    // The BIOS database lists exactly one Saturn file, unlike PSX and N64.
    bios: [
      {
        name: "boot.rom",
        url: "https://archive.org/download/mister_bios_db/Saturn.zip/Saturn%2FBios%20GameNavi%20HiSaturn%201.03.bin",
        md5: "0306c0e408d6682dd2d86324bd4ac661",
      },
    ],
  },
];

const byFolder = new Map(DEVICE_PLATFORMS.map((p) => [p.deviceFolder, p]));
const byCatalogId = new Map(DEVICE_PLATFORMS.map((p) => [p.catalogId, p]));

export const isDeviceFolder = (value: unknown): value is DeviceFolder =>
  typeof value === "string" && byFolder.has(value as DeviceFolder);

/** Falls back to PlayStation so a record written by an older build still reads. */
export const devicePlatform = (folder: string | undefined) =>
  byFolder.get(folder as DeviceFolder) ?? DEVICE_PLATFORMS[0];

export const deviceFolderForCatalog = (catalogId: string | undefined) =>
  (byCatalogId.get(catalogId as DevicePlatformDefinition["catalogId"]) ??
    DEVICE_PLATFORMS[0]).deviceFolder;

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
  platform: DevicePlatformDefinition,
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
  platform: DevicePlatformDefinition,
  name: string,
) => (platform.layout === "folder" ? name : name.replace(/\.[^.]+$/, ""));

/// <reference types="vite/client" />
interface Window {
  gameStore?: {
    openExternal(url: string): Promise<void>;
    saveExport(data: string): Promise<string>;
    getTheGamesDbKey(): Promise<string>;
    setTheGamesDbKey(key: string): Promise<boolean>;
    findTheGamesDbArt(
      title: string,
    ): Promise<
      { url: string; gameId: number; title: string; source: string }[]
    >;
    getArtIndex(
      system: string,
      folder: string,
      force?: boolean,
    ): Promise<{
      system: string;
      folder: string;
      files: string[];
      fetchedAt: number;
    }>;
    /**
     * Local downscaled address for a remote cover, or null when it could not be
     * cached and the remote original should be used instead.
     */
    cacheCover(url: string): Promise<string | null>;
    getLongplays(
      force?: boolean,
    ): Promise<{ identifier: string; title: string }[]>;
    cacheScreenshots(
      gameId: string,
      urls: string[],
    ): Promise<{ sourceUrl: string; localUrl: string }[]>;
    getVideoPreview(identifier: string): Promise<VideoPreview>;
    downloadVideo(identifier: string): Promise<VideoPreview>;
    cacheFrames(gameId: string, frames: { at: number; data: string }[]): Promise<CachedFrame[]>;
    getCachedFrames(gameId: string): Promise<CachedFrame[]>;
    getMediaCacheStats(): Promise<MediaCacheStats>;
    clearMediaCache(): Promise<MediaCacheStats>;
    onVideoProgress(listener: (progress: VideoProgress) => void): () => void;
    getPcTarget(): Promise<PcTargetSettings | null>;
    setPcTarget(
      settings: Partial<PcTargetSettings> & { password?: string },
    ): Promise<PcTargetSettings>;
    testPcTarget(): Promise<PcTargetTestResult>;
    getFpgaSettings(): Promise<FpgaSettings | null>;
    getFpgaInventory(catalog: { id: string; title: string; coverName?: string; platform?: DeviceFolderId }[]): Promise<FpgaInventory>;
    refreshFpgaInventory(): Promise<{ folders: number }>;
    getFpgaDeviceLibrary(): Promise<DeviceLibrary>;
    installFpgaBios(platform: DeviceFolderId): Promise<BiosStatus>;
    deleteFpgaDeviceGame(platform: DeviceFolderId, folder: string): Promise<{ deleted: string }>;
    onFpgaInventoryChanged(listener: () => void): () => void;
    getMisterCoreCatalog(force?: boolean): Promise<{ entries: MiSTerCoreCatalogEntry[] }>;
    getMisterCoresInstallState(): Promise<{ host: string; installed: Record<string, boolean> }>;
    installMisterCore(coreId: string): Promise<{ coreId: string; installedFile: string }>;
    onMisterCoreInstallProgress(listener: (progress: MiSTerCoreInstallProgress) => void): () => void;
    discoverFpga(): Promise<NetworkCandidate[]>;
    onFpgaDiscoveryProgress(listener: (progress: { done: number; total: number }) => void): () => void;
    onFpgaLocating(listener: (state: { stage: string }) => void): () => void;
    onFpgaAddressChanged(listener: (state: { host: string }) => void): () => void;
    setFpgaSettings(
      settings: Partial<FpgaSettings> & { password?: string },
    ): Promise<FpgaSettings>;
    testFpga(): Promise<{ ok: boolean; message: string; host?: string }>;
    transferToFpga(
      title: string,
      platform: string,
    ): Promise<{ canceled: boolean; files?: number; remoteDir?: string }>;
    transferLibraryToFpga(title: string, platform: string): Promise<{ canceled: boolean; files?: number; remoteDir?: string }>;
    getLibraryCart(): Promise<LibraryItem[]>;
    removeLibraryCartItem(id: string): Promise<LibraryItem[]>;
    checkoutLibraryCart(): Promise<{ items: number; files: number }>;
    onLibraryChanged(listener: () => void): () => void;
    onFpgaProgress(listener: (progress: FpgaProgress) => void): () => void;
    getDebridSettings(): Promise<{ hasRealDebrid: boolean; hasTorBox: boolean; collections: CollectionSource[] }>;
    setDebridSettings(settings: { realdebrid?: string; torbox?: string; collections?: CollectionSource[] }): Promise<{ hasRealDebrid: boolean; hasTorBox: boolean; collections: CollectionSource[] }>;
    testDebrid(provider: "realdebrid" | "torbox"): Promise<{ ok: boolean; account: string }>;
    downloadGame(provider: "realdebrid" | "torbox", link: string, title: string, platform?: CatalogPlatformId): Promise<{ path: string; filename: string; bytes: number; directory: string }>;
    onGameDownloadProgress(listener: (progress: GameDownloadProgress) => void): () => void;
    searchCollections(title: string, region: string, platform?: CatalogPlatformId): Promise<CollectionCandidate[]>;
    indexCollection(source: CollectionSource): Promise<{ url: string; files: number; indexedAt: number }>;
    getCollectionStatus(): Promise<IndexedCollection[]>;
    downloadCollectionSelection(sourceUrl: string, paths: string[], title: string, platform?: CatalogPlatformId): Promise<{ directory: string; files: string[] }>;
    getEmuMoviesSettings(): Promise<EmuMoviesSettings>;
    loginEmuMovies(credentials: { username?: string; password?: string }): Promise<EmuMoviesProbe>;
    /** Streams sign-in stages; returns an unsubscribe function. */
    onEmuMoviesProgress(listener: (message: string) => void): () => void;
    indexEmuMovies(system?: string, catalog?: { title: string; region: string; coverName?: string }[]): Promise<{ folder: string; quality: string; snaps: number; indexedAt: number; coverage?: { catalog: number; matched: number; unmatched: number; ambiguous: number } }>;
    forgetEmuMovies(): Promise<boolean>;
    getEmuMoviesSnap(title: string, region: string, coverName?: string, system?: CatalogPlatformId): Promise<EmuMoviesSnap | null>;
    getUpdateStatus(): Promise<UpdateStatus>;
    checkForUpdates(): Promise<void>;
    downloadUpdate(): Promise<void>;
    restartToUpdate(): Promise<void>;
    onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
    pickTranslationFile(kind: "image" | "patch", title: string): Promise<string | null>;
    findTranslationSource(title: string): Promise<string | null>;
    browseTranslationPatch(request: { gameId: string; title: string; url: string; expectedFile?: string; container: string }): Promise<void>;
    onTranslationPatchReady(callback: (payload: { gameId: string; path: string }) => void): () => void;
    onTranslationPatchError(callback: (payload: { gameId: string; message: string }) => void): () => void;
    applyTranslation(request: TranslationApplyRequest): Promise<TranslationProvenance>;
    listTranslations(): Promise<TranslationProvenance[]>;
  };
}
type TranslationApplyRequest = {
  gameId: string;
  title: string;
  sourcePath: string;
  patchPath: string;
  /** Canonical original release filename the patched copy must keep. */
  outputName: string;
  target?: { release: string; serial: string; size: number; crc32: string; sha1: string };
  expectedPatchSha256?: string;
  expectedOutputSha1?: string;
  team?: string;
  allowUnverifiedSource?: boolean;
};
type TranslationProvenance = {
  gameId: string;
  appliedAt: string;
  team?: string;
  container: string;
  verification: string;
  unverifiedSourceAccepted: boolean;
  patch: { file: string; sha256: string };
  source: { file: string; size: number; crc32: string; sha1: string };
  output: { file: string; directory: string; size: number; sha1: string };
};
type FpgaSettings = {
  /** Last address that worked. A cache, refreshed automatically when it moves. */
  host: string;
  /** Network name the device answers to; survives a DHCP lease change. */
  deviceName: string;
  port: number;
  username: string;
  root: string;
  hasPassword: boolean;
  /** True once the SSH host key is on file, which lets the app re-find it alone. */
  recognized: boolean;
};
type FpgaInventory = { status: "unconfigured" | "scanning" | "ready"; gameIds: string[]; scannedAt?: number };
type PcOs = "windows" | "linux" | "mac";
type PcTargetSettings = {
  kind: "local" | "remote";
  name: string;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  os?: PcOs;
  osDetectedAt?: number;
  /** Local is always itself; remote is true once its SSH host key is on file. */
  recognized: boolean;
};
type PcTargetTestResult = { ok: boolean; os: PcOs; message: string };
/** MiSTer core folder. Mirrors `DEVICE_FOLDERS` in electron/devicePlatforms.ts. */
type DeviceFolderId = "PSX" | "N64" | "Saturn";
/** Catalog platform. Mirrors `PlatformId` in src/platforms.ts. */
type CatalogPlatformId = "PS1" | "N64" | "SAT";
type BiosStatus = { platform: DeviceFolderId; ready: boolean; files: { name: string; present: boolean }[] };
/** Partial: a device cache written before a console existed has no entry for it. */
type DeviceLibrary = { host: string; folders: Partial<Record<DeviceFolderId, string[]>>; bios: BiosStatus[] };
type NetworkCandidate = {
  host: string;
  hostname?: string;
  port: number;
  confidence: "likely" | "unknown";
  reason: string;
};
type GameDownloadProgress = {
  gameTitle: string;
  filename: string;
  bytes: number;
  total: number;
  percent: number;
  stage?: "preparing" | "downloading";
  message?: string;
};
type CollectionSource = { name: string; url: string; platform: string };
type LibraryItem = {
  id: string;
  title: string;
  platform: string;
  directory: string;
  files: string[];
  queuedAt: string;
  /**
   * Present when the entry is a translated copy. Carried on the entry rather
   * than inferred from the filename, because a patched copy deliberately keeps
   * the original release name so artwork still resolves.
   */
  translated?: { team?: string; appliedAt: string };
};
type ReleaseVariant = {
  region: "USA" | "Europe" | "Japan" | "World" | "Unknown";
  translated: boolean;
  english: boolean;
  label: string;
};
type CollectionCandidate = { path: string; bytes: number; index: number; score: number; collection: string; sourceUrl: string; variant: ReleaseVariant };
type IndexedCollection = CollectionSource & { indexed: boolean; files: number; indexedAt: number };
type EmuMoviesSettings = {
  username: string;
  hasPassword: boolean;
  indexed: boolean;
  snaps: number;
  quality: string;
  indexedAt: number;
  manifests: { platform: CatalogPlatformId; snaps: number; quality: string; indexedAt: number }[];
};
type EmuMoviesProbe = {
  ok: boolean;
  secure: boolean;
  message: string;
  systems: string[];
  snapFolder?: string;
  qualities: string[];
};
type EmuMoviesSnap = { name: string; quality: string; localUrl: string; bytes: number };
type CachedFrame = { at: number; localUrl: string };
type FpgaProgress = {
  gameTitle: string;
  file: string;
  bytes: number;
  total: number;
  percent: number;
};
type UpdateStatus = {
  state:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "current"
    | "unsupported"
    | "error";
  version?: string;
  percent?: number;
  message?: string;
};
type VideoPreview = {
  identifier: string;
  name: string;
  size: number;
  format: string;
  duration: number;
  streamUrl: string;
  gifUrl?: string;
  cached: boolean;
  localUrl?: string;
  /**
   * Which provider supplied the preview. An Internet Archive longplay is a
   * multi-gigabyte recording that is streamed and windowed; an EmuMovies snap
   * is a small curated clip already on disk. They differ in what the pane may
   * offer — a snap has nothing to "save offline" and no archive.org page — so
   * the origin travels with the preview rather than being inferred from it.
   */
  source?: "archive" | "emumovies";
};
type MiSTerCoreCategory = "arcade" | "computer" | "console" | "llapi" | "other";
type MiSTerCoreTier = "official" | "unofficial";
type MiSTerCoreFile = { path: string; hash: string; size: number };
type MiSTerCoreCatalogEntry = {
  id: string;
  name: string;
  category: MiSTerCoreCategory;
  source: string;
  tier: MiSTerCoreTier;
  baseFilesUrl: string;
  rbfPath: string;
  rbfHash: string;
  rbfSize: number;
  /** Arcade only: every `.mra` romset this board core plays. */
  mraFiles: MiSTerCoreFile[];
  /** Arcade only: how many playable romsets this core has. Null for platform cores (computer/console/LLAPI/other), whose game libraries are open-ended rather than a fixed count. */
  gameCount: number | null;
  /** Arcade only: the flagship game's title, for per-game box-art lookup. Null for platform cores. */
  artTitle: string | null;
};
type MiSTerCoreInstallProgress = {
  coreId: string;
  stage: "checking" | "downloading" | "uploading" | "done" | "error";
  message: string;
};
type MediaCacheStats = { bytes: number; path: string };
type VideoProgress = {
  identifier: string;
  bytes: number;
  total: number;
  percent: number;
};

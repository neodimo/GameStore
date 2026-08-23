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
      folder: string,
      force?: boolean,
    ): Promise<{ folder: string; files: string[]; fetchedAt: number }>;
    getLongplays(
      force?: boolean,
    ): Promise<{ identifier: string; title: string }[]>;
    cacheScreenshots(
      gameId: string,
      urls: string[],
    ): Promise<{ sourceUrl: string; localUrl: string }[]>;
    getVideoInfo(identifier: string): Promise<LocalVideoInfo>;
    downloadVideo(identifier: string): Promise<LocalVideoInfo>;
    getMediaCacheStats(): Promise<MediaCacheStats>;
    clearMediaCache(): Promise<MediaCacheStats>;
    onVideoProgress(listener: (progress: VideoProgress) => void): () => void;
    getFpgaSettings(): Promise<FpgaSettings | null>;
    discoverFpga(): Promise<NetworkCandidate[]>;
    onFpgaDiscoveryProgress(listener: (progress: { done: number; total: number }) => void): () => void;
    setFpgaSettings(
      settings: Partial<FpgaSettings> & { password?: string },
    ): Promise<FpgaSettings>;
    testFpga(): Promise<{ ok: boolean; message: string }>;
    transferToFpga(
      title: string,
    ): Promise<{ canceled: boolean; files?: number; remoteDir?: string }>;
    transferLibraryToFpga(title: string): Promise<{ canceled: boolean; files?: number; remoteDir?: string }>;
    onFpgaProgress(listener: (progress: FpgaProgress) => void): () => void;
    getDebridSettings(): Promise<{ hasRealDebrid: boolean; hasTorBox: boolean; collections: CollectionSource[] }>;
    setDebridSettings(settings: { realdebrid?: string; torbox?: string; collections?: CollectionSource[] }): Promise<{ hasRealDebrid: boolean; hasTorBox: boolean; collections: CollectionSource[] }>;
    testDebrid(provider: "realdebrid" | "torbox"): Promise<{ ok: boolean; account: string }>;
    downloadGame(provider: "realdebrid" | "torbox", link: string, title: string): Promise<{ path: string; filename: string; bytes: number; directory: string }>;
    onGameDownloadProgress(listener: (progress: GameDownloadProgress) => void): () => void;
    searchCollections(title: string, region: string): Promise<CollectionCandidate[]>;
    downloadCollectionSelection(sourceUrl: string, paths: string[], title: string): Promise<{ directory: string; files: string[] }>;
    getUpdateStatus(): Promise<UpdateStatus>;
    checkForUpdates(): Promise<void>;
    downloadUpdate(): Promise<void>;
    restartToUpdate(): Promise<void>;
    onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  };
}
type FpgaSettings = {
  host: string;
  port: number;
  username: string;
  root: string;
  hasPassword: boolean;
};
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
};
type CollectionSource = { name: string; url: string; platform: string };
type CollectionCandidate = { path: string; bytes: number; index: number; score: number; collection: string; sourceUrl: string };
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
type LocalVideoInfo = {
  identifier: string;
  name: string;
  size: number;
  format: string;
  cached: boolean;
  localUrl?: string;
};
type MediaCacheStats = { bytes: number; path: string };
type VideoProgress = {
  identifier: string;
  bytes: number;
  total: number;
  percent: number;
};

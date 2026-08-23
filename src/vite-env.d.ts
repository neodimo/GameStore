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
    setFpgaSettings(
      settings: Partial<FpgaSettings> & { password?: string },
    ): Promise<FpgaSettings>;
    testFpga(): Promise<{ ok: boolean; message: string }>;
    transferToFpga(
      title: string,
    ): Promise<{ canceled: boolean; files?: number; remoteDir?: string }>;
    onFpgaProgress(listener: (progress: FpgaProgress) => void): () => void;
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

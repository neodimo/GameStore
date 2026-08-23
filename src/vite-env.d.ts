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

import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("gameStore", {
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  saveExport: (data: string) => ipcRenderer.invoke("save-export", data),
  getTheGamesDbKey: () => ipcRenderer.invoke("provider-key-get"),
  setTheGamesDbKey: (key: string) =>
    ipcRenderer.invoke("provider-key-set", key),
  findTheGamesDbArt: (title: string) =>
    ipcRenderer.invoke("thegamesdb-art", title),
  getArtIndex: (folder: string, force?: boolean) =>
    ipcRenderer.invoke("art-index-get", folder, force),
  getLongplays: (force?: boolean) =>
    ipcRenderer.invoke("media-longplays-get", force),
  cacheScreenshots: (gameId: string, urls: string[]) =>
    ipcRenderer.invoke("media-screens-cache", gameId, urls),
  getVideoInfo: (identifier: string) =>
    ipcRenderer.invoke("media-video-info", identifier),
  downloadVideo: (identifier: string) =>
    ipcRenderer.invoke("media-video-download", identifier),
  getMediaCacheStats: () => ipcRenderer.invoke("media-cache-stats"),
  clearMediaCache: () => ipcRenderer.invoke("media-cache-clear"),
  onVideoProgress: (listener: (progress: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      listener(progress);
    ipcRenderer.on("media-video-progress", wrapped);
    return () => ipcRenderer.removeListener("media-video-progress", wrapped);
  },
  getFpgaSettings: () => ipcRenderer.invoke("fpga-settings-get"),
  discoverFpga: () => ipcRenderer.invoke("fpga-discover"),
  onFpgaDiscoveryProgress: (listener: (progress: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: unknown) => listener(progress);
    ipcRenderer.on("fpga-discovery-progress", wrapped);
    return () => ipcRenderer.removeListener("fpga-discovery-progress", wrapped);
  },
  setFpgaSettings: (settings: unknown) =>
    ipcRenderer.invoke("fpga-settings-set", settings),
  testFpga: () => ipcRenderer.invoke("fpga-test"),
  transferToFpga: (title: string) => ipcRenderer.invoke("fpga-transfer", title),
  transferLibraryToFpga: (title: string) => ipcRenderer.invoke("fpga-transfer-library", title),
  onFpgaProgress: (listener: (progress: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      listener(progress);
    ipcRenderer.on("fpga-transfer-progress", wrapped);
    return () => ipcRenderer.removeListener("fpga-transfer-progress", wrapped);
  },
  getDebridSettings: () => ipcRenderer.invoke("debrid-settings-get"),
  setDebridSettings: (settings: unknown) => ipcRenderer.invoke("debrid-settings-set", settings),
  testDebrid: (provider: string) => ipcRenderer.invoke("debrid-test", provider),
  downloadGame: (provider: string, link: string, title: string) =>
    ipcRenderer.invoke("game-download", provider, link, title),
  onGameDownloadProgress: (listener: (progress: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: unknown) => listener(progress);
    ipcRenderer.on("game-download-progress", wrapped);
    return () => ipcRenderer.removeListener("game-download-progress", wrapped);
  },
  searchCollections: (title: string, region: string) => ipcRenderer.invoke("collection-search", title, region),
  downloadCollectionSelection: (sourceUrl: string, paths: string[], title: string) => ipcRenderer.invoke("collection-download", sourceUrl, paths, title),
  getUpdateStatus: () => ipcRenderer.invoke("update-status-get"),
  checkForUpdates: () => ipcRenderer.invoke("update-check"),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  restartToUpdate: () => ipcRenderer.invoke("update-restart"),
  onUpdateStatus: (listener: (status: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: unknown) =>
      listener(status);
    ipcRenderer.on("update-status", wrapped);
    return () => ipcRenderer.removeListener("update-status", wrapped);
  },
});

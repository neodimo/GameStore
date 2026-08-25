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
  cacheCover: (url: string) => ipcRenderer.invoke("art-cover-cache", url),
  getLongplays: (force?: boolean) =>
    ipcRenderer.invoke("media-longplays-get", force),
  cacheScreenshots: (gameId: string, urls: string[]) =>
    ipcRenderer.invoke("media-screens-cache", gameId, urls),
  getVideoPreview: (identifier: string) =>
    ipcRenderer.invoke("media-video-preview", identifier),
  cacheFrames: (gameId: string, frames: { at: number; data: string }[]) =>
    ipcRenderer.invoke("media-frames-cache", gameId, frames),
  getCachedFrames: (gameId: string) =>
    ipcRenderer.invoke("media-frames-get", gameId),
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
  getFpgaInventory: (catalog: { id: string; title: string }[]) => ipcRenderer.invoke("fpga-inventory-get", catalog),
  refreshFpgaInventory: () => ipcRenderer.invoke("fpga-inventory-refresh"),
  onFpgaInventoryChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("fpga-inventory-changed", wrapped);
    return () => ipcRenderer.removeListener("fpga-inventory-changed", wrapped);
  },
  discoverFpga: () => ipcRenderer.invoke("fpga-discover"),
  /** Progress while the app re-finds a device whose address changed. */
  onFpgaLocating: (listener: (state: { stage: string }) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, state: { stage: string }) => listener(state);
    ipcRenderer.on("fpga-locating", wrapped);
    return () => ipcRenderer.removeListener("fpga-locating", wrapped);
  },
  onFpgaAddressChanged: (listener: (state: { host: string }) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, state: { host: string }) => listener(state);
    ipcRenderer.on("fpga-address-changed", wrapped);
    return () => ipcRenderer.removeListener("fpga-address-changed", wrapped);
  },
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
  getLibraryCart: () => ipcRenderer.invoke("library-cart-get"),
  removeLibraryCartItem: (id: string) => ipcRenderer.invoke("library-cart-remove", id),
  checkoutLibraryCart: () => ipcRenderer.invoke("library-cart-checkout"),
  onLibraryChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("library-changed", wrapped);
    return () => ipcRenderer.removeListener("library-changed", wrapped);
  },
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
  indexCollection: (source: { name: string; url: string; platform: string }) =>
    ipcRenderer.invoke("collection-index", source),
  getCollectionStatus: () => ipcRenderer.invoke("collection-status"),
  downloadCollectionSelection: (sourceUrl: string, paths: string[], title: string) => ipcRenderer.invoke("collection-download", sourceUrl, paths, title),
  getEmuMoviesSettings: () => ipcRenderer.invoke("emumovies-settings-get"),
  loginEmuMovies: (credentials: { username?: string; password?: string }) =>
    ipcRenderer.invoke("emumovies-login", credentials),
  /** Streams sign-in stages; returns an unsubscribe function. */
  onEmuMoviesProgress: (listener: (message: string) => void) => {
    const handler = (_e: unknown, message: string) => listener(message);
    ipcRenderer.on("emumovies-login-progress", handler);
    return () => ipcRenderer.off("emumovies-login-progress", handler);
  },
  indexEmuMovies: (system = "PS1", catalog: unknown[] = []) =>
    ipcRenderer.invoke("emumovies-index", system, catalog),
  forgetEmuMovies: () => ipcRenderer.invoke("emumovies-forget"),
  getEmuMoviesSnap: (title: string, region: string, coverName?: string) =>
    ipcRenderer.invoke("emumovies-snap", title, region, coverName),
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
  pickTranslationFile: (kind: "image" | "patch", title: string) =>
    ipcRenderer.invoke("translation-pick-file", kind, title),
  findTranslationSource: (title: string) => ipcRenderer.invoke("translation-find-source", title),
  browseTranslationPatch: (request: unknown) => ipcRenderer.invoke("translation-browse-patch", request),
  onTranslationPatchReady: (callback: (payload: { gameId: string; path: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { gameId: string; path: string }) => callback(payload);
    ipcRenderer.on("translation-patch-ready", wrapped);
    return () => ipcRenderer.removeListener("translation-patch-ready", wrapped);
  },
  onTranslationPatchError: (callback: (payload: { gameId: string; message: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { gameId: string; message: string }) => callback(payload);
    ipcRenderer.on("translation-patch-error", wrapped);
    return () => ipcRenderer.removeListener("translation-patch-error", wrapped);
  },
  applyTranslation: (request: unknown) => ipcRenderer.invoke("translation-apply", request),
  listTranslations: () => ipcRenderer.invoke("translation-list"),
});

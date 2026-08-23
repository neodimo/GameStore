import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("gameStore", {
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  saveExport: (data: string) => ipcRenderer.invoke("save-export", data),
  getTheGamesDbKey: () => ipcRenderer.invoke("provider-key-get"),
  setTheGamesDbKey: (key: string) =>
    ipcRenderer.invoke("provider-key-set", key),
  findTheGamesDbArt: (title: string) =>
    ipcRenderer.invoke("thegamesdb-art", title),
  getFpgaSettings: () => ipcRenderer.invoke("fpga-settings-get"),
  setFpgaSettings: (settings: unknown) =>
    ipcRenderer.invoke("fpga-settings-set", settings),
  testFpga: () => ipcRenderer.invoke("fpga-test"),
  transferToFpga: (title: string) => ipcRenderer.invoke("fpga-transfer", title),
  onFpgaProgress: (listener: (progress: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      listener(progress);
    ipcRenderer.on("fpga-transfer-progress", wrapped);
    return () => ipcRenderer.removeListener("fpga-transfer-progress", wrapped);
  },
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

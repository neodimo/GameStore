import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('gameStore', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  saveExport: (data: string) => ipcRenderer.invoke('save-export', data),
  getTheGamesDbKey: () => ipcRenderer.invoke('provider-key-get'),
  setTheGamesDbKey: (key: string) => ipcRenderer.invoke('provider-key-set', key),
  findTheGamesDbArt: (title: string) => ipcRenderer.invoke('thegamesdb-art', title),
  getUpdateStatus: () => ipcRenderer.invoke('update-status-get'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  restartToUpdate: () => ipcRenderer.invoke('update-restart'),
  onUpdateStatus: (listener: (status: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: unknown) => listener(status);
    ipcRenderer.on('update-status', wrapped);
    return () => ipcRenderer.removeListener('update-status', wrapped);
  }
});

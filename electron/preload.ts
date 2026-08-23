import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('gameStore', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  saveExport: (data: string) => ipcRenderer.invoke('save-export', data),
  getTheGamesDbKey: () => ipcRenderer.invoke('provider-key-get'),
  setTheGamesDbKey: (key: string) => ipcRenderer.invoke('provider-key-set', key),
  findTheGamesDbArt: (title: string) => ipcRenderer.invoke('thegamesdb-art', title)
});

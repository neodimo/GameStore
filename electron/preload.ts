import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('gameStore', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  saveExport: (data: string) => ipcRenderer.invoke('save-export', data)
});

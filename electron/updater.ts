import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
export type UpdateStatus = {
  state: 'idle'|'checking'|'available'|'downloading'|'ready'|'current'|'unsupported'|'error';
  version?: string;
  percent?: number;
  message?: string;
};

let status: UpdateStatus = { state: 'idle' };
const send = (next: UpdateStatus) => {
  status = next;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update-status', status);
};

export function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', info => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'current' }));
  autoUpdater.on('download-progress', progress => send({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', error => send({ state: 'error', message: error.message }));

  ipcMain.handle('update-status-get', () => status);
  ipcMain.handle('update-check', async () => {
    if (!app.isPackaged) return send({ state: 'unsupported', message: 'Updates are available in installed builds.' });
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      return send({ state: 'unsupported', message: 'Automatic updates require the AppImage build. Use your package manager for .deb installs.' });
    }
    try { await autoUpdater.checkForUpdates(); } catch (error) { send({ state: 'error', message: error instanceof Error ? error.message : String(error) }); }
  });
  ipcMain.handle('update-download', async () => {
    try { send({ ...status, state: 'downloading', percent: 0 }); await autoUpdater.downloadUpdate(); }
    catch (error) { send({ state: 'error', message: error instanceof Error ? error.message : String(error) }); }
  });
  ipcMain.handle('update-restart', () => autoUpdater.quitAndInstall(true, true));
}

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

let win: BrowserWindow | null = null;
const createWindow = () => {
  win = new BrowserWindow({ width: 1500, height: 960, minWidth: 820, minHeight: 640, backgroundColor: '#0d0f12', titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) win.loadURL(dev); else win.loadFile(path.join(__dirname, '../dist/index.html'));
};
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
ipcMain.handle('open-external', (_e, url: string) => { if (/^https?:\/\//.test(url)) return shell.openExternal(url); });
ipcMain.handle('save-export', async (_e, data: string) => {
  const file = path.join(app.getPath('documents'), 'GameStore-shelves.json');
  await fs.writeFile(file, data, 'utf8'); return file;
});

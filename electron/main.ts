import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

let win: BrowserWindow | null = null;
const createWindow = () => {
  win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#0d0f12',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
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

const settingsFile = () => path.join(app.getPath('userData'), 'provider-settings.json');
const readSettings = async (): Promise<{ theGamesDbKey?: string }> => {
  try {
    const stored = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as { theGamesDbKey?: string; encrypted?: boolean };
    if (!stored.theGamesDbKey) return {};
    if (stored.encrypted) return safeStorage.isEncryptionAvailable()
      ? { theGamesDbKey: safeStorage.decryptString(Buffer.from(stored.theGamesDbKey, 'base64')) }
      : {};
    return { theGamesDbKey: stored.theGamesDbKey };
  } catch { return {}; }
};
ipcMain.handle('provider-key-get', async () => (await readSettings()).theGamesDbKey ?? '');
ipcMain.handle('provider-key-set', async (_e, key: string) => {
  const clean = String(key || '').trim();
  const encrypted = clean && safeStorage.isEncryptionAvailable();
  const value = encrypted ? safeStorage.encryptString(clean).toString('base64') : clean;
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify({ theGamesDbKey: value, encrypted: !!encrypted }), { mode: 0o600 });
  return true;
});
ipcMain.handle('thegamesdb-art', async (_e, title: string) => {
  const key = (await readSettings()).theGamesDbKey;
  if (!key) throw new Error('Add your TheGamesDB API key in Settings first.');
  const url = new URL('https://api.thegamesdb.net/v1/Games/ByGameName');
  url.searchParams.set('apikey', key); url.searchParams.set('name', title);
  url.searchParams.set('filter[platform]', '10'); url.searchParams.set('include', 'boxart');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TheGamesDB returned ${response.status}`);
  const payload = await response.json() as any;
  const games = payload?.data?.games ?? [];
  const base = payload?.include?.boxart?.base_url?.original ?? '';
  const byGame = payload?.include?.boxart?.data ?? {};
  const candidates = games.flatMap((game: any) => (byGame[String(game.id)] ?? [])
    .filter((art: any) => art.type === 'boxart' && (!art.side || art.side === 'front'))
    .map((art: any) => ({ url: `${base}${art.filename}`, gameId: game.id, title: game.game_title, source: 'TheGamesDB' })));
  return candidates.slice(0, 12);
});

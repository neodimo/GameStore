import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import SftpClient from "ssh2-sftp-client";
import { configureUpdater } from "./updater";

let win: BrowserWindow | null = null;
const createWindow = () => {
  win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: "#0d0f12",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) win.loadURL(dev);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
};
app.whenReady().then(() => {
  configureUpdater();
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
ipcMain.handle("open-external", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url);
});
ipcMain.handle("save-export", async (_e, data: string) => {
  const file = path.join(app.getPath("documents"), "GameStore-shelves.json");
  await fs.writeFile(file, data, "utf8");
  return file;
});

const settingsFile = () =>
  path.join(app.getPath("userData"), "provider-settings.json");
type ProviderSettings = {
  theGamesDbKey?: string;
  fpga?: {
    host: string;
    port: number;
    username: string;
    password?: string;
    encrypted?: boolean;
    root: string;
  };
};
const readSettings = async (): Promise<ProviderSettings> => {
  try {
    const stored = JSON.parse(
      await fs.readFile(settingsFile(), "utf8"),
    ) as ProviderSettings & { encrypted?: boolean };
    const result: ProviderSettings = { ...stored };
    if (stored.theGamesDbKey && stored.encrypted)
      result.theGamesDbKey = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored.theGamesDbKey, "base64"))
        : undefined;
    if (stored.fpga?.password && stored.fpga.encrypted)
      result.fpga = {
        ...stored.fpga,
        password: safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(
              Buffer.from(stored.fpga.password, "base64"),
            )
          : undefined,
      };
    return result;
  } catch {
    return {};
  }
};
const writeSettings = async (
  settings: ProviderSettings & { encrypted?: boolean },
) => {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings), { mode: 0o600 });
};
ipcMain.handle(
  "provider-key-get",
  async () => (await readSettings()).theGamesDbKey ?? "",
);
ipcMain.handle("provider-key-set", async (_e, key: string) => {
  const clean = String(key || "").trim();
  const encrypted = clean && safeStorage.isEncryptionAvailable();
  const value = encrypted
    ? safeStorage.encryptString(clean).toString("base64")
    : clean;
  const existing = JSON.parse(
    await fs.readFile(settingsFile(), "utf8").catch(() => "{}"),
  );
  await writeSettings({
    ...existing,
    theGamesDbKey: value,
    encrypted: !!encrypted,
  });
  return true;
});
ipcMain.handle("thegamesdb-art", async (_e, title: string) => {
  const key = (await readSettings()).theGamesDbKey;
  if (!key) throw new Error("Add your TheGamesDB API key in Settings first.");
  const url = new URL("https://api.thegamesdb.net/v1/Games/ByGameName");
  url.searchParams.set("apikey", key);
  url.searchParams.set("name", title);
  url.searchParams.set("filter[platform]", "10");
  url.searchParams.set("include", "boxart");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TheGamesDB returned ${response.status}`);
  const payload = (await response.json()) as any;
  const games = payload?.data?.games ?? [];
  const base = payload?.include?.boxart?.base_url?.original ?? "";
  const byGame = payload?.include?.boxart?.data ?? {};
  const candidates = games.flatMap((game: any) =>
    (byGame[String(game.id)] ?? [])
      .filter(
        (art: any) =>
          art.type === "boxart" && (!art.side || art.side === "front"),
      )
      .map((art: any) => ({
        url: `${base}${art.filename}`,
        gameId: game.id,
        title: game.game_title,
        source: "TheGamesDB",
      })),
  );
  return candidates.slice(0, 12);
});

const publicFpga = async () => {
  const f = (await readSettings()).fpga;
  return f
    ? {
        host: f.host,
        port: f.port,
        username: f.username,
        root: f.root,
        hasPassword: !!f.password,
      }
    : null;
};
ipcMain.handle("fpga-settings-get", publicFpga);
ipcMain.handle(
  "fpga-settings-set",
  async (
    _e,
    incoming: {
      host: string;
      port?: number;
      username?: string;
      password?: string;
      root?: string;
    },
  ) => {
    const existing = JSON.parse(
      await fs.readFile(settingsFile(), "utf8").catch(() => "{}"),
    );
    const previous = (await readSettings()).fpga;
    const password = String(incoming.password || previous?.password || "");
    const encrypted = !!password && safeStorage.isEncryptionAvailable();
    const storedPassword = encrypted
      ? safeStorage.encryptString(password).toString("base64")
      : password;
    await writeSettings({
      ...existing,
      fpga: {
        host: String(incoming.host || "MiSTer").trim(),
        port: Number(incoming.port) || 22,
        username: String(incoming.username || "root").trim(),
        password: storedPassword,
        encrypted,
        root: String(incoming.root || "/media/fat/games").replace(/\/$/, ""),
      },
    });
    return publicFpga();
  },
);
const connectFpga = async () => {
  const f = (await readSettings()).fpga;
  if (!f?.host)
    throw new Error(
      "Configure a SuperStation One or MiSTer in Settings first.",
    );
  const client = new SftpClient();
  await client.connect({
    host: f.host,
    port: f.port || 22,
    username: f.username || "root",
    password: f.password,
    readyTimeout: 12000,
  });
  return { client, f };
};
ipcMain.handle("fpga-test", async () => {
  const { client, f } = await connectFpga();
  try {
    const exists = await client.exists(`${f.root}/PSX`);
    return {
      ok: true,
      message: exists
        ? "Connected — PSX folder found."
        : "Connected — PSX folder will be created on first transfer.",
    };
  } finally {
    await client.end();
  }
});
ipcMain.handle("fpga-transfer", async (_e, gameTitle: string) => {
  const picked = await dialog.showOpenDialog(win!, {
    title: `Select ${gameTitle} game files`,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "MiSTer CD images", extensions: ["chd", "cue", "bin"] }],
  });
  if (picked.canceled || !picked.filePaths.length) return { canceled: true };
  const extensions = picked.filePaths.map((file) =>
    path.extname(file).toLowerCase(),
  );
  if (extensions.some((ext) => ![".chd", ".cue", ".bin"].includes(ext)))
    throw new Error("PSX transfers accept CHD or BIN/CUE files.");
  if (extensions.includes(".cue") && !extensions.includes(".bin"))
    throw new Error("Select the CUE and every referenced BIN file together.");
  const { client, f } = await connectFpga();
  const safeName = gameTitle.replace(/[\\/:*?"<>|]/g, "-").trim();
  const remoteDir = `${f.root}/PSX/${safeName}`;
  const total = (
    await Promise.all(picked.filePaths.map((file) => fs.stat(file)))
  ).reduce((n, s) => n + s.size, 0);
  let finished = 0;
  try {
    await client.mkdir(remoteDir, true);
    for (const local of picked.filePaths) {
      const size = (await fs.stat(local)).size;
      const remote = `${remoteDir}/${path.basename(local)}`;
      await client.fastPut(local, remote, {
        step: (transferred: number) =>
          win?.webContents.send("fpga-transfer-progress", {
            gameTitle,
            file: path.basename(local),
            bytes: finished + transferred,
            total,
            percent: Math.round(((finished + transferred) / total) * 100),
          }),
      });
      finished += size;
    }
    return { canceled: false, files: picked.filePaths.length, remoteDir };
  } finally {
    await client.end();
  }
});

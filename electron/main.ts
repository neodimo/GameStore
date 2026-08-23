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
import { discoverFpgaDevices } from "./networkDiscovery";
import {
  downloadResolvedLink,
  testDebrid,
  type DebridProvider,
} from "./downloadManager";
import { getArtIndex } from "./artIndex";
import {
  cacheScreenshots,
  cacheStats,
  clearMediaCache,
  downloadVideo,
  getLongplayIndex,
  getVideoInfo,
} from "./mediaCache";

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
  debrid?: {
    realdebrid?: string;
    torbox?: string;
    encrypted?: boolean;
  };
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
    if (stored.debrid?.encrypted && safeStorage.isEncryptionAvailable())
      result.debrid = {
        encrypted: true,
        realdebrid: stored.debrid.realdebrid
          ? safeStorage.decryptString(Buffer.from(stored.debrid.realdebrid, "base64"))
          : undefined,
        torbox: stored.debrid.torbox
          ? safeStorage.decryptString(Buffer.from(stored.debrid.torbox, "base64"))
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
ipcMain.handle("debrid-settings-get", async () => {
  const debrid = (await readSettings()).debrid;
  return {
    hasRealDebrid: !!debrid?.realdebrid,
    hasTorBox: !!debrid?.torbox,
  };
});
ipcMain.handle(
  "debrid-settings-set",
  async (_e, incoming: { realdebrid?: string; torbox?: string }) => {
    const current = await readSettings();
    const raw = JSON.parse(await fs.readFile(settingsFile(), "utf8").catch(() => "{}"));
    const realdebrid = String(incoming.realdebrid || current.debrid?.realdebrid || "").trim();
    const torbox = String(incoming.torbox || current.debrid?.torbox || "").trim();
    const encrypted = safeStorage.isEncryptionAvailable();
    await writeSettings({
      ...raw,
      debrid: {
        encrypted,
        realdebrid: realdebrid
          ? encrypted
            ? safeStorage.encryptString(realdebrid).toString("base64")
            : realdebrid
          : undefined,
        torbox: torbox
          ? encrypted
            ? safeStorage.encryptString(torbox).toString("base64")
            : torbox
          : undefined,
      },
    });
    return { hasRealDebrid: !!realdebrid, hasTorBox: !!torbox };
  },
);
ipcMain.handle("debrid-test", async (_e, provider: DebridProvider) => {
  const token = (await readSettings()).debrid?.[provider];
  if (!token) throw new Error(`Add your ${provider === "torbox" ? "TorBox" : "Real-Debrid"} API token in Settings first.`);
  return testDebrid(provider, token);
});
ipcMain.handle(
  "game-download",
  async (_e, provider: DebridProvider, link: string, gameTitle: string) => {
    const token = (await readSettings()).debrid?.[provider];
    if (!token) throw new Error("Configure this provider in Settings first.");
    return downloadResolvedLink({ provider, token, link, gameTitle, window: win });
  },
);
ipcMain.handle("art-index-get", async (_e, folder: string, force?: boolean) =>
  getArtIndex(folder, !!force),
);
ipcMain.handle("media-longplays-get", (_e, force?: boolean) =>
  getLongplayIndex(!!force),
);
ipcMain.handle("media-screens-cache", (_e, gameId: string, urls: string[]) =>
  cacheScreenshots(gameId, urls),
);
ipcMain.handle("media-video-info", (_e, identifier: string) =>
  getVideoInfo(identifier),
);
ipcMain.handle("media-video-download", (_e, identifier: string) =>
  downloadVideo(identifier, win),
);
ipcMain.handle("media-cache-stats", cacheStats);
ipcMain.handle("media-cache-clear", clearMediaCache);
const queryTheGamesDb = async (key: string, name: string) => {
  const url = new URL("https://api.thegamesdb.net/v1/Games/ByGameName");
  url.searchParams.set("apikey", key);
  url.searchParams.set("name", name);
  url.searchParams.set("filter[platform]", "10");
  url.searchParams.set("include", "boxart");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TheGamesDB returned ${response.status}`);
  const payload = (await response.json()) as any;
  const base = payload?.include?.boxart?.base_url?.original ?? "";
  const byGame = payload?.include?.boxart?.data ?? {};
  return ((payload?.data?.games ?? []) as any[]).flatMap((game) =>
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
};
/**
 * TheGamesDB only does substring matching, so an exact catalog title with a
 * subtitle or trailing punctuation often returns nothing. Progressively
 * shortened queries recover those titles; the renderer ranks the union.
 */
ipcMain.handle("thegamesdb-art", async (_e, title: string) => {
  const key = (await readSettings()).theGamesDbKey;
  if (!key) throw new Error("Add your TheGamesDB API key in Settings first.");
  const queries = [
    title,
    title.split(/\s[-:–]\s|:/)[0],
    title.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " "),
  ]
    .map((q) => q.trim())
    .filter((q, i, all) => q.length > 2 && all.indexOf(q) === i);
  const seen = new Set<string>();
  const candidates: any[] = [];
  for (const query of queries) {
    for (const candidate of await queryTheGamesDb(key, query)) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      candidates.push(candidate);
    }
    if (candidates.length >= 12) break;
  }
  return candidates.slice(0, 24);
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
ipcMain.handle("fpga-discover", async () =>
  discoverFpgaDevices((done, total) =>
    win?.webContents.send("fpga-discovery-progress", { done, total }),
  ),
);
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
    const mediaFat = await client.exists("/media/fat");
    const exists = await client.exists(`${f.root}/PSX`);
    return {
      ok: true,
      message: mediaFat
        ? exists
          ? "Confirmed MiSTer/SuperStation layout — PSX folder found."
          : "Confirmed MiSTer/SuperStation layout — PSX folder will be created on first transfer."
        : `SSH connected, but /media/fat was not found. Verify that ${f.host} is the intended device.`,
    };
  } finally {
    await client.end();
  }
});
const transferFilesToFpga = async (gameTitle: string, filePaths: string[]) => {
  const extensions = filePaths.map((file) =>
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
    await Promise.all(filePaths.map((file) => fs.stat(file)))
  ).reduce((n, s) => n + s.size, 0);
  let finished = 0;
  try {
    await client.mkdir(remoteDir, true);
    for (const local of filePaths) {
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
    return { canceled: false, files: filePaths.length, remoteDir };
  } finally {
    await client.end();
  }
};
ipcMain.handle("fpga-transfer", async (_e, gameTitle: string) => {
  const picked = await dialog.showOpenDialog(win!, {
    title: `Select ${gameTitle} game files`,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "MiSTer CD images", extensions: ["chd", "cue", "bin"] }],
  });
  if (picked.canceled || !picked.filePaths.length) return { canceled: true };
  return transferFilesToFpga(gameTitle, picked.filePaths);
});
ipcMain.handle("fpga-transfer-library", async (_e, gameTitle: string) => {
  const dir = path.join(app.getPath("documents"), "GameStore", "Games", gameTitle.replace(/[\\/:*?"<>|]/g, "-").trim());
  const files = (await fs.readdir(dir).catch(() => []))
    .filter((name) => [".chd", ".cue", ".bin"].includes(path.extname(name).toLowerCase()))
    .map((name) => path.join(dir, name));
  if (!files.length) throw new Error("No CHD or BIN/CUE files are ready in this game's local library folder.");
  return transferFilesToFpga(gameTitle, files);
});

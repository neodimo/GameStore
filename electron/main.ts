import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  shell,
} from "electron";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import fs from "node:fs/promises";
import SftpClient from "ssh2-sftp-client";
import { configureUpdater } from "./updater";
import { discoverFpgaDevices } from "./networkDiscovery";
import {
  downloadResolvedLink,
  downloadCollectionFiles,
  testDebrid,
  type DebridProvider,
  libraryRoot,
} from "./downloadManager";
import { checkoutCart, getCart, removeFromCart } from "./libraryManager";
import { matchRemoteTitles, type InventoryCatalogGame } from "./fpgaInventory";
import {
  ensureCollectionManifest,
  fetchTorrent,
  indexCollection,
  matchCollectionFiles,
  readCollectionManifest,
  removeCollectionManifest,
} from "./collectionIndex";
import { getArtIndex } from "./artIndex";
import { getCachedCover } from "./coverCache";
import {
  fetchSnap,
  indexSnaps,
  matchSnap,
  probeAccount,
  readSnapManifest,
  removeSnapManifest,
  type EmuMoviesCredentials,
} from "./emuMovies";
import {
  cacheFrames,
  cacheScreenshots,
  cacheStats,
  clearMediaCache,
  downloadVideo,
  getCachedFrames,
  getLongplayIndex,
  getVideoPreview,
  MEDIA_SCHEME,
  streamArchiveVideo,
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
/**
 * Previews play from `gsmedia://video/<identifier>` rather than straight from
 * archive.org. `stream` keeps range requests intact so a media element can seek
 * inside a two-gigabyte recording, and `corsEnabled` plus `standard` leave the
 * response same-origin, which is what lets a canvas read frames back out of the
 * playing video without tainting.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const MEDIA_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Accept-Ranges": "bytes",
  "Content-Type": "video/mp4",
};
const contentType = (file: string) =>
  /\.png$/i.test(file)
    ? "image/png"
    : /\.(jpe?g)$/i.test(file)
      ? "image/jpeg"
      : /\.webp$/i.test(file)
        ? "image/webp"
        : "video/mp4";

/** Serves a completed local download, honouring the player's range request. */
const localVideoResponse = (file: string, size: number, range?: string | null) => {
  const match = /bytes=(\d*)-(\d*)/.exec(range ?? "");
  if (!match) {
    const stream = createReadStream(file);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        ...MEDIA_HEADERS,
        "Content-Type": contentType(file),
        "Content-Length": String(size),
      },
    });
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  const stream = createReadStream(file, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      ...MEDIA_HEADERS,
      "Content-Type": contentType(file),
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
};

const registerMediaProtocol = () =>
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "asset") {
      try {
        const candidate = Buffer.from(
          url.pathname.replace(/^\//, ""),
          "base64url",
        ).toString("utf8");
        const mediaRoot = path.resolve(app.getPath("userData"), "media-cache");
        const local = path.resolve(candidate);
        if (!local.startsWith(`${mediaRoot}${path.sep}`))
          return new Response("Not found", { status: 404 });
        const stat = await fs.stat(local);
        if (!stat.isFile()) return new Response("Not found", { status: 404 });
        return localVideoResponse(local, stat.size, request.headers.get("Range"));
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    if (url.hostname !== "video") return new Response("Not found", { status: 404 });
    const identifier = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const range = request.headers.get("Range");
    try {
      const result = await streamArchiveVideo(identifier, range ?? undefined);
      if (result.cachedFile)
        return localVideoResponse(result.cachedFile, result.size!, range);
      const upstream = result.response!;
      const headers = new Headers(MEDIA_HEADERS);
      for (const key of ["content-length", "content-range", "content-type"]) {
        const value = upstream.headers.get(key);
        if (value) headers.set(key, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : "Stream failed", {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }
  });

app.whenReady().then(() => {
  registerMediaProtocol();
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
  collections?: { name: string; url: string; platform: string }[];
  emumovies?: {
    username?: string;
    password?: string;
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
  fpgaInventory?: {
    fingerprint: string;
    scannedAt: number;
    psxFolders: string[];
    error?: string;
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
    if (stored.emumovies?.encrypted && safeStorage.isEncryptionAvailable())
      result.emumovies = {
        encrypted: true,
        username: stored.emumovies.username,
        password: stored.emumovies.password
          ? safeStorage.decryptString(
              Buffer.from(stored.emumovies.password, "base64"),
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
const collectionDir = () => path.join(app.getPath("userData"), "collection-index");
ipcMain.handle("debrid-settings-get", async () => {
  const debrid = (await readSettings()).debrid;
  return {
    hasRealDebrid: !!debrid?.realdebrid,
    hasTorBox: !!debrid?.torbox,
    collections: (await readSettings()).collections ?? [],
  };
});
ipcMain.handle(
  "debrid-settings-set",
  async (_e, incoming: { realdebrid?: string; torbox?: string; collections?: { name: string; url: string; platform: string }[] }) => {
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
      collections: Array.isArray((incoming as any).collections)
        ? (incoming as any).collections.map((item: any) => ({ name: String(item.name || "Collection").trim(), url: String(item.url || "").trim(), platform: String(item.platform || "PS1") })).filter((item: any) => /^https:\/\//.test(item.url))
        : current.collections,
    });
    const saved = (await readSettings()).collections ?? [];
    // A source that is no longer configured must not leave a searchable manifest.
    for (const stale of (current.collections ?? []).filter(
      (item) => !saved.some((keep) => keep.url === item.url),
    ))
      await removeCollectionManifest(collectionDir(), stale.url);
    return { hasRealDebrid: !!realdebrid, hasTorBox: !!torbox, collections: saved };
  },
);
/**
 * Indexing belongs to configuring a source, not to searching one. Settings
 * calls this when a collection URL is saved; from then on every game's Add to
 * Cart reads the stored manifest.
 */
ipcMain.handle(
  "collection-index",
  async (_e, source: { name: string; url: string; platform: string }) => {
    const manifest = await indexCollection(collectionDir(), source);
    return { url: manifest.url, files: manifest.files.length, indexedAt: manifest.indexedAt };
  },
);
ipcMain.handle("collection-status", async () => {
  const collections = (await readSettings()).collections ?? [];
  return Promise.all(
    collections.map(async (collection) => {
      const manifest = await readCollectionManifest(collectionDir(), collection.url);
      return {
        ...collection,
        indexed: !!manifest,
        files: manifest?.files.length ?? 0,
        indexedAt: manifest?.indexedAt ?? 0,
      };
    }),
  );
});
const snapDir = () => path.join(app.getPath("userData"), "emumovies-index");
const snapCacheDir = () => path.join(app.getPath("userData"), "media-cache", "snaps");
/**
 * The stored login, or nothing. Every EmuMovies path funnels through this so a
 * missing credential is an ordinary "no provider configured" rather than an
 * error thrown from inside a media lookup.
 */
const emuCredentials = async (): Promise<EmuMoviesCredentials | null> => {
  const stored = (await readSettings()).emumovies;
  return stored?.username && stored.password
    ? { username: stored.username, password: stored.password }
    : null;
};
ipcMain.handle("emumovies-settings-get", async () => {
  const stored = (await readSettings()).emumovies;
  const manifest = await readSnapManifest(snapDir());
  return {
    username: stored?.username ?? "",
    hasPassword: !!stored?.password,
    indexed: !!manifest,
    snaps: manifest?.files.length ?? 0,
    quality: manifest?.quality ?? "",
    indexedAt: manifest?.indexedAt ?? 0,
  };
});
/**
 * Saving credentials and signing in are one action, because a saved credential
 * that has never been tried tells the member nothing. The probe reports the
 * directories this FTP/file-server account can actually see. Authentication
 * failure alone says nothing about the website membership tier.
 */
ipcMain.handle(
  "emumovies-login",
  async (event, incoming: { username?: string; password?: string }) => {
    const current = (await readSettings()).emumovies;
    const username = String(incoming.username ?? current?.username ?? "").trim();
    const password = String(incoming.password || current?.password || "");
    if (!username || !password)
      return {
        ok: false,
        message: "Enter your EmuMovies FTP/file-server username and password.",
        qualities: [],
        systems: [],
        secure: false,
      };
    // Sign-in walks the member's folder tree, which takes long enough that a
    // single static status reads as a hang. Stages are streamed as they happen.
    const probe = await probeAccount({ username, password }, (message) => {
      if (!event.sender.isDestroyed())
        event.sender.send("emumovies-login-progress", message);
    });
    if (!probe.ok) return probe;
    const raw = JSON.parse(
      await fs.readFile(settingsFile(), "utf8").catch(() => "{}"),
    );
    const encrypted = safeStorage.isEncryptionAvailable();
    await writeSettings({
      ...raw,
      emumovies: {
        encrypted,
        username,
        password: encrypted
          ? safeStorage.encryptString(password).toString("base64")
          : password,
      },
    });
    return probe;
  },
);
/** Index the snap listing once, the way a collection source is indexed once. */
ipcMain.handle("emumovies-index", async () => {
  const credentials = await emuCredentials();
  if (!credentials) throw new Error("Sign in to EmuMovies first.");
  const manifest = await indexSnaps(snapDir(), credentials);
  return {
    folder: manifest.folder,
    quality: manifest.quality,
    snaps: manifest.files.length,
    indexedAt: manifest.indexedAt,
  };
});
ipcMain.handle("emumovies-forget", async () => {
  const raw = JSON.parse(
    await fs.readFile(settingsFile(), "utf8").catch(() => "{}"),
  );
  delete raw.emumovies;
  await writeSettings(raw);
  await removeSnapManifest(snapDir());
  return true;
});
/**
 * The preview for one game, when EmuMovies can supply it. A snap is small
 * enough to hold outright, so this returns a local file rather than a stream:
 * the pane gets a preview that loops immediately and does not depend on a
 * remote node staying healthy.
 */
ipcMain.handle(
  "emumovies-snap",
  async (_e, title: string, region: string) => {
    const credentials = await emuCredentials();
    if (!credentials) return null;
    const manifest = await readSnapManifest(snapDir());
    if (!manifest) return null;
    const match = matchSnap(manifest.files, title, region);
    if (!match) return null;
    const { localUrl, bytes } = await fetchSnap(
      snapCacheDir(),
      credentials,
      match.path,
    );
    return {
      name: match.name,
      quality: manifest.quality,
      localUrl,
      bytes,
    };
  },
);
ipcMain.handle("collection-search", async (_e, title: string, region: string) => {
  const collections = (await readSettings()).collections ?? [];
  const results: any[] = [];
  for (const collection of collections.filter((item) => item.platform === "PS1")) {
    const manifest = await ensureCollectionManifest(collectionDir(), collection);
    results.push(
      ...matchCollectionFiles(manifest.files, title, region).map((file) => ({
        ...file,
        collection: collection.name,
        sourceUrl: collection.url,
      })),
    );
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 8);
});
ipcMain.handle("collection-download", async (_e, sourceUrl: string, paths: string[], gameTitle: string) => {
  const settings = await readSettings();
  const allowed = (settings.collections ?? []).some((item) => item.url === sourceUrl);
  if (!allowed) throw new Error("This collection source is not configured in Settings.");
  const token = settings.debrid?.realdebrid;
  if (!token) throw new Error("Add a Real-Debrid API token in Settings first.");
  const result = await downloadCollectionFiles({ token, torrent: await fetchTorrent(sourceUrl), wantedPaths: paths, gameTitle, platform: "PSX", window: win });
  win?.webContents.send("library-changed");
  return result;
});
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
    const result = await downloadResolvedLink({ provider, token, link, gameTitle, platform: "PSX", window: win });
    win?.webContents.send("library-changed");
    return result;
  },
);
ipcMain.handle("art-index-get", async (_e, folder: string, force?: boolean) =>
  getArtIndex(folder, !!force),
);
ipcMain.handle("art-cover-cache", (_e, url: string) => getCachedCover(url));
ipcMain.handle("media-longplays-get", (_e, force?: boolean) =>
  getLongplayIndex(!!force),
);
ipcMain.handle("media-screens-cache", (_e, gameId: string, urls: string[]) =>
  cacheScreenshots(gameId, urls),
);
ipcMain.handle("media-video-preview", (_e, identifier: string) =>
  getVideoPreview(identifier),
);
ipcMain.handle("media-video-download", (_e, identifier: string) =>
  downloadVideo(identifier, win),
);
ipcMain.handle(
  "media-frames-cache",
  (_e, gameId: string, frames: { at: number; data: string }[]) =>
    cacheFrames(gameId, frames),
);
ipcMain.handle("media-frames-get", (_e, gameId: string) => getCachedFrames(gameId));
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
const fpgaFingerprint = (f: NonNullable<ProviderSettings["fpga"]>) =>
  `${f.host}:${f.port || 22}:${f.username || "root"}:${f.root}`;
let inventoryRefresh: Promise<string[]> | undefined;
const refreshFpgaInventory = async () => {
  if (inventoryRefresh) return inventoryRefresh;
  inventoryRefresh = (async () => {
    const { client, f } = await connectFpga();
    try {
      // Catalog cards never touch the network. One shallow listing is enough for
      // GameStore-managed PSX installs: /games/PSX/<game folder>.
      const remoteDir = `${f.root}/PSX`;
      const entries = await client.list(remoteDir).catch(() => []);
      const psxFolders = entries
        .filter((entry) => entry.type === "d")
        .map((entry) => entry.name)
        .filter((name) => name !== "." && name !== "..");
      const raw = JSON.parse(await fs.readFile(settingsFile(), "utf8").catch(() => "{}"));
      await writeSettings({
        ...raw,
        fpgaInventory: { fingerprint: fpgaFingerprint(f), scannedAt: Date.now(), psxFolders },
      });
      win?.webContents.send("fpga-inventory-changed");
      return psxFolders;
    } finally {
      await client.end();
      inventoryRefresh = undefined;
    }
  })();
  return inventoryRefresh;
};
ipcMain.handle("fpga-settings-get", publicFpga);
ipcMain.handle("fpga-inventory-get", async (_e, catalog: InventoryCatalogGame[]) => {
  const settings = await readSettings();
  const f = settings.fpga;
  if (!f) return { status: "unconfigured" as const, gameIds: [] };
  const cached = settings.fpgaInventory;
  if (cached?.fingerprint === fpgaFingerprint(f))
    return { status: "ready" as const, gameIds: matchRemoteTitles(cached.psxFolders, catalog), scannedAt: cached.scannedAt };
  // Fire this exactly once per device configuration; the initial paint and all
  // scrolling remain local while SFTP answers in the background.
  void refreshFpgaInventory().catch(() => win?.webContents.send("fpga-inventory-changed"));
  return { status: "scanning" as const, gameIds: [] };
});
ipcMain.handle("fpga-inventory-refresh", async () => {
  const titles = await refreshFpgaInventory();
  return { folders: titles.length };
});
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
      fpgaInventory: undefined,
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
ipcMain.handle("library-cart-get", () => getCart(libraryRoot()));
ipcMain.handle("library-cart-remove", async (_e, id: string) => {
  const cart = await removeFromCart(libraryRoot(), id);
  win?.webContents.send("library-changed");
  return cart;
});
ipcMain.handle("library-cart-checkout", async () => {
  if (!(await getCart(libraryRoot())).length) throw new Error("The MiSTer cart is empty.");
  const completed = await checkoutCart(libraryRoot(), async (item) => {
    if (item.platform !== "PSX") throw new Error(`${item.title} targets ${item.platform}; that MiSTer console route is not configured yet.`);
    await transferFilesToFpga(item.title, item.files);
  }, () => win?.webContents.send("library-changed"));
  return { items: completed.length, files: completed.reduce((sum, item) => sum + item.files.length, 0) };
});
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
  const item = (await getCart(libraryRoot())).find((entry) => entry.title === gameTitle);
  if (!item) throw new Error("This game is not currently in the MiSTer cart.");
  const result = await transferFilesToFpga(gameTitle, item.files);
  await removeFromCart(libraryRoot(), item.id);
  win?.webContents.send("library-changed");
  return result;
});

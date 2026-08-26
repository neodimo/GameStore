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
import {
  DEFAULT_DEVICE_NAME,
  discoverFpgaDevices,
  isIpv4,
  isReachable,
  locateDevice,
  resolveAddress,
} from "./networkDiscovery";
import { createHash } from "node:crypto";
import {
  downloadResolvedLink,
  downloadCollectionFiles,
  testDebrid,
  type DebridProvider,
  libraryRoot,
} from "./downloadManager";
import { addToCart, checkoutCart, findCartDiscImage, getCart, removeFromCart } from "./libraryManager";
import { openTranslationBrowser } from "./translationDownloads";
import { applyTranslation, readProvenance, type TranslationTarget } from "./translationManager";
import {
  listDeviceGames,
  matchRemoteTitles,
  type InventoryCatalogGame,
} from "./fpgaInventory";
import {
  DEVICE_PLATFORMS,
  deviceEntryTitle,
  deviceFolderForCatalog,
  deviceFolderForPlatformId,
  deviceFolderForStored,
  devicePlatform,
  isDeviceFolder,
  isGameEntry,
  type DeviceFolder,
} from "./devicePlatforms";
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
    /** Last address that worked. Treated as a cache, not as the identity. */
    host: string;
    /**
     * The device's network name, which survives a DHCP lease change where the
     * address does not. A MiSTer answers to `MiSTer.local` out of the box.
     */
    deviceName?: string;
    /**
     * SHA-256 of the SSH host key seen on the first successful connection. This
     * is what lets GameStore adopt a new address on its own: it proves the box
     * that just answered is the same one, rather than some other machine on the
     * network that happens to accept the password.
     */
    hostKey?: string;
    port: number;
    username: string;
    password?: string;
    encrypted?: boolean;
    root: string;
  };
  fpgaInventory?: {
    fingerprint: string;
    scannedAt: number;
    /** Partial: a cache written before a console existed has no entry for it. */
    folders: Partial<Record<DeviceFolder, string[]>>;
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
 * Sign-in validates and stores credentials only. Media discovery is a separate,
 * console-targeted action so authentication never crawls the provider tree.
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
/** Index one selected console; refreshes reuse its previously discovered folder. */
ipcMain.handle("emumovies-index", async (event, system = "PS1", catalog = []) => {
  const credentials = await emuCredentials();
  if (!credentials) throw new Error("Sign in to EmuMovies first.");
  const manifest = await indexSnaps(snapDir(), credentials, String(system), (message) => {
    if (!event.sender.isDestroyed())
      event.sender.send("emumovies-login-progress", message);
  }, Array.isArray(catalog) ? catalog : []);
  return {
    folder: manifest.folder,
    quality: manifest.quality,
    snaps: manifest.files.length,
    indexedAt: manifest.indexedAt,
    coverage: manifest.coverage,
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
  async (_e, title: string, region: string, coverName?: string) => {
    const credentials = await emuCredentials();
    if (!credentials) return null;
    const manifest = await readSnapManifest(snapDir());
    if (!manifest) return null;
    const match = matchSnap(manifest.files, title, region, coverName);
    if (!match) return null;
    const { localUrl, bytes } = await fetchSnap(
      snapCacheDir(),
      credentials,
      match.path,
    );
    return {
      name: match.name,
      quality: match.quality ?? manifest.quality,
      localUrl,
      bytes,
    };
  },
);
ipcMain.handle("collection-search", async (_e, title: string, region: string, platform = "PS1") => {
  const collections = (await readSettings()).collections ?? [];
  const results: any[] = [];
  for (const collection of collections.filter((item) => item.platform === platform)) {
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
ipcMain.handle("collection-download", async (_e, sourceUrl: string, paths: string[], gameTitle: string, platform = "PS1") => {
  const settings = await readSettings();
  const allowed = (settings.collections ?? []).some((item) => item.url === sourceUrl);
  if (!allowed) throw new Error("This collection source is not configured in Settings.");
  const token = settings.debrid?.realdebrid;
  if (!token) throw new Error("Add a Real-Debrid API token in Settings first.");
  const result = await downloadCollectionFiles({ token, torrent: await fetchTorrent(sourceUrl), wantedPaths: paths, gameTitle, platform: deviceFolderForCatalog(platform), window: win });
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
  async (_e, provider: DebridProvider, link: string, gameTitle: string, platform = "PS1") => {
    const token = (await readSettings()).debrid?.[provider];
    if (!token) throw new Error("Configure this provider in Settings first.");
    const result = await downloadResolvedLink({ provider, token, link, gameTitle, platform: deviceFolderForCatalog(platform), window: win });
    win?.webContents.send("library-changed");
    return result;
  },
);
ipcMain.handle("art-index-get", async (_e, system: string, folder: string, force?: boolean) =>
  getArtIndex(system, folder, !!force),
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
        deviceName: f.deviceName || DEFAULT_DEVICE_NAME,
        port: f.port,
        username: f.username,
        root: f.root,
        hasPassword: !!f.password,
        /** Whether GameStore can re-find this device on its own after a move. */
        recognized: !!f.hostKey,
      }
    : null;
};
const fpgaFingerprint = (f: NonNullable<ProviderSettings["fpga"]>) =>
  `${f.host}:${f.port || 22}:${f.username || "root"}:${f.root}`;
const devicePlatforms = DEVICE_PLATFORMS.map((p) => p.deviceFolder);
type DevicePlatform = DeviceFolder;

let inventoryRefresh: Promise<Record<DevicePlatform, string[]>> | undefined;
const refreshFpgaInventory = async () => {
  if (inventoryRefresh) return inventoryRefresh;
  inventoryRefresh = (async () => {
    const { client, f } = await connectFpga();
    try {
      const folders = await listDeviceGames(client, f.root);
      const raw = JSON.parse(await fs.readFile(settingsFile(), "utf8").catch(() => "{}"));
      await writeSettings({
        ...raw,
        fpgaInventory: { fingerprint: fpgaFingerprint(f), scannedAt: Date.now(), folders },
      });
      win?.webContents.send("fpga-inventory-changed");
      return folders;
    } finally {
      await client.end();
      inventoryRefresh = undefined;
    }
  })();
  return inventoryRefresh;
};
ipcMain.handle("fpga-settings-get", publicFpga);
ipcMain.handle("fpga-inventory-get", async (_e, catalog: (InventoryCatalogGame & { platform?: string })[]) => {
  const settings = await readSettings();
  const f = settings.fpga;
  if (!f) return { status: "unconfigured" as const, gameIds: [] };
  const cached = settings.fpgaInventory;
  if (cached?.fingerprint === fpgaFingerprint(f)) {
    // A cache written before a console existed simply has no entry for it, and
    // one written before this field was a map still carries `psxFolders`.
    const folders: Partial<Record<DevicePlatform, string[]>> =
      cached.folders ?? { PSX: (cached as any).psxFolders ?? [] };
    return {
      status: "ready" as const,
      gameIds: devicePlatforms.flatMap((platform) =>
        matchRemoteTitles(
          folders[platform] ?? [],
          catalog.filter((game) => deviceFolderForPlatformId(game.platform) === platform),
        ),
      ),
      scannedAt: cached.scannedAt,
    };
  }
  // Fire this exactly once per device configuration; the initial paint and all
  // scrolling remain local while SFTP answers in the background.
  void refreshFpgaInventory().catch(() => win?.webContents.send("fpga-inventory-changed"));
  return { status: "scanning" as const, gameIds: [] };
});
ipcMain.handle("fpga-inventory-refresh", async () => {
  const folders = await refreshFpgaInventory();
  return { folders: Object.values(folders).reduce((sum, entries) => sum + entries.length, 0) };
});
const biosStatus = async (client: SftpClient, root: string, platform: DevicePlatform) => {
  const expected = devicePlatform(platform).bios;
  const present = await Promise.all(expected.map(async (file) => ({
    name: file.name,
    present: await client.exists(`${root}/${platform}/${file.name}`).then(Boolean).catch(() => false),
  })));
  return { platform, ready: present.every((file) => file.present), files: present };
};
ipcMain.handle("fpga-device-library", async () => {
  const { client, f } = await connectFpga();
  try {
    const folders = await listDeviceGames(client, f.root);
    return { host: f.host, folders, bios: await Promise.all(devicePlatforms.map((platform) => biosStatus(client, f.root, platform))) };
  } finally { await client.end(); }
});
ipcMain.handle("fpga-bios-install", async (_e, platform: DevicePlatform) => {
  if (!isDeviceFolder(platform)) throw new Error("Unsupported MiSTer platform.");
  const { client, f } = await connectFpga();
  try {
    const destination = `${f.root}/${platform}`;
    await client.mkdir(destination, true);
    for (const file of devicePlatform(platform).bios) {
      const response = await fetch(file.url, { headers: { "User-Agent": `GameStore/${app.getVersion()}` } });
      if (!response.ok) throw new Error(`Update All BIOS source returned ${response.status} for ${file.name}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash("md5").update(bytes).digest("hex") !== file.md5)
        throw new Error(`Update All BIOS checksum failed for ${file.name}; no file was installed.`);
      await client.put(bytes, `${destination}/${file.name}`);
    }
    return biosStatus(client, f.root, platform);
  } finally { await client.end(); }
});
/**
 * Deletion is given the name the inventory displayed, which for a cartridge
 * console is a ROM filename with its extension dropped. The real entry is
 * resolved by listing the folder and matching that same display name, so the
 * app deletes something it has actually just seen rather than a path built by
 * string concatenation, and a name that no longer resolves fails safely.
 */
ipcMain.handle("fpga-device-delete", async (_e, platform: DevicePlatform, folder: string) => {
  if (!isDeviceFolder(platform) || !/^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/.test(folder))
    throw new Error("Unsafe device entry refused.");
  const definition = devicePlatform(platform);
  const { client, f } = await connectFpga();
  try {
    const root = `${f.root}/${platform}`;
    const entries = (await client.list(root).catch(() => [])).filter((entry) =>
      isGameEntry(definition, entry),
    );
    const match = entries.find(
      (entry) => deviceEntryTitle(definition, entry.name) === folder,
    );
    if (!match) throw new Error("That game is no longer on the device.");
    const target = `${root}/${match.name}`;
    if (definition.layout === "folder") {
      if ((await client.exists(target)) !== "d")
        throw new Error("That game folder is no longer on the device.");
      await client.rmdir(target, true);
    } else {
      if ((await client.exists(target)) !== "-")
        throw new Error("That game file is no longer on the device.");
      await client.delete(target);
    }
    await refreshFpgaInventory().catch(() => undefined);
    return { deleted: folder };
  } finally { await client.end(); }
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
      deviceName?: string;
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
    const host = String(incoming.host || DEFAULT_DEVICE_NAME).trim();
    // A name the user typed is worth keeping as the durable identity; an
    // address is only ever this week's lease.
    const deviceName = String(
      incoming.deviceName || (isIpv4(host) ? previous?.deviceName || DEFAULT_DEVICE_NAME : host),
    ).trim();
    await writeSettings({
      ...existing,
      fpga: {
        host,
        deviceName,
        // A different box means the recorded identity no longer describes it.
        hostKey: host === previous?.host ? previous?.hostKey : undefined,
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
type FpgaSettingsShape = NonNullable<ProviderSettings["fpga"]>;

/**
 * One SSH/SFTP connection, capturing the host key on the way in.
 *
 * `expectKey` turns the handshake into an identity check: `hostVerifier`
 * returning false aborts before authentication, so a rediscovered address that
 * is not the configured device never sees the password.
 */
const openSftp = async (host: string, f: FpgaSettingsShape, expectKey?: string, readyTimeout = 12000) => {
  let hostKey = "";
  const client = new SftpClient();
  await client.connect({
    host,
    port: f.port || 22,
    username: f.username || "root",
    password: f.password,
    readyTimeout,
    hostVerifier: (key: Buffer) => {
      hostKey = createHash("sha256").update(key).digest("base64");
      return !expectKey || hostKey === expectKey;
    },
  });
  return { client, hostKey };
};

/** Records the address that worked, plus the identity proving it was the device. */
const rememberDevice = async (host: string, hostKey: string, previous: FpgaSettingsShape) => {
  if (previous.host === host && previous.hostKey === hostKey) return;
  const raw = JSON.parse(await fs.readFile(settingsFile(), "utf8").catch(() => "{}"));
  await writeSettings({
    ...raw,
    fpga: { ...raw.fpga, host, hostKey: hostKey || raw.fpga?.hostKey },
    // The cached PSX listing is keyed on the address, so a move invalidates it.
    ...(previous.host === host ? {} : { fpgaInventory: undefined }),
  });
  if (previous.host !== host) win?.webContents.send("fpga-address-changed", { host });
};

/**
 * Connects to the configured device, finding it again if it moved.
 *
 * The stored address is a cache. When DHCP hands the MiSTer a new lease every
 * saved address goes stale at once, which is what made this feel unreliable, so
 * a failure here is treated as "look again" rather than as an error to report.
 */
const connectFpga = async () => {
  const f = (await readSettings()).fpga;
  if (!f?.host)
    throw new Error(
      "Configure a SuperStation One or MiSTer in Settings first.",
    );

  let firstFailure: unknown;
  for (const address of await resolveAddress(f.host)) {
    // Probe before handshaking: a stale address would otherwise sit in SSH's
    // connect for over a minute, which is what made a moved device feel hung
    // rather than merely moved.
    if (!(await isReachable(address, f.port || 22))) continue;
    try {
      const { client, hostKey } = await openSftp(address, f);
      await rememberDevice(address, hostKey, f);
      return { client, f: { ...f, host: address } };
    } catch (error) {
      firstFailure ??= error;
    }
  }

  win?.webContents.send("fpga-locating", { stage: "Looking for your device…" });
  const located = await locateDevice({
    configuredHost: f.host,
    deviceName: f.deviceName || DEFAULT_DEVICE_NAME,
    port: f.port || 22,
    onStage: (stage) => win?.webContents.send("fpga-locating", { stage }),
    scan: () =>
      discoverFpgaDevices((done, total) =>
        win?.webContents.send("fpga-discovery-progress", { done, total }),
      ),
    // Reachability is not identity. Require the recorded host key when there is
    // one, and otherwise require the device to actually look like a MiSTer, so
    // a NAS that accepts the same password is never adopted silently.
    accept: async (host) => {
      try {
        // A short handshake budget: this is a probe of a machine that is
        // probably not the device, not the working connection.
        const { client } = await openSftp(host, f, f.hostKey, 4000);
        try {
          return f.hostKey ? true : await client.exists("/media/fat") !== false;
        } finally {
          await client.end();
        }
      } catch {
        return false;
      }
    },
  });

  if (!located) {
    win?.webContents.send("fpga-locating", { stage: "" });
    throw new Error(
      `Could not reach your device. GameStore tried ${f.host}, asked the network for ` +
        `${f.deviceName || DEFAULT_DEVICE_NAME}, and scanned for it. Check that it is powered on ` +
        "and on this network, then use Scan network in Settings.",
    );
  }

  const { client, hostKey } = await openSftp(located.host, f, f.hostKey);
  await rememberDevice(located.host, hostKey, f);
  win?.webContents.send("fpga-locating", { stage: "" });
  return { client, f: { ...f, host: located.host } };
};
ipcMain.handle("fpga-test", async () => {
  const { client, f } = await connectFpga();
  try {
    const mediaFat = await client.exists("/media/fat");
    const exists = await client.exists(`${f.root}/PSX`);
    const at = `Reached it at ${f.host}.`;
    return {
      ok: true,
      host: f.host,
      message: mediaFat
        ? exists
          ? `Confirmed MiSTer/SuperStation layout — PSX folder found. ${at}`
          : `Confirmed MiSTer/SuperStation layout — PSX folder will be created on first transfer. ${at}`
        : `SSH connected, but /media/fat was not found. Verify that ${f.host} is the intended device.`,
    };
  } finally {
    await client.end();
  }
});
const transferFilesToFpga = async (gameTitle: string, filePaths: string[], platform: DevicePlatform = "PSX") => {
  const extensions = filePaths.map((file) =>
    path.extname(file).toLowerCase(),
  );
  const definition = devicePlatform(platform);
  if (extensions.some((ext) => !definition.extensions.includes(ext)))
    throw new Error(definition.transferHint);
  if (extensions.includes(".cue") && !extensions.includes(".bin"))
    throw new Error("Select the CUE and every referenced BIN file together.");
  const { client, f } = await connectFpga();
  const safeName = gameTitle.replace(/[\\/:*?"<>|]/g, "-").trim();
  // A cartridge goes straight into the core folder. Wrapping a single `.z64`
  // in a folder per game is a disc-console habit and does not match how a
  // MiSTer N64 directory is actually laid out.
  const remoteDir =
    definition.layout === "folder"
      ? `${f.root}/${platform}/${safeName}`
      : `${f.root}/${platform}`;
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
/**
 * Translation patching. The renderer owns the curated manifest and resolves a
 * game's expected Redump target from it, then hands that target here; the main
 * process owns every filesystem decision, so a renderer cannot choose where a
 * patched image is written.
 */
ipcMain.handle("translation-pick-file", async (_e, kind: "image" | "patch", title: string) => {
  const picked = await dialog.showOpenDialog(win!, {
    title: kind === "image" ? `Select the original ${title} disc image` : `Select the ${title} translation patch`,
    properties: ["openFile"],
    filters: kind === "image"
      ? [{ name: "PlayStation disc images", extensions: ["bin", "img", "iso"] }]
      : [{ name: "Translation patches", extensions: ["ppf", "ips", "bps", "ups", "xdelta"] }],
  });
  return picked.canceled || !picked.filePaths.length ? null : picked.filePaths[0];
});
ipcMain.handle("translation-find-source", async (_e, title: string) => {
  return findCartDiscImage(libraryRoot(), title);
});
ipcMain.handle("translation-browse-patch", (_e, request: {
  gameId: string; title: string; url: string; expectedFile?: string; container: string;
}) => openTranslationBrowser(win!, libraryRoot(), request));
ipcMain.handle("translation-apply", async (_e, request: {
  gameId: string;
  title: string;
  sourcePath: string;
  patchPath: string;
  outputName: string;
  target?: TranslationTarget;
  expectedPatchSha256?: string;
  expectedOutputSha1?: string;
  team?: string;
  allowUnverifiedSource?: boolean;
}) => {
  const folder = `${request.title.replace(/[\\/:*?"<>|]/g, "-").trim()} (English)`;
  const destinationDirectory = path.join(libraryRoot(), "Games", "PSX", folder);
  const entry = await applyTranslation(libraryRoot(), { ...request, destinationDirectory });

  // A patched copy that only exists on disk is not much use: queue it the way a
  // completed download is queued, so it can actually be sent to the device. The
  // cart entry carries its own translated marker because the copy keeps the
  // original release filename and cannot be identified by name alone.
  const produced = await fs.readdir(destinationDirectory).catch(() => [] as string[]);
  await addToCart(libraryRoot(), {
    id: `PSX:${folder.toLowerCase()}`,
    title: `${request.title} (English patch)`,
    platform: "PSX",
    directory: destinationDirectory,
    files: produced.map((file) => path.join(destinationDirectory, file)),
    translated: { team: request.team, appliedAt: entry.appliedAt },
  });
  win?.webContents.send("library-changed");
  return entry;
});
ipcMain.handle("translation-list", () => readProvenance(libraryRoot()));
ipcMain.handle("library-cart-get", () => getCart(libraryRoot()));
ipcMain.handle("library-cart-remove", async (_e, id: string) => {
  const cart = await removeFromCart(libraryRoot(), id);
  win?.webContents.send("library-changed");
  return cart;
});
ipcMain.handle("library-cart-checkout", async () => {
  if (!(await getCart(libraryRoot())).length) throw new Error("The MiSTer cart is empty.");
  const completed = await checkoutCart(libraryRoot(), async (item) => {
    // Cart items store the core folder; a console the build does not carry is
    // refused by name rather than silently transferred into the wrong folder.
    const platform = deviceFolderForStored(item.platform);
    if (!platform) throw new Error(`${item.title} targets ${item.platform}; that MiSTer console route is not configured yet.`);
    await transferFilesToFpga(item.title, item.files, platform);
  }, () => win?.webContents.send("library-changed"));
  return { items: completed.length, files: completed.reduce((sum, item) => sum + item.files.length, 0) };
});
ipcMain.handle("fpga-transfer", async (_e, gameTitle: string, catalogPlatform?: string) => {
  const platform = deviceFolderForCatalog(catalogPlatform);
  const definition = devicePlatform(platform);
  const picked = await dialog.showOpenDialog(win!, {
    title: `Select ${gameTitle} game files`,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: `${definition.label} game files`, extensions: definition.extensions.map((extension) => extension.slice(1)) }],
  });
  if (picked.canceled || !picked.filePaths.length) return { canceled: true };
  return transferFilesToFpga(gameTitle, picked.filePaths, platform);
});
ipcMain.handle("fpga-transfer-library", async (_e, gameTitle: string, catalogPlatform?: string) => {
  const platform = deviceFolderForCatalog(catalogPlatform);
  // A title alone is not an identity: the same title can exist in several
  // console libraries. The renderer supplies its catalog platform and legacy
  // all-caps SATURN records are normalized before comparison.
  const item = (await getCart(libraryRoot())).find(
    (entry) => entry.title === gameTitle && deviceFolderForStored(entry.platform) === platform,
  );
  if (!item) throw new Error("This game is not currently in the MiSTer cart.");
  const result = await transferFilesToFpga(gameTitle, item.files, platform);
  await removeFromCart(libraryRoot(), item.id);
  win?.webContents.send("library-changed");
  return result;
});

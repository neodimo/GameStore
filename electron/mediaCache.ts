import { app, BrowserWindow } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type LongplayItem = { identifier: string; title: string };
type ArchiveFile = {
  name?: string;
  format?: string;
  size?: string;
  length?: string;
};
const TTL = 7 * 24 * 60 * 60 * 1000;
const root = () => path.join(app.getPath("userData"), "media-cache");
const indexFile = () => path.join(root(), "longplays.json");
const safeId = (value: string) => {
  if (!/^[\w.-]+$/.test(value)) throw new Error("Invalid media identifier.");
  return value;
};
/** Renderer-safe address for a local media-cache file. */
export const mediaAssetUrl = (file: string) =>
  `${MEDIA_SCHEME}://asset/${Buffer.from(file).toString("base64url")}`;

/**
 * Uploaders do not agree on what to call the console. Searching only
 * `title:("PSX Longplay")` found 693 recordings and matched 53 of the 100
 * catalog games; accepting `PS1` and `PlayStation` too finds 998 and matches
 * 67, because whole runs of the collection are filed under the other names.
 */
const LONGPLAY_QUERY =
  "title:(Longplay) AND (title:(PSX) OR title:(PS1) OR title:(PlayStation)) AND mediatype:movies";
/**
 * `PlayStation` also matches every later console, and those are near enough to
 * be dangerous rather than merely useless: `Playstation 4 Longplay [055] Final
 * Fantasy XV` scored 0.70 against the catalog's `Final Fantasy Tactics`,
 * against a 0.72 floor. Later generations are dropped before scoring ever runs.
 */
const OTHER_GENERATION = /\bplay\s*station\s*[2345]\b|\bps[2345]\b/i;

export const getLongplayIndex = async (
  force = false,
): Promise<LongplayItem[]> => {
  try {
    const cached = JSON.parse(await fs.readFile(indexFile(), "utf8"));
    if (
      !force &&
      Date.now() - cached.fetchedAt < TTL &&
      cached.items?.length &&
      cached.query === LONGPLAY_QUERY
    )
      return cached.items;
  } catch {
    /* fetch below */
  }
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", LONGPLAY_QUERY);
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.set("rows", "1200");
  url.searchParams.set("output", "json");
  const response = await fetch(url, {
    headers: { "User-Agent": `GameStore/${app.getVersion()}` },
  });
  if (!response.ok)
    throw new Error(`Internet Archive search returned ${response.status}`);
  const found = ((await response.json()) as any)?.response
    ?.docs as LongplayItem[];
  if (!found?.length)
    throw new Error("Internet Archive longplay index was empty.");
  const items = found.filter(
    (item) => !OTHER_GENERATION.test(item.title || item.identifier),
  );
  await fs.mkdir(root(), { recursive: true });
  await fs.writeFile(
    indexFile(),
    JSON.stringify({ fetchedAt: Date.now(), query: LONGPLAY_QUERY, items }),
    "utf8",
  );
  return items;
};

export const cacheScreenshots = async (gameId: string, urls: string[]) => {
  const target = path.join(root(), "screenshots", safeId(gameId));
  await fs.mkdir(target, { recursive: true });
  const results: { sourceUrl: string; localUrl: string }[] = [];
  for (const sourceUrl of urls.slice(0, 40)) {
    const parsed = new URL(sourceUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "thumbnails.libretro.com"
    )
      continue;
    const name = `${crypto.createHash("sha1").update(sourceUrl).digest("hex")}.png`;
    const file = path.join(target, name);
    try {
      await fs.access(file);
    } catch {
      const response = await fetch(sourceUrl, {
        headers: { "User-Agent": `GameStore/${app.getVersion()}` },
      });
      if (!response.ok) continue;
      const temp = `${file}.part`;
      await fs.writeFile(temp, Buffer.from(await response.arrayBuffer()));
      await fs.rename(temp, file);
    }
    results.push({ sourceUrl, localUrl: mediaAssetUrl(file) });
  }
  return results;
};

const videoDir = (identifier: string) =>
  path.join(root(), "videos", safeId(identifier));
const chooseVideo = (files: ArchiveFile[]) =>
  files
    .filter(
      (file) =>
        file.name &&
        /\.mp4$/i.test(file.name) &&
        Number(file.size) > 5_000_000 &&
        !/sample|thumb/i.test(file.name!),
    )
    .sort((a, b) => {
      const ad = /512kb|h\.264/i.test(a.format || a.name || "") ? 0 : 1;
      const bd = /512kb|h\.264/i.test(b.format || b.name || "") ? 0 : 1;
      return ad - bd || Number(a.size) - Number(b.size);
    })[0];

/**
 * Runtime in seconds. Archive states it as either a decimal count of seconds
 * or an `h:mm:ss` clock, depending on which derivation wrote the record.
 */
const seconds = (value?: string) => {
  if (!value) return 0;
  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

export const MEDIA_SCHEME = "gsmedia";
const archiveUrl = (identifier: string, name: string) =>
  `https://archive.org/download/${identifier}/${name
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

/**
 * Everything needed to *play* a recording without first possessing it.
 *
 * The previous contract offered a local file or nothing, and the arithmetic
 * made it nothing: the matched recording for a typical catalog game runs 448 MB
 * to 2.28 GB against a 120 MB automatic-cache ceiling, so the app resolved a
 * video, declined to fetch it and rendered a download button — every time, for
 * every game. Archive serves `accept-ranges: bytes`, so a player can stream a
 * thirty-second window out of a two-gigabyte file instead.
 */
export type VideoPreview = {
  identifier: string;
  name: string;
  size: number;
  format: string;
  duration: number;
  streamUrl: string;
  gifUrl?: string;
  cached: boolean;
  localUrl?: string;
};

const metadataCache = new Map<string, { at: number; file: ArchiveFile; gif?: string }>();

const archiveMetadata = async (identifier: string) => {
  const hit = metadataCache.get(identifier);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const response = await fetch(`https://archive.org/metadata/${identifier}`, {
    headers: { "User-Agent": `GameStore/${app.getVersion()}` },
  });
  if (!response.ok)
    throw new Error(`Internet Archive metadata returned ${response.status}`);
  const files: ArchiveFile[] = ((await response.json()) as any)?.files ?? [];
  const file = chooseVideo(files);
  if (!file?.name)
    throw new Error("No playable MP4 derivative is available.");
  const gif = files.find((item) => /Animated GIF/i.test(item.format || ""))?.name;
  const entry = { at: Date.now(), file, gif };
  metadataCache.set(identifier, entry);
  return entry;
};

export const getVideoPreview = async (
  identifier: string,
): Promise<VideoPreview> => {
  safeId(identifier);
  const { file, gif } = await archiveMetadata(identifier);
  const local = path.join(videoDir(identifier), path.basename(file.name!));
  let cached = false;
  try {
    cached = (await fs.stat(local)).size === Number(file.size);
  } catch {
    /* not downloaded */
  }
  return {
    identifier,
    name: file.name!,
    size: Number(file.size),
    format: file.format || "MP4",
    duration: seconds(file.length),
    streamUrl: `${MEDIA_SCHEME}://video/${identifier}`,
    gifUrl: gif ? archiveUrl(identifier, gif) : undefined,
    cached,
    localUrl: cached ? mediaAssetUrl(local) : undefined,
  };
};

/**
 * Byte-range proxy behind the app's own scheme.
 *
 * Two problems make a bare `<video src="https://archive.org/…">` unfit. First,
 * archive's storage nodes intermittently answer a valid range request with
 * `500` — reproduced three times in a row on one item while a neighbouring item
 * answered `206` three times in a row — and a media element treats that as a
 * dead video with no retry. Second, frame grabbing needs an untainted canvas,
 * which needs CORS the redirected storage node does not reliably send. Serving
 * the bytes from a privileged app scheme fixes both: retries live here, and the
 * response is same-origin by construction.
 */
/**
 * Retries are spaced because the failure they answer is a sick storage node,
 * not a dropped packet. `https://archive.org/download/…` redirects to whichever
 * node holds the item, and a node can stay unhealthy for seconds at a time —
 * measured: three consecutive `500`s on one item while a neighbouring item
 * answered `206` three times in a row. Hammering it three times in a row
 * without pausing reproduces the same node and reports the same failure, which
 * is what surfaced as "the recording could not be opened".
 */
const RANGE_ATTEMPTS = 4;
const RANGE_BACKOFF = [0, 250, 700, 1600];
const pause = (ms: number) =>
  ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export const streamArchiveVideo = async (identifier: string, range?: string) => {
  safeId(identifier);
  const { file } = await archiveMetadata(identifier);
  const cachedFile = path.join(videoDir(identifier), path.basename(file.name!));
  try {
    if ((await fs.stat(cachedFile)).size === Number(file.size))
      return { cachedFile, size: Number(file.size) };
  } catch {
    /* stream below */
  }
  let last: unknown;
  for (let attempt = 0; attempt < RANGE_ATTEMPTS; attempt += 1) {
    await pause(RANGE_BACKOFF[attempt]);
    try {
      const response = await fetch(archiveUrl(identifier, file.name!), {
        headers: {
          "User-Agent": `GameStore/${app.getVersion()}`,
          ...(range ? { Range: range } : {}),
        },
      });
      if (response.status >= 500) {
        last = new Error(`Archive node returned ${response.status}`);
        await response.body?.cancel();
        continue;
      }
      if (!response.ok && response.status !== 206)
        throw new Error(`Archive returned ${response.status}`);
      return { response };
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("Archive stream failed.");
};

/**
 * Frames captured from a playing preview, kept as ordinary cache files so a
 * reopened game renders them immediately instead of re-seeking a remote video.
 */
export const cacheFrames = async (
  gameId: string,
  frames: { at: number; data: string }[],
) => {
  const target = path.join(root(), "frames", safeId(gameId));
  await fs.mkdir(target, { recursive: true });
  const saved: { at: number; localUrl: string }[] = [];
  for (const frame of frames) {
    const payload = frame.data.replace(/^data:image\/jpeg;base64,/, "");
    if (payload === frame.data) continue;
    const file = path.join(target, `${String(Math.round(frame.at)).padStart(6, "0")}.jpg`);
    await fs.writeFile(file, Buffer.from(payload, "base64"));
    saved.push({ at: frame.at, localUrl: mediaAssetUrl(file) });
  }
  return saved;
};

export const getCachedFrames = async (gameId: string) => {
  const target = path.join(root(), "frames", safeId(gameId));
  try {
    const names = (await fs.readdir(target)).filter((name) => name.endsWith(".jpg")).sort();
    return names.map((name) => ({
      at: Number(name.replace(".jpg", "")),
      localUrl: mediaAssetUrl(path.join(target, name)),
    }));
  } catch {
    return [];
  }
};

export const downloadVideo = async (
  identifier: string,
  window: BrowserWindow | null,
) => {
  const info = await getVideoPreview(identifier);
  if (info.cached) return info;
  const dir = videoDir(identifier);
  await fs.mkdir(dir, { recursive: true });
  const local = path.join(dir, path.basename(info.name));
  const temp = `${local}.part`;
  const response = await fetch(archiveUrl(identifier, info.name), {
    headers: { "User-Agent": `GameStore/${app.getVersion()}` },
  });
  if (!response.ok || !response.body)
    throw new Error(`Video download returned ${response.status}`);
  let bytes = 0;
  const progress = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      window?.webContents.send("media-video-progress", {
        identifier,
        bytes,
        total: info.size,
        percent: Math.min(100, Math.round((bytes / info.size) * 100)),
      });
      controller.enqueue(chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body.pipeThrough(progress) as any),
    await fs.open(temp, "w").then((handle) => handle.createWriteStream()),
  );
  await fs.rename(temp, local);
  return { ...info, cached: true, localUrl: mediaAssetUrl(local) };
};

const walkSize = async (dir: string): Promise<number> => {
  let total = 0;
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      total += entry.isDirectory()
        ? await walkSize(child)
        : (await fs.stat(child)).size;
    }
  } catch {
    /* absent */
  }
  return total;
};
export const cacheStats = async () => ({
  bytes: await walkSize(root()),
  path: root(),
});
export const clearMediaCache = async () => {
  await fs.rm(root(), { recursive: true, force: true });
  return cacheStats();
};

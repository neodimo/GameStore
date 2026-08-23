import { app, BrowserWindow } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

type LongplayItem = { identifier: string; title: string };
type ArchiveFile = { name?: string; format?: string; size?: string };
const TTL = 7 * 24 * 60 * 60 * 1000;
const root = () => path.join(app.getPath("userData"), "media-cache");
const indexFile = () => path.join(root(), "longplays.json");
const safeId = (value: string) => {
  if (!/^[\w.-]+$/.test(value)) throw new Error("Invalid media identifier.");
  return value;
};
const fileUrl = (file: string) => pathToFileURL(file).href;

export const getLongplayIndex = async (
  force = false,
): Promise<LongplayItem[]> => {
  try {
    const cached = JSON.parse(await fs.readFile(indexFile(), "utf8"));
    if (!force && Date.now() - cached.fetchedAt < TTL && cached.items?.length)
      return cached.items;
  } catch {
    /* fetch below */
  }
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", 'title:("PSX Longplay") AND mediatype:movies');
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.set("rows", "1000");
  url.searchParams.set("output", "json");
  const response = await fetch(url, {
    headers: { "User-Agent": `GameStore/${app.getVersion()}` },
  });
  if (!response.ok)
    throw new Error(`Internet Archive search returned ${response.status}`);
  const items = ((await response.json()) as any)?.response
    ?.docs as LongplayItem[];
  if (!items?.length)
    throw new Error("Internet Archive longplay index was empty.");
  await fs.mkdir(root(), { recursive: true });
  await fs.writeFile(
    indexFile(),
    JSON.stringify({ fetchedAt: Date.now(), items }),
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
    results.push({ sourceUrl, localUrl: fileUrl(file) });
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

export const getVideoInfo = async (identifier: string) => {
  safeId(identifier);
  const response = await fetch(`https://archive.org/metadata/${identifier}`, {
    headers: { "User-Agent": `GameStore/${app.getVersion()}` },
  });
  if (!response.ok)
    throw new Error(`Internet Archive metadata returned ${response.status}`);
  const file = chooseVideo(((await response.json()) as any)?.files ?? []);
  if (!file?.name)
    throw new Error("No downloadable MP4 derivative is available.");
  const local = path.join(videoDir(identifier), path.basename(file.name));
  let cached = false;
  try {
    cached = (await fs.stat(local)).size === Number(file.size);
  } catch {
    /* not downloaded */
  }
  return {
    identifier,
    name: file.name,
    size: Number(file.size),
    format: file.format || "MP4",
    cached,
    localUrl: cached ? fileUrl(local) : undefined,
  };
};

export const downloadVideo = async (
  identifier: string,
  window: BrowserWindow | null,
) => {
  const info = await getVideoInfo(identifier);
  if (info.cached) return info;
  const dir = videoDir(identifier);
  await fs.mkdir(dir, { recursive: true });
  const local = path.join(dir, path.basename(info.name));
  const temp = `${local}.part`;
  const response = await fetch(
    `https://archive.org/download/${identifier}/${encodeURIComponent(info.name)}`,
    { headers: { "User-Agent": `GameStore/${app.getVersion()}` } },
  );
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
  return { ...info, cached: true, localUrl: fileUrl(local) };
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

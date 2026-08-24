import { app, nativeImage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { mediaAssetUrl } from "./mediaCache";

/**
 * Libretro publishes every PlayStation cover as a 512x512 PNG averaging ~433 KB.
 * The catalog grid paints them into cards a fraction of that size, so painting
 * the library straight from the remote originals costs hundreds of megabytes of
 * transfer and roughly a megabyte of decoded bitmap per visible cover. Covers
 * are therefore downscaled and re-encoded once, on first sight, and served from
 * disk afterwards.
 *
 * The cache is disposable: a miss falls back to the remote original, so clearing
 * it costs bandwidth rather than visibility.
 */
const TARGET_PX = 384;
const QUALITY = 85;
/** Concurrent upstream fetches. Enough to fill a viewport, few enough to be polite. */
const MAX_INFLIGHT = 6;

const root = () => path.join(app.getPath("userData"), "media-cache", "covers");
const keyFor = (url: string) =>
  crypto.createHash("sha1").update(url).digest("hex");
const fileFor = (url: string) => path.join(root(), `${keyFor(url)}.jpg`);

/** In-flight and failed lookups, so a repainting grid never refetches. */
const inflight = new Map<string, Promise<string | null>>();
const failed = new Set<string>();
let active = 0;
const queue: (() => void)[] = [];

const acquire = async () => {
  if (active < MAX_INFLIGHT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
};
const release = () => {
  active -= 1;
  queue.shift()?.();
};

/**
 * Downscales to the largest size any card actually paints. Covers already at or
 * below that size are re-encoded but not upscaled, and non-square art keeps its
 * aspect ratio because only the long edge is constrained.
 */
const shrink = (buffer: Buffer) => {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error("Unreadable cover image.");
  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  const resized =
    longest > TARGET_PX
      ? image.resize(
          width >= height
            ? { width: TARGET_PX, quality: "best" }
            : { height: TARGET_PX, quality: "best" },
        )
      : image;
  return resized.toJPEG(QUALITY);
};

const fetchAndStore = async (url: string): Promise<string | null> => {
  await acquire();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": `GameStore/${app.getVersion()}` },
    });
    if (!response.ok) throw new Error(`Cover fetch returned ${response.status}`);
    const encoded = shrink(Buffer.from(await response.arrayBuffer()));
    if (!encoded.length) throw new Error("Cover re-encode produced no data.");
    const target = fileFor(url);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Write-then-rename so a crash mid-write cannot leave a truncated cover
    // that would render as a broken image on every later launch.
    const temp = `${target}.${process.pid}.part`;
    await fs.writeFile(temp, encoded);
    await fs.rename(temp, target);
    return mediaAssetUrl(target);
  } catch {
    failed.add(url);
    return null;
  } finally {
    release();
  }
};

/**
 * Returns a local address for `url`, caching it on first request. Null means the
 * cover could not be cached and the caller should use the remote original.
 *
 * A miss costs one upstream fetch — the same fetch the renderer would have made
 * painting the remote original — so first sight is no slower than having no
 * cache, and every later sight is an order of magnitude lighter. Concurrent
 * requests for the same cover share one fetch, which matters because a fast
 * scroll asks for the same art repeatedly as cards mount and unmount.
 */
export const getCachedCover = async (url: string): Promise<string | null> => {
  if (!/^https:\/\//i.test(url)) return null;
  if (failed.has(url)) return null;
  const target = fileFor(url);
  try {
    const stat = await fs.stat(target);
    if (stat.isFile() && stat.size > 0) return mediaAssetUrl(target);
  } catch {
    // Not cached yet.
  }
  const existing = inflight.get(url);
  if (existing) return existing;
  const task = fetchAndStore(url).finally(() => inflight.delete(url));
  inflight.set(url, task);
  return task;
};

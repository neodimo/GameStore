import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Libretro publishes one thumbnail file per No-Intro release. Matching a
 * catalog title needs the whole filename list, so the index is fetched once
 * and cached on disk; the renderer does the scoring locally afterwards.
 */
const SYSTEM = "Sony%20-%20PlayStation";
const FOLDERS = ["Named_Boxarts", "Named_Titles", "Named_Snaps"] as const;
export type ArtFolder = (typeof FOLDERS)[number];
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HREF = /href="([^"]+\.png)"/gi;

export type ArtIndex = { folder: string; files: string[]; fetchedAt: number };

const cacheFile = (folder: string) =>
  path.join(app.getPath("userData"), "art-index", `${folder}.json`);

const readCache = async (folder: string): Promise<ArtIndex | null> => {
  try {
    const cached = JSON.parse(
      await fs.readFile(cacheFile(folder), "utf8"),
    ) as ArtIndex;
    return Array.isArray(cached.files) && cached.files.length ? cached : null;
  } catch {
    return null;
  }
};

const parseListing = (html: string) => {
  const files = new Set<string>();
  for (const [, href] of html.matchAll(HREF)) {
    try {
      files.add(decodeURIComponent(href));
    } catch {
      files.add(href);
    }
  }
  return [...files];
};

const download = async (folder: ArtFolder): Promise<ArtIndex> => {
  const response = await fetch(
    `https://thumbnails.libretro.com/${SYSTEM}/${folder}/`,
    { headers: { "User-Agent": `GameStore/${app.getVersion()}` } },
  );
  if (!response.ok)
    throw new Error(`Libretro thumbnails returned ${response.status}`);
  const files = parseListing(await response.text());
  if (!files.length) throw new Error("Libretro thumbnail listing was empty.");
  return { folder, files, fetchedAt: Date.now() };
};

/**
 * Returns the cached index unless it is older than the TTL or a refresh is
 * forced. A failed refresh falls back to stale data rather than leaving the
 * catalog with no artwork at all.
 */
export const getArtIndex = async (
  folder: string,
  force = false,
): Promise<ArtIndex> => {
  if (!FOLDERS.includes(folder as ArtFolder))
    throw new Error(`Unsupported thumbnail folder: ${folder}`);
  const cached = await readCache(folder);
  if (cached && !force && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  try {
    const fresh = await download(folder as ArtFolder);
    await fs.mkdir(path.dirname(cacheFile(folder)), { recursive: true });
    await fs.writeFile(cacheFile(folder), JSON.stringify(fresh), "utf8");
    return fresh;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
};

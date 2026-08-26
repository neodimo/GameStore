import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Libretro publishes one thumbnail file per No-Intro release, per console.
 * Matching a catalog title needs the whole filename list, so each system's
 * index is fetched once and cached on disk; the renderer does the scoring
 * locally afterwards.
 *
 * The system used to be a module constant reading `Sony - PlayStation`, which
 * is why no non-PlayStation console could ever resolve artwork. It is now a
 * caller-supplied parameter, validated against the registry so a request can
 * only ever name a console the app actually carries.
 */
const FOLDERS = ["Named_Boxarts", "Named_Titles", "Named_Snaps"] as const;
export type ArtFolder = (typeof FOLDERS)[number];
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HREF = /href="([^"]+\.png)"/gi;

/**
 * Every Libretro system the catalog may ask for. Kept as an explicit allowlist
 * rather than derived from the renderer's request, so an arbitrary path can
 * never be appended to the thumbnail host.
 */
const SYSTEMS = new Set([
  "Sony%20-%20PlayStation",
  "Nintendo%20-%20Nintendo%2064",
  "Sega%20-%20Saturn",
]);

export type ArtIndex = {
  system: string;
  folder: string;
  files: string[];
  fetchedAt: number;
};

/**
 * Cached per system as well as per folder. Sharing one cache file across
 * consoles would hand the N64 catalog a list of PlayStation filenames, which is
 * how a title collision picks the wrong box art.
 */
const cacheFile = (system: string, folder: string) =>
  path.join(
    app.getPath("userData"),
    "art-index",
    `${decodeURIComponent(system).replace(/[^a-z0-9]+/gi, "-")}.${folder}.json`,
  );

const readCache = async (
  system: string,
  folder: string,
): Promise<ArtIndex | null> => {
  try {
    const cached = JSON.parse(
      await fs.readFile(cacheFile(system, folder), "utf8"),
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

const download = async (
  system: string,
  folder: ArtFolder,
): Promise<ArtIndex> => {
  const response = await fetch(
    `https://thumbnails.libretro.com/${system}/${folder}/`,
    { headers: { "User-Agent": `GameStore/${app.getVersion()}` } },
  );
  if (!response.ok)
    throw new Error(`Libretro thumbnails returned ${response.status}`);
  const files = parseListing(await response.text());
  if (!files.length) throw new Error("Libretro thumbnail listing was empty.");
  return { system, folder, files, fetchedAt: Date.now() };
};

/**
 * Returns the cached index unless it is older than the TTL or a refresh is
 * forced. A failed refresh falls back to stale data rather than leaving the
 * catalog with no artwork at all.
 */
export const getArtIndex = async (
  system: string,
  folder: string,
  force = false,
): Promise<ArtIndex> => {
  if (!SYSTEMS.has(system))
    throw new Error(`Unsupported thumbnail system: ${system}`);
  if (!FOLDERS.includes(folder as ArtFolder))
    throw new Error(`Unsupported thumbnail folder: ${folder}`);
  const cached = await readCache(system, folder);
  if (cached && !force && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  try {
    const fresh = await download(system, folder as ArtFolder);
    await fs.mkdir(path.dirname(cacheFile(system, folder)), { recursive: true });
    await fs.writeFile(
      cacheFile(system, folder),
      JSON.stringify(fresh),
      "utf8",
    );
    return fresh;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
};

/**
 * The real MiSTer core catalog, derived from the official distribution's own
 * machine-readable manifest rather than a hand-maintained list.
 *
 * `MiSTer-devel/Distribution_MiSTer` — the same repository the real
 * Downloader/Update All tool reads — publishes `db.json.zip`: every file the
 * base image installs, each with its relative path, MD5, byte size, and a
 * shared set of tags. A hand-curated core list would either drift from this
 * or have to be re-verified by hand every time; a catalog built directly from
 * this file can't disagree with what the official installer itself would
 * write; a first pass that hand-picked 16 cores was checked against a real
 * device and turned out to be missing that device's PSX, N64, and Saturn
 * cores simply because they were not in the hand-picked list.
 *
 * Two things only this manifest's own shared `tags` reveal, not filenames:
 * - An arcade `.rbf` in `_Arcade/cores/` and its playable `.mra` files in
 *   `_Arcade/` are linked by sharing one specific tag (e.g. both a Donkey
 *   Kong `.rbf` and `Donkey Kong (US, Set 1).mra` carry `arcadedonkeykong`),
 *   which is how one arcade board core can back several romset variants.
 * - Every file's exact installed path is already the path this catalog must
 *   write to — there is no separate "repo publishes X, device gets Y" rename
 *   to track, because the manifest already describes the installed layout.
 */

import yauzl from "yauzl";

const DB_ZIP_URL = "https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip";

type RawFileEntry = { hash: string; size: number; tags?: number[] };
export type RawDb = {
  base_files_url: string;
  files: Record<string, RawFileEntry>;
  tag_dictionary: Record<string, number>;
};

export type CoreCategory = "arcade" | "computer" | "console" | "other";

export type CatalogFile = { path: string; hash: string; size: number };

export type CoreCatalogEntry = {
  id: string;
  name: string;
  category: CoreCategory;
  /** Path relative to `/media/fat`, exactly as the official installer writes it. */
  rbfPath: string;
  rbfHash: string;
  rbfSize: number;
  /** Arcade only: every `.mra` this board core plays, path relative to `/media/fat`. */
  mraFiles: CatalogFile[];
};

const CATEGORY_FOLDERS: Record<CoreCategory, string> = {
  arcade: "_Arcade",
  computer: "_Computer",
  console: "_Console",
  other: "_Other",
};

/** Curated display names for the systems most people recognize; everything
 * else falls back to a mechanically humanized version of its own filename,
 * which stays honest about names this catalog was never told directly. */
const NAME_OVERRIDES: Record<string, string> = {
  "3DO": "3DO",
  "Apple-IIgs": "Apple IIgs",
  NES: "Nintendo Entertainment System",
  SNES: "Super Nintendo Entertainment System",
  PSX: "Sony PlayStation",
  N64: "Nintendo 64",
  Saturn: "Sega Saturn",
  MegaDrive: "Sega Genesis / Mega Drive",
  TurboGrafx16: "TurboGrafx-16 / PC Engine",
  Gameboy: "Game Boy / Game Boy Color",
  Gameboy2P: "Game Boy (2 Player)",
  GBA: "Game Boy Advance",
  MegaCD: "Sega CD / Mega-CD",
  S32X: "Sega 32X",
  SMS: "Sega Master System",
  NeoGeo: "Neo Geo",
  AtariST: "Atari ST",
  C64: "Commodore 64",
  "Apple-II": "Apple II",
  ao486: "ao486 (PC compatible)",
  Amiga: "Amiga",
};

/** `DonkeyKong` -> `Donkey Kong`, `IremM72` -> `Irem M72`. Mechanical, not a lookup. */
const humanize = (prefix: string) =>
  NAME_OVERRIDES[prefix] ??
  prefix
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .trim();

/** Strips one trailing parenthetical, e.g. `Galaga (Midway, Set 1)` -> `Galaga`. */
const stripVariant = (title: string) => title.replace(/\s*\([^()]*\)\s*$/, "").trim();

const extractDbJson = (zipBuffer: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Could not open the MiSTer distribution database."));
      let found = false;
      zip.on("error", reject);
      zip.on("end", () => { if (!found) reject(new Error("db.json was not present in the downloaded archive.")); });
      zip.on("entry", (entry) => {
        if (entry.fileName !== "db.json") return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error("Could not read db.json."));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => resolve(Buffer.concat(chunks)));
          stream.on("error", reject);
        });
      });
      zip.readEntry();
    });
  });

const GENERIC_ARCADE_TAGS = new Set(["arcadecores", "cores", "arcaderbfsonly", "mra", "alternatives"]);

/** The one tag, if any, that names this specific arcade board rather than describing it generally. */
const arcadeFamilyTag = (tagNames: string[]) =>
  tagNames.find((tag) => tag.startsWith("arcade") && !GENERIC_ARCADE_TAGS.has(tag));

const categoryFor = (path: string): CoreCategory | undefined => {
  if (path.startsWith("_Arcade/cores/")) return "arcade";
  if (path.startsWith("_Computer/")) return "computer";
  if (path.startsWith("_Console/")) return "console";
  if (path.startsWith("_Other/")) return "other";
  return undefined;
};

/** `_Console/PSX_20260807.rbf` -> `PSX`. Handles an occasional trailing revision letter. */
const rbfPrefix = (fileName: string) => fileName.replace(/_\d{8}[a-z]?\.rbf$/i, "");

/** Pure transform from the parsed manifest to the catalog this app shows. Kept separate from fetching/unzipping so it can be tested against a small fixture instead of the live 70 KB manifest. */
export const buildCatalog = (db: RawDb): { entries: CoreCatalogEntry[]; baseFilesUrl: string } => {
  const tagNames = Object.fromEntries(Object.entries(db.tag_dictionary).map(([name, id]) => [id, name]));
  const named = (entry: RawFileEntry) => (entry.tags ?? []).map((id) => tagNames[id]).filter((name): name is string => !!name);

  const arcadeCores = new Map<string, { fileName: string; path: string; hash: string; size: number }>();
  const arcadeMras = new Map<string, { path: string; title: string; hash: string; size: number }[]>();
  const bySystem = new Map<string, { path: string; hash: string; size: number; category: CoreCategory }>();

  for (const [path, entry] of Object.entries(db.files)) {
    // An arcade `.mra` sits directly in `_Arcade/`, not `_Arcade/cores/`, so it
    // must be checked before the folder-prefix category lookup below, which
    // only recognizes the four installable-rbf folders.
    if (path.startsWith("_Arcade/") && !path.startsWith("_Arcade/cores/") && path.toLowerCase().endsWith(".mra")) {
      const family = arcadeFamilyTag(named(entry));
      if (!family) continue;
      const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.mra$/i, "");
      (arcadeMras.get(family) ?? arcadeMras.set(family, []).get(family)!).push({ path, title, hash: entry.hash, size: entry.size });
      continue;
    }
    const category = categoryFor(path);
    if (!category) continue;
    if (category === "arcade") {
      const family = arcadeFamilyTag(named(entry));
      const fileName = path.slice(path.lastIndexOf("/") + 1);
      if (!family) continue;
      const existing = arcadeCores.get(family);
      if (!existing || fileName.localeCompare(existing.fileName) > 0)
        arcadeCores.set(family, { fileName, path, hash: entry.hash, size: entry.size });
      continue;
    }
    // Computer/console/other: one rbf per system, keep the newest dated file.
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    if (!fileName.toLowerCase().endsWith(".rbf")) continue;
    const system = rbfPrefix(fileName);
    const existing = bySystem.get(system);
    if (!existing || fileName.localeCompare(existing.path.slice(existing.path.lastIndexOf("/") + 1)) > 0)
      bySystem.set(system, { path, hash: entry.hash, size: entry.size, category });
  }

  const entries: CoreCatalogEntry[] = [];
  for (const [family, core] of arcadeCores) {
    const mras = (arcadeMras.get(family) ?? []).sort((a, b) => a.title.localeCompare(b.title));
    const name = mras.length ? stripVariant(mras[0].title) : humanize(rbfPrefix(core.fileName));
    entries.push({
      id: `arcade:${family}`,
      name,
      category: "arcade",
      rbfPath: core.path,
      rbfHash: core.hash,
      rbfSize: core.size,
      mraFiles: mras.map((mra) => ({ path: mra.path, hash: mra.hash, size: mra.size })),
    });
  }
  for (const [system, core] of bySystem) {
    entries.push({
      id: `${core.category}:${system.toLowerCase()}`,
      name: humanize(system),
      category: core.category,
      rbfPath: core.path,
      rbfHash: core.hash,
      rbfSize: core.size,
      mraFiles: [],
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, baseFilesUrl: db.base_files_url };
};

/**
 * Every file in the manifest is served from one pinned-commit raw URL plus
 * its own relative path. Each path segment is percent-encoded on its own —
 * filenames routinely carry spaces and parentheses — while the `/` separators
 * are preserved.
 */
export const buildDownloadUrl = (baseFilesUrl: string, relativePath: string) =>
  baseFilesUrl + relativePath.split("/").map(encodeURIComponent).join("/");

let cached: { fetchedAt: number; entries: CoreCatalogEntry[]; baseFilesUrl: string } | undefined;
const CACHE_TTL_MS = 60 * 60 * 1000;

export const fetchCoreCatalog = async (force = false): Promise<CoreCatalogEntry[]> => {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.entries;
  const response = await fetch(DB_ZIP_URL, { headers: { "User-Agent": "GameStore-MiSTerCores" } });
  if (!response.ok) throw new Error(`MiSTer distribution database returned ${response.status}.`);
  const zipBuffer = Buffer.from(await response.arrayBuffer());
  const db: RawDb = JSON.parse((await extractDbJson(zipBuffer)).toString("utf8"));
  const { entries, baseFilesUrl } = buildCatalog(db);
  cached = { fetchedAt: Date.now(), entries, baseFilesUrl };
  return entries;
};

export const coreCategoryFolder = (category: CoreCategory) => CATEGORY_FOLDERS[category];

export const findCoreById = async (id: string) => (await fetchCoreCatalog()).find((entry) => entry.id === id);

export const resolveDownloadUrl = async (relativePath: string) => {
  await fetchCoreCatalog();
  if (!cached) throw new Error("MiSTer distribution database is not loaded.");
  return buildDownloadUrl(cached.baseFilesUrl, relativePath);
};

/** Whether a listed device filename is this core's rbf, ignoring which dated revision is installed. */
export const matchesInstalledRbf = (core: Pick<CoreCatalogEntry, "rbfPath">, filename: string) => {
  const installedFileName = core.rbfPath.slice(core.rbfPath.lastIndexOf("/") + 1);
  return rbfPrefix(filename).toLowerCase() === rbfPrefix(installedFileName).toLowerCase() && filename.toLowerCase().endsWith(".rbf");
};

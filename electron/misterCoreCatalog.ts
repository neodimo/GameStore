/**
 * The real MiSTer core catalog, derived from the same manifests the official
 * `update_all.sh` tool (theypsilon/Update_All_MiSTer) reads, rather than a
 * hand-maintained list.
 *
 * A hand-picked first version was checked against a real device and turned
 * out to be missing that device's PSX, N64, and Saturn cores simply because
 * they were not in the hand-picked list. `MiSTer-devel/Distribution_MiSTer`
 * publishes `db.json.zip` — every file the base image installs, each with its
 * relative path, MD5, byte size, and a shared set of tags — and a catalog
 * built directly from it can't disagree with what the official installer
 * itself would write. `update_all.sh`'s own `databases.py` names the handful
 * of other manifests in this same machine-readable shape that its "UNOFFICIAL
 * CORES" section reads; `CORE_SOURCES` below carries only the ones that are
 * (a) actually core-bearing rather than manuals/wallpapers/scripts, and (b)
 * install into one of the real folders a MiSTer core loader scans, so this
 * catalog never claims a source it can't actually place `.rbf`s into.
 *
 * Two things only a manifest's own shared `tags` reveal, not filenames:
 * - An arcade `.rbf` in `_Arcade/cores/` and its playable `.mra` files in
 *   `_Arcade/` are linked by sharing one specific tag (e.g. both a Donkey
 *   Kong `.rbf` and `Donkey Kong (US, Set 1).mra` carry `arcadedonkeykong`),
 *   which is how one arcade board core can back several romset variants.
 * - Every file's exact installed path is already the path this catalog must
 *   write to — there is no separate "repo publishes X, device gets Y" rename
 *   to track, because the manifest already describes the installed layout.
 *
 * Each source keeps its own tag dictionary, so a family tag is never compared
 * across sources — two sources coincidentally both having an `arcadefoo` tag
 * would not merge two different reimplementations into one entry. Every
 * catalog id is therefore prefixed with its source id.
 */

import yauzl from "yauzl";

export type CoreCategory = "arcade" | "computer" | "console" | "llapi" | "other";
export type CoreTier = "official" | "unofficial";

export type CoreSource = {
  id: string;
  /** Matches `update_all.sh`'s own database title, so this catalog's source labels are traceable back to it. */
  title: string;
  dbUrl: string;
  tier: CoreTier;
};

/**
 * Mirrors the relevant entries of `AllDBs` in
 * https://github.com/theypsilon/Update_All_MiSTer/blob/main/src/update_all/databases.py
 * (checked 2026-08-28). Excluded from that file's much longer list: manuals,
 * wallpapers, names/TXT, BIOS, and script/utility databases, none of which
 * carry cores; `Arcade_Offset` (alternate `.mra` romsets for cores this
 * catalog already lists, not new hardware); and `Dual-Ram-Console-Cores`
 * (installs into a nonstandard `_Console (Dual SDRAM)` folder that needs
 * modified hardware a normal MiSTer does not have).
 */
export const CORE_SOURCES: CoreSource[] = [
  {
    id: "official",
    title: "MiSTer-devel Distribution",
    dbUrl: "https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip",
    tier: "official",
  },
  {
    id: "jtcores",
    title: "JTCORES",
    dbUrl: "https://raw.githubusercontent.com/jotego/jtcores_mister/main/jtbindb.json.zip",
    tier: "unofficial",
  },
  {
    id: "theypsilon_unofficial",
    title: "theypsilon Unofficial Distribution",
    dbUrl: "https://raw.githubusercontent.com/theypsilon/Distribution_Unofficial_MiSTer/main/unofficialdb.json.zip",
    tier: "unofficial",
  },
  {
    id: "coin_op_collection",
    title: "Coin-Op Collection",
    dbUrl: "https://raw.githubusercontent.com/Coin-OpCollection/Distribution-MiSTerFPGA/db/db.json.zip",
    tier: "unofficial",
  },
  {
    id: "llapi",
    title: "LLAPI Folder",
    dbUrl: "https://raw.githubusercontent.com/MiSTer-LLAPI/LLAPI_folder_MiSTer/main/llapidb.json.zip",
    tier: "unofficial",
  },
  {
    id: "alt_cores",
    title: "Alt Cores (ajgowans)",
    dbUrl: "https://raw.githubusercontent.com/ajgowans/alt-cores/db/db.json.zip",
    tier: "unofficial",
  },
];

type RawFileEntry = { hash: string; size: number; tags?: number[] };
export type RawDb = {
  base_files_url: string;
  files: Record<string, RawFileEntry>;
  tag_dictionary: Record<string, number>;
};

export type CatalogFile = { path: string; hash: string; size: number };

export type CoreCatalogEntry = {
  id: string;
  name: string;
  category: CoreCategory;
  source: string;
  tier: CoreTier;
  /** This entry's own pinned-commit raw base URL; sources are never mixed for one download. */
  baseFilesUrl: string;
  /** Path relative to `/media/fat`, exactly as the source's own installer writes it. */
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
  llapi: "_LLAPI",
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

/**
 * Some arcade boards are one game with a few regional/revision `.mra`s
 * (Donkey Kong: US + Japan); others are a whole multi-game board a real
 * arcade PCB ran dozens of different titles on (CPS2: 320 `.mra`s covering
 * everything from Darkstalkers to 1944 The Loop Master). Naming the second
 * kind after whichever title sorts first is not wrong exactly — that mra is
 * real and playable — but it reads as if the core were that one game.
 */
const MULTI_GAME_BOARD_THRESHOLD = 4;
const arcadeName = (mras: { title: string }[], fallbackPrefix: string) => {
  if (!mras.length) return humanize(fallbackPrefix);
  const flagship = stripVariant(mras[0].title);
  return mras.length > MULTI_GAME_BOARD_THRESHOLD ? `${flagship} + ${mras.length - 1} more` : flagship;
};

const extractDbJson = (zipBuffer: Buffer, entryName: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Could not open the MiSTer core database archive."));
      let found = false;
      zip.on("error", reject);
      zip.on("end", () => { if (!found) reject(new Error(`${entryName} was not present in the downloaded archive.`)); });
      zip.on("entry", (entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error(`Could not read ${entryName}.`));
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
  if (path.startsWith("_LLAPI/")) return "llapi";
  if (path.startsWith("_Other/")) return "other";
  return undefined;
};

/** `_Console/PSX_20260807.rbf` -> `PSX`; `_Arcade/cores/jt1942.rbf` -> `jt1942`. Always drops the extension; the dated-revision suffix is optional because not every source dates its releases. */
const rbfPrefix = (fileName: string) => fileName.replace(/(_\d{8}[a-z]?)?\.rbf$/i, "");

/** Pure transform from one parsed manifest to this catalog's shape. Kept separate from fetching/unzipping so it can be tested against a small fixture instead of a live manifest, and run once per source. */
export const buildCatalog = (db: RawDb, source: CoreSource): CoreCatalogEntry[] => {
  const tagNames = Object.fromEntries(Object.entries(db.tag_dictionary).map(([name, id]) => [id, name]));
  const named = (entry: RawFileEntry) => (entry.tags ?? []).map((id) => tagNames[id]).filter((name): name is string => !!name);

  const arcadeCores = new Map<string, { fileName: string; path: string; hash: string; size: number }>();
  const arcadeMras = new Map<string, { path: string; title: string; hash: string; size: number }[]>();
  const bySystem = new Map<string, { path: string; hash: string; size: number; category: CoreCategory }>();

  for (const [path, entry] of Object.entries(db.files)) {
    // An arcade `.mra` sits directly in `_Arcade/`, not `_Arcade/cores/`, so it
    // must be checked before the folder-prefix category lookup below, which
    // only recognizes the installable-rbf folders.
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
    // Computer/console/LLAPI/other: one rbf per system, keep the newest dated file.
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
    const name = arcadeName(mras, rbfPrefix(core.fileName));
    entries.push({
      id: `${source.id}:arcade:${family}`,
      name,
      category: "arcade",
      source: source.title,
      tier: source.tier,
      baseFilesUrl: db.base_files_url,
      rbfPath: core.path,
      rbfHash: core.hash,
      rbfSize: core.size,
      mraFiles: mras.map((mra) => ({ path: mra.path, hash: mra.hash, size: mra.size })),
    });
  }
  for (const [system, core] of bySystem) {
    const name = core.category === "llapi" ? `${humanize(system.replace(/_LLAPI$/i, ""))} (LLAPI)` : humanize(system);
    entries.push({
      id: `${source.id}:${core.category}:${system.toLowerCase()}`,
      name,
      category: core.category,
      source: source.title,
      tier: source.tier,
      baseFilesUrl: db.base_files_url,
      rbfPath: core.path,
      rbfHash: core.hash,
      rbfSize: core.size,
      mraFiles: [],
    });
  }
  return entries;
};

/**
 * Every file in a manifest is served from that manifest's own pinned-commit
 * raw URL plus its own relative path. Each path segment is percent-encoded on
 * its own — filenames routinely carry spaces and parentheses — while the `/`
 * separators are preserved.
 */
export const buildDownloadUrl = (baseFilesUrl: string, relativePath: string) =>
  baseFilesUrl + relativePath.split("/").map(encodeURIComponent).join("/");

const zipEntryName = (dbUrl: string) => dbUrl.slice(dbUrl.lastIndexOf("/") + 1).replace(/\.zip$/i, "");

const fetchSource = async (source: CoreSource): Promise<CoreCatalogEntry[]> => {
  const response = await fetch(source.dbUrl, { headers: { "User-Agent": "GameStore-MiSTerCores" } });
  if (!response.ok) throw new Error(`${source.title} returned ${response.status}.`);
  const zipBuffer = Buffer.from(await response.arrayBuffer());
  const db: RawDb = JSON.parse((await extractDbJson(zipBuffer, zipEntryName(source.dbUrl))).toString("utf8"));
  return buildCatalog(db, source);
};

let cached: { fetchedAt: number; entries: CoreCatalogEntry[] } | undefined;
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Fetches every configured source in parallel. The official distribution
 * must load or this throws; an unofficial source failing (a moved repo, a
 * rate limit) only drops that source's cores rather than the whole catalog,
 * since it is supplementary by definition.
 */
export const fetchCoreCatalog = async (force = false): Promise<CoreCatalogEntry[]> => {
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.entries;
  const [official, ...rest] = CORE_SOURCES;
  const [officialEntries, unofficialResults] = await Promise.all([
    fetchSource(official),
    Promise.allSettled(rest.map((source) => fetchSource(source))),
  ]);
  const entries = [...officialEntries, ...unofficialResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []))];
  entries.sort((a, b) => a.name.localeCompare(b.name));
  cached = { fetchedAt: Date.now(), entries };
  return entries;
};

export const coreCategoryFolder = (category: CoreCategory) => CATEGORY_FOLDERS[category];

export const findCoreById = async (id: string) => (await fetchCoreCatalog()).find((entry) => entry.id === id);

/** Whether a listed device filename is this core's rbf, ignoring which dated revision is installed. */
export const matchesInstalledRbf = (core: Pick<CoreCatalogEntry, "rbfPath">, filename: string) => {
  const installedFileName = core.rbfPath.slice(core.rbfPath.lastIndexOf("/") + 1);
  return rbfPrefix(filename).toLowerCase() === rbfPrefix(installedFileName).toLowerCase() && filename.toLowerCase().endsWith(".rbf");
};

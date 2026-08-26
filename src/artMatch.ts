/**
 * Fuzzy resolution of catalog titles against No-Intro style artwork filenames.
 *
 * Libretro thumbnail packs name every file after the No-Intro release, so the
 * only reliable way to find a game's box art is to score the whole index
 * instead of guessing one exact filename. Scoring is deliberately pure and
 * synchronous so it can be unit tested against a ground-truth fixture.
 */
export type Region = "USA" | "Europe" | "Japan";
export type Confidence = "high" | "medium" | "low";
export type ArtMatch = {
  file: string;
  url: string;
  label: string;
  tags: string[];
  score: number;
  confidence: Confidence;
  source: string;
};

export const artFolders = {
  Named_Boxarts: "Box art",
  Named_Titles: "Title screen",
  Named_Snaps: "Screenshot",
} as const;
export type ArtFolder = keyof typeof artFolders;

/** Below this score a candidate is treated as noise rather than a weak match. */
export const MATCH_FLOOR = 0.6;
/**
 * The manual deep-search panel is a browsing surface, not an auto-picker, so it
 * uses a looser floor: the user is choosing with their eyes and a near-miss
 * release they can reject is more useful than an empty grid.
 */
export const BROWSE_FLOOR = 0.3;
const HIGH = 1.4;
const MEDIUM = 0.95;
/**
 * Score reported for a seeded exact filename hit. Finite so the picker's
 * percentage readout stays meaningful, and above HIGH so it always outranks
 * anything the fuzzy scorer can produce.
 */
export const EXACT_SCORE = 2;

const TAG = /\s*[([]([^)\]]*)[)\]]/g;
const ARTICLE_SUFFIX = /^(.*),\s*(The|A|An|Le|La|Les|Der|Die|Das|El|Los)$/;
const NOISE_TAG =
  /\b(demo|beta|proto|sample|promo|trial|taikenban|kiosk|not for resale|special disc|bonus|genteiban|shokai|alt|hack|preview|magazine|rev \d)\b/i;
const DISC_TAG = /\bdisc\s*(\d+)/i;
const REGION_TAGS: [string, string][] = [
  ["usa", "USA"],
  ["europe", "Europe"],
  ["japan", "Japan"],
  ["world", "World"],
];

const foldMarks = (value: string) =>
  value
    .replace(/[³]/g, "3")
    .replace(/[²]/g, "2")
    .replace(/[’‘]/g, "'")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Lowercased, de-punctuated, article-free form used for every comparison. */
export const normalizeTitle = (value: string) =>
  foldMarks(value)
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Splits `Unholy War, The (USA) (Rev 1).png` into core title and tag list. */
export const parseArtFilename = (file: string) => {
  const base = file.replace(/\.(png|jpg|jpeg|webp)$/i, "");
  const tags = [...base.matchAll(TAG)].map((m) => m[1].trim());
  let core = base.replace(TAG, "").trim();
  const swapped = ARTICLE_SUFFIX.exec(core);
  if (swapped) core = `${swapped[2]} ${swapped[1]}`;
  return { core, tags };
};

const bigrams = (value: string) => {
  const squashed = value.replace(/ /g, "");
  const set = new Set<string>();
  for (let i = 0; i < squashed.length - 1; i += 1)
    set.add(squashed.slice(i, i + 2));
  return set.size ? set : new Set([squashed]);
};
const dice = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
};

/**
 * Everything about a thumbnail filename that does not depend on the title being
 * searched for. Scoring one game against the whole index used to re-parse and
 * re-normalize all 9,339 filenames, so the cost was (games × files) string work
 * rather than (games × files) set intersections. Hoisting it here is what makes
 * a full-catalog resolve affordable.
 */
type PreparedArtFile = {
  file: string;
  core: string;
  tags: string[];
  normalizedCore: string;
  squashedCore: string;
  mainSegment: string;
  coreWords: Set<string>;
  coreBigrams: Set<string>;
  regions: string[];
  /** Tag-only penalties (noise, later discs, tag count) — query-independent. */
  staticPenalty: number;
};

/** A title reduced to the forms every candidate comparison needs. */
type PreparedQuery = {
  normalized: string;
  squashed: string;
  words: Set<string>;
  bigrams: Set<string>;
};

export type PreparedArtIndex = {
  files: string[];
  entries: PreparedArtFile[];
  /** Exact No-Intro name (no extension) → filename. */
  byName: Map<string, string>;
  /** Same, with `(v1.1)` / `(Rev 1)` printings folded together. */
  byLooseName: Map<string, string>;
};

const prepareFile = (file: string): PreparedArtFile => {
  const { core, tags } = parseArtFilename(file);
  const normalizedCore = normalizeTitle(core);
  const tagText = tags.join(" ").toLowerCase();
  let staticPenalty = -0.015 * tags.length;
  if (NOISE_TAG.test(tagText)) staticPenalty -= 0.6;
  const disc = DISC_TAG.exec(tagText);
  if (disc) staticPenalty -= disc[1] === "1" ? 0.12 : 0.7;
  return {
    file,
    core,
    tags,
    normalizedCore,
    squashedCore: normalizedCore.replace(/ /g, ""),
    mainSegment: normalizeTitle(core.split(" - ")[0]),
    coreWords: new Set(normalizedCore.split(" ")),
    coreBigrams: bigrams(normalizedCore),
    regions: REGION_TAGS.filter(([key]) => tagText.includes(key)).map(
      ([, value]) => value,
    ),
    staticPenalty,
  };
};

const prepareQuery = (title: string): PreparedQuery => {
  const normalized = normalizeTitle(title);
  return {
    normalized,
    squashed: normalized.replace(/ /g, ""),
    words: new Set(normalized.split(" ")),
    bigrams: bigrams(normalized),
  };
};

/** Release-version tags are printings of one cover, not different artwork. */
const VERSION_TAG = /\s*\((?:v[\d.]+|Rev [^)]*)\)/gi;
export const stripReleaseVersion = (name: string) =>
  name.replace(VERSION_TAG, "").trim();

export const prepareArtIndex = (files: string[]): PreparedArtIndex => {
  const entries = files.map(prepareFile);
  const byName = new Map<string, string>();
  const byLooseName = new Map<string, string>();
  for (const file of files) {
    const name = file.replace(/\.(png|jpg|jpeg|webp)$/i, "");
    if (!byName.has(name)) byName.set(name, file);
    const loose = stripReleaseVersion(name);
    if (!byLooseName.has(loose)) byLooseName.set(loose, file);
  }
  return { files, entries, byName, byLooseName };
};

/**
 * Preparation is keyed on the index array itself so repeated resolves against
 * the same fetched index pay for it once, without changing any call signature.
 */
const preparedCache = new WeakMap<string[], PreparedArtIndex>();
export const artIndexFor = (files: string[]): PreparedArtIndex => {
  const cached = preparedCache.get(files);
  if (cached) return cached;
  const prepared = prepareArtIndex(files);
  preparedCache.set(files, prepared);
  return prepared;
};

const scorePrepared = (
  query: PreparedQuery,
  region: Region,
  entry: PreparedArtFile,
) => {
  if (!entry.normalizedCore || !query.normalized) return 0;
  let score =
    0.55 * dice(query.words, entry.coreWords) +
    0.45 * dice(query.bigrams, entry.coreBigrams);

  if (query.normalized === entry.normalizedCore) score += 0.6;
  else if (query.squashed === entry.squashedCore) score += 0.55;
  else if (query.normalized === entry.mainSegment) score += 0.42;
  else if (entry.normalizedCore.startsWith(`${query.normalized} `)) score += 0.1;

  const { regions } = entry;
  if (regions.includes(region)) score += 0.3;
  else if (regions.includes("World")) score += 0.22;
  else if (regions.includes("USA")) score += 0.16;
  else if (regions.includes("Europe")) score += 0.12;
  else if (regions.includes("Japan")) score += 0.08;

  let extraWords = 0;
  for (const word of entry.coreWords)
    if (!query.words.has(word)) extraWords += 1;
  return score + entry.staticPenalty - 0.03 * extraWords;
};

/**
 * Blends word-level and character-level similarity so both dropped subtitles
 * ("Baroque" → "Baroque - Yuganda Mousou") and romanization drift
 * ("ParanoiaScape" → "Paranoia Scape") resolve to the right release.
 */
export const scoreArtCandidate = (
  title: string,
  region: Region,
  file: string,
) => scorePrepared(prepareQuery(title), region, prepareFile(file));

/**
 * Region-free similarity for provider results that arrive as plain titles
 * (TheGamesDB) rather than No-Intro filenames.
 */
export const titleSimilarity = (a: string, b: string) => {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return (
    0.55 * dice(new Set(left.split(" ")), new Set(right.split(" "))) +
    0.45 * dice(bigrams(left), bigrams(right))
  );
};

export const confidenceOf = (score: number): Confidence =>
  score >= HIGH ? "high" : score >= MEDIUM ? "medium" : "low";

/**
 * Which Libretro thumbnail pack a set of filenames came from.
 *
 * The system used to be baked into the URL builder as `Sony - PlayStation`, so
 * every non-PlayStation cover resolved to an address that does not exist. It is
 * now carried alongside the folder and has no default, because a default is
 * exactly what let one console's identity stand in for every other console's.
 */
export type ArtSource = { system: string; folder: ArtFolder };

export const libretroArtUrl = (source: ArtSource, file: string) =>
  `https://thumbnails.libretro.com/${source.system}/${source.folder}/${encodeURIComponent(file)}`;

/**
 * Ranks an entire thumbnail index for one title. `limit` keeps the deep-search
 * panel readable; the auto-resolver only ever consumes the first entry.
 */
export const rankArtCandidates = (
  title: string,
  region: Region,
  files: string[],
  source: ArtSource,
  limit = 24,
  floor = MATCH_FLOOR,
): ArtMatch[] => {
  const query = prepareQuery(title);
  const scored: ArtMatch[] = [];
  for (const entry of artIndexFor(files).entries) {
    const score = scorePrepared(query, region, entry);
    if (score < floor) continue;
    scored.push({
      file: entry.file,
      url: libretroArtUrl(source, entry.file),
      label: entry.core,
      tags: entry.tags,
      score,
      confidence: confidenceOf(score),
      source: `Libretro · ${artFolders[source.folder]}`,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return scored.slice(0, limit);
};

/** Best single automatic match, or null when nothing clears the floor. */
export const resolveArt = (
  title: string,
  region: Region,
  files: string[],
  source: ArtSource,
): ArtMatch | null => rankArtCandidates(title, region, files, source, 1)[0] ?? null;

/**
 * The catalog importer already records each game's No-Intro cover name, so most
 * titles need a map lookup rather than a 9,339-candidate scan. Only entries with
 * no seeded name — or a name the index does not carry — fall through to fuzzy
 * matching. Version/revision printings are folded together because they are the
 * same cover art.
 */
export const exactArtMatch = (
  coverName: string | undefined,
  files: string[],
  source: ArtSource,
): ArtMatch | null => {
  if (!coverName) return null;
  const index = artIndexFor(files);
  const file =
    index.byName.get(coverName) ??
    index.byLooseName.get(stripReleaseVersion(coverName));
  if (!file) return null;
  const { core, tags } = parseArtFilename(file);
  return {
    file,
    url: libretroArtUrl(source, file),
    label: core,
    tags,
    score: EXACT_SCORE,
    confidence: "high",
    source: `Libretro · ${artFolders[source.folder]}`,
  };
};

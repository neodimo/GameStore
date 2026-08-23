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
 * Blends word-level and character-level similarity so both dropped subtitles
 * ("Baroque" → "Baroque - Yuganda Mousou") and romanization drift
 * ("ParanoiaScape" → "Paranoia Scape") resolve to the right release.
 */
export const scoreArtCandidate = (
  title: string,
  region: Region,
  file: string,
) => {
  const { core, tags } = parseArtFilename(file);
  const normalizedQuery = normalizeTitle(title);
  const normalizedCore = normalizeTitle(core);
  if (!normalizedCore || !normalizedQuery) return 0;
  const queryWords = new Set(normalizedQuery.split(" "));
  const coreWords = new Set(normalizedCore.split(" "));
  let score =
    0.55 * dice(queryWords, coreWords) +
    0.45 * dice(bigrams(normalizedQuery), bigrams(normalizedCore));

  const mainSegment = normalizeTitle(core.split(" - ")[0]);
  if (normalizedQuery === normalizedCore) score += 0.6;
  else if (
    normalizedQuery.replace(/ /g, "") === normalizedCore.replace(/ /g, "")
  )
    score += 0.55;
  else if (normalizedQuery === mainSegment) score += 0.42;
  else if (normalizedCore.startsWith(`${normalizedQuery} `)) score += 0.1;

  const tagText = tags.join(" ").toLowerCase();
  const regions = REGION_TAGS.filter(([key]) => tagText.includes(key)).map(
    ([, value]) => value,
  );
  if (regions.includes(region)) score += 0.3;
  else if (regions.includes("World")) score += 0.22;
  else if (regions.includes("USA")) score += 0.16;
  else if (regions.includes("Europe")) score += 0.12;
  else if (regions.includes("Japan")) score += 0.08;

  if (NOISE_TAG.test(tagText)) score -= 0.6;
  const disc = DISC_TAG.exec(tagText);
  if (disc) score -= disc[1] === "1" ? 0.12 : 0.7;
  let extraWords = 0;
  for (const word of coreWords) if (!queryWords.has(word)) extraWords += 1;
  score -= 0.03 * extraWords;
  score -= 0.015 * tags.length;
  return score;
};

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

export const libretroArtUrl = (folder: ArtFolder, file: string) =>
  `https://thumbnails.libretro.com/Sony%20-%20PlayStation/${folder}/${encodeURIComponent(file)}`;

/**
 * Ranks an entire thumbnail index for one title. `limit` keeps the deep-search
 * panel readable; the auto-resolver only ever consumes the first entry.
 */
export const rankArtCandidates = (
  title: string,
  region: Region,
  files: string[],
  folder: ArtFolder = "Named_Boxarts",
  limit = 24,
  floor = MATCH_FLOOR,
): ArtMatch[] => {
  const scored: ArtMatch[] = [];
  for (const file of files) {
    const score = scoreArtCandidate(title, region, file);
    if (score < floor) continue;
    const { core, tags } = parseArtFilename(file);
    scored.push({
      file,
      url: libretroArtUrl(folder, file),
      label: core,
      tags,
      score,
      confidence: confidenceOf(score),
      source: `Libretro · ${artFolders[folder]}`,
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
  folder: ArtFolder = "Named_Boxarts",
): ArtMatch | null => rankArtCandidates(title, region, files, folder, 1)[0] ?? null;

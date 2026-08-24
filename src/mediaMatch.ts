/**
 * Resolution of gameplay media — screenshots and longplay video — for a
 * catalog title.
 *
 * Screenshots reuse the Libretro thumbnail index that already backs box art:
 * `Named_Snaps` holds in-game frames and `Named_Titles` holds title screens,
 * both named after the No-Intro release, so the existing scorer applies
 * unchanged. Gathering every printing of the same game is what turns a single
 * cover into a scrollable strip: multi-region and multi-disc releases each
 * contribute distinct frames.
 *
 * Video comes from the Internet Archive's longplay collection, which publishes
 * direct MP4 files rather than an embeddable player. Matching there is
 * deliberately confined to that collection: an ungated title search across all
 * of archive.org returns a Baroque *chamber music concert* for the horror RPG
 * `Baroque` and Superman for `Pepsiman`. A wrong video is worse than no video,
 * so titles with no longplay keep an empty, labelled slot.
 */
import {
  MATCH_FLOOR,
  libretroArtUrl,
  normalizeTitle,
  parseArtFilename,
  rankArtCandidates,
  scoreArtCandidate,
  titleSimilarity,
  type ArtFolder,
  type ArtMatch,
  type Region,
} from "./artMatch";

export type Screenshot = {
  url: string;
  kind: "Screenshot" | "Title screen";
  label: string;
  tags: string[];
  score: number;
};

/**
 * The regions named by a release's tag list, in No-Intro's own vocabulary.
 * A multi-region release such as `(USA, Europe)` genuinely carries both.
 */
const regionsOf = (tags: string[]) => {
  const text = tags.join(" ").toLowerCase();
  return new Set(
    (["usa", "europe", "japan", "world"] as const).filter((key) =>
      text.includes(key),
    ),
  );
};

export type LongplayMatch = {
  identifier: string;
  title: string;
  score: number;
};

/** One archive.org search result, cached by the desktop bridge. */
export type LongplayItem = { identifier: string; title: string };

/**
 * Screenshots are populated automatically with no confirmation step, so they
 * take the strict auto-pick floor rather than the loose browse floor. At the
 * browse floor a title with no snaps of its own quietly fills its strip with
 * whatever it half-resembles — `Totally Invented Game` pulls in Rayman — which
 * is the same failure as attaching the wrong video.
 */
export const SCREENSHOT_FLOOR = MATCH_FLOOR;
/**
 * Video is an automatic pick with no visual confirmation step, so it needs a
 * high bar. Tuned against the catalog: 0.72 accepts every genuine longplay and
 * rejects the closest wrong neighbours (`Irritating Stick` vs `Sitting Ducks`
 * at 0.62, `Pepsiman` vs `Superman` at 0.62, `BoomBots` vs `Bomb Boat` at
 * 0.71).
 */
export const LONGPLAY_FLOOR = 0.72;

const SCREENSHOT_FOLDERS: ArtFolder[] = ["Named_Snaps", "Named_Titles"];
const KIND: Record<string, Screenshot["kind"]> = {
  Named_Snaps: "Screenshot",
  Named_Titles: "Title screen",
};

/**
 * The part of a release name before its subtitle. No-Intro separates subtitles
 * with " - ", so this is what stays constant across printings that drop or
 * keep the subtitle.
 */
const mainSegment = (core: string) => normalizeTitle(core.split(" - ")[0]);

/**
 * True when two release names are the same game rather than two games sharing
 * a word. Comparing main segments covers regions, revisions, discs and dropped
 * subtitles (`Kowloon's Gate` and `Kowloon's Gate - Kowloon Fuusuiden`), while
 * the squashed form absorbs romanization spacing (`ParanoiaScape`).
 *
 * Free prefix matching was tried first and was wrong: it treats the unrelated
 * `Racing (USA)` as a parent of `Racing Lagoon`, because any single word is a
 * prefix of a longer title.
 */
const sameGame = (a: string, b: string) => {
  const left = mainSegment(a);
  const right = mainSegment(b);
  if (!left || !right) return false;
  return left === right || squash(left) === squash(right);
};

/**
 * Every screenshot belonging to a title's *primary* release.
 *
 * Gathering a *set* cannot use the absolute floor that picking a *single* best
 * cover uses. `Racing Lagoon` scores 1.89 against its own release, while Ford
 * Racing, 007 Racing and Nicktoons Racing all clear 0.6 — an absolute floor
 * quietly builds a 28-frame strip that is 27 other games. So the best release
 * is resolved first and used as an anchor, and only files naming that same
 * game join the strip.
 *
 * The anchor also fixes the *variant*. Pooling every printing of a game made
 * the gallery a region grab-bag: the USA release, the PAL release and the
 * Japanese release each contributed a frame of a different menu in a different
 * language, presented as if they were one game's screenshots. Only releases
 * sharing the anchor's region survive, so a USA game shows USA frames. Discs of
 * that same release still stack up, because a four-disc game is one release.
 *
 * Untagged files are deliberately excluded. A gallery that claims to be the
 * USA release cannot prove that claim from an unclassified filename, and a
 * sparse verified gallery is better than a mislabeled regional mix.
 */
export const resolveScreenshots = (
  title: string,
  region: Region,
  indexes: Partial<Record<ArtFolder, string[]>>,
  limit = 40,
): Screenshot[] => {
  const anchorFrom = (folder: ArtFolder): ArtMatch | undefined =>
    rankArtCandidates(
      title,
      region,
      indexes[folder] ?? [],
      folder,
      1,
      SCREENSHOT_FLOOR,
    )[0];
  const anchor = anchorFrom("Named_Snaps") ?? anchorFrom("Named_Titles");
  if (!anchor) return [];
  const anchorCore = parseArtFilename(anchor.file).core;
  const anchorRegions = regionsOf(anchor.tags);

  const shots: Screenshot[] = [];
  for (const folder of SCREENSHOT_FOLDERS) {
    const files = indexes[folder];
    if (!files?.length) continue;
    for (const file of files) {
      const { core, tags } = parseArtFilename(file);
      if (!sameGame(anchorCore, core)) continue;
      const regions = regionsOf(tags);
      if (
        !anchorRegions.size ||
        !regions.size ||
        ![...regions].some((value) => anchorRegions.has(value))
      )
        continue;
      shots.push({
        url: libretroArtUrl(folder, file),
        kind: KIND[folder],
        label: tags.join(" · ") || core,
        tags,
        score: scoreArtCandidate(title, region, file),
      });
    }
  }
  const rank = (shot: Screenshot) => (shot.kind === "Screenshot" ? 0 : 1);
  shots.sort((a, b) => rank(a) - rank(b) || b.score - a.score);
  return shots.slice(0, limit);
};

/**
 * Longplay titles carry collection boilerplate (`PSX Longplay [365] …`) and a
 * catalogue number that would otherwise dominate the similarity score, so both
 * are stripped before comparison.
 */
export const cleanLongplayTitle = (value: string) =>
  value
    .replace(/\b(psx|ps1|playstation)\b/gi, " ")
    .replace(/\blongplay\b/gi, " ")
    .replace(/\[\s*\d+\s*\]/g, " ")
    .replace(/\((?:us|usa|eu|europe|jp|japan|pal|ntsc)\)/gi, " ")
    .replace(/\b(?:us|usa|eu|europe|jp|japan|pal|ntsc)\b\s*$/i, " ")
    // A bare leading number is this collection's catalogue index, not a sequel.
    .replace(/^[\s\-–—:]*\d{1,4}\b/, " ")
    .replace(/^[\s\-–—:]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const ROMAN: Record<string, number> = {
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
};

/**
 * Sequence numbers carried by a game's name, in both arabic and roman form.
 *
 * This exists because sequels are the blind spot of pure string similarity:
 * `Tobal No. 2` scores *higher* against `Tobal No. 1` than against the
 * correctly-named `Tobal 2`, since the wrong entry also keeps the "No.".
 * Comparing extracted numbers separates "same game" from "the one before it".
 * `\d+` is matched anywhere rather than as a whole token so glued forms like
 * `Linda3` count.
 */
export const sequenceNumbers = (value: string) => {
  const cleaned = cleanLongplayTitle(value);
  const numbers = [...cleaned.matchAll(/\d+/g)].map((m) => Number(m[0]));
  for (const word of normalizeTitle(cleaned).split(" "))
    if (ROMAN[word] !== undefined) numbers.push(ROMAN[word]);
  return [...new Set(numbers)].sort((a, b) => a - b);
};

/** Penalty applied when two titles disagree about which entry in a series they are. */
const SEQUENCE_PENALTY = 0.35;

/**
 * Penalty per distinctive word the catalog title carries that the recording's
 * name does not.
 *
 * Blended similarity is far too forgiving about a dropped word: `Crash
 * Bandicoot: Warped` scored 0.81 against a plain `Crash Bandicoot`, clearing
 * the floor and handing the third game the first game's video, because two of
 * its three words did match and no sequence number disagreed. The check is
 * one-directional — extra words on the recording's side are just uploader
 * annotation (`- Arcade Mode`, `2nd Ignition`) — and ignores short words so
 * that `Tobal No. 2` still reaches `Tobal 2` and `R4: Ridge Racer Type 4`
 * still reaches `Ridge Racer Type 4`.
 */
const MISSING_WORD_PENALTY = 0.12;
const DISTINCTIVE_WORD = 4;
const missingWords = (title: string, candidate: string) => {
  const present = new Set(canonical(candidate).split(" "));
  return canonical(title)
    .split(" ")
    .filter((word) => word.length >= DISTINCTIVE_WORD && !present.has(word))
    .length;
};

/**
 * A dotted initialism written as one word. `Future Cop: L.A.P.D.` normalizes to
 * the four separate words `l a p d`, which shares no whole word with the
 * uploader's `Future Cop LAPD` and drags the blended score below the floor.
 */
const collapseAcronyms = (value: string) =>
  value.replace(/\b(?:[A-Za-z]\.){2,}/g, (match) => match.replace(/\./g, ""));

/**
 * The form both sides of a comparison are reduced to before scoring: dotted
 * initialisms joined and series numerals expressed one way. Box scans say
 * `Suikoden II` and uploaders say `Suikoden 2`; the sequence check already
 * understood they were the same entry, but the *string* comparison did not,
 * leaving a correct match stranded at 0.65 under a 0.72 floor.
 */
const canonical = (value: string) =>
  normalizeTitle(collapseAcronyms(value))
    .split(" ")
    .map((word) => (ROMAN[word] !== undefined ? String(ROMAN[word]) : word))
    .join(" ");

const squash = (value: string) => canonical(value).replace(/ /g, "");

/**
 * Word-level similarity collapses to zero when romanization disagrees about
 * spacing — `ParanoiaScape` and `Paranoia Scape` share no whole word — so an
 * identical letter sequence is treated as the match it plainly is. Box art
 * scoring already carries the equivalent rule.
 */
const similarity = (title: string, candidate: string) => {
  const squashed = squash(title);
  if (squashed && squashed === squash(candidate)) return 1;
  return titleSimilarity(canonical(title), canonical(candidate));
};

/**
 * The part of a name before its subtitle, for names that punctuate one.
 *
 * Longplay uploaders routinely record `Kurushi Final` and leave off
 * `: Mental Blocks`, which strands a correct match under the floor. Comparing
 * lead segments recovers those, but only where the bare lead actually names one
 * game. It is deliberately discounted, because a lead-segment agreement is
 * evidence rather than proof.
 */
const LEAD_SEGMENT_DISCOUNT = 0.92;
const leadSegment = (value: string) => {
  const [lead] = value.split(/\s+[-–—:]\s+|:/);
  return lead && lead.trim() !== value.trim() ? lead.trim() : "";
};

/**
 * How many distinct recordings in a corpus a bare name could be referring to.
 *
 * Dropping a subtitle is only safe when the remainder identifies one game, and
 * a corpus answers that directly: a name that is also the opening of a longer,
 * different name is a series, not a game. `Kurushi Final` extends nothing, so
 * the uploader who wrote it meant `Kurushi Final: Mental Blocks`. `Crash
 * Bandicoot` opens `Crash Bandicoot 2 …` and `Crash Bandicoot 3 …`, so it does
 * *not* mean `Crash Bandicoot: Warped` — and without this check it matched
 * exactly that at 0.92, handing the third game the first game's video. (The
 * genuine Warped recording is filed under the typo `Crasj Bandicoot: Warped`,
 * which is why nothing better outranked it.)
 *
 * Names are deduplicated first so that re-uploads of one recording do not read
 * as a series, and every word-boundary prefix is counted so the lookup stays a
 * single map read per candidate.
 */
const namePrefixCounts = (items: LongplayItem[]) => {
  const names = new Set<string>();
  for (const item of items) {
    const name = canonical(cleanLongplayTitle(item.title || item.identifier));
    if (name) names.add(name);
  }
  const counts = new Map<string, number>();
  for (const name of names) {
    const words = name.split(" ");
    for (let i = 1; i <= words.length; i += 1) {
      const prefix = words.slice(0, i).join(" ");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return counts;
};

/**
 * A series entry a recording names but the catalog does not, or vice versa.
 *
 * Uploaders disambiguate the first game in a series by appending a `1` the box
 * never carried — `Suikoden 1`, `Alundra 1` — which the sequence check read as
 * "different entry" and penalised into rejection. Only the first entry gets
 * this latitude: `Resident Evil` and `Resident Evil 2` must stay apart.
 */
const sameSeriesEntry = (wanted: number[], found: number[]) => {
  if (wanted.length === found.length)
    return wanted.every((value, i) => value === found[i]);
  const [fewer, more] = wanted.length < found.length ? [wanted, found] : [found, wanted];
  return fewer.length === 0 && more.length === 1 && more[0] === 1;
};

export const scoreLongplay = (
  title: string,
  item: LongplayItem,
  leads?: Map<string, number>,
) => {
  const cleaned = cleanLongplayTitle(item.title || item.identifier);
  if (!normalizeTitle(cleaned)) return 0;
  const lead = leadSegment(title);
  const candidateLead = leadSegment(cleaned) || cleaned;
  const ambiguous = (leads?.get(canonical(candidateLead)) ?? 1) > 1;
  const score = Math.max(
    similarity(title, cleaned) -
      MISSING_WORD_PENALTY * missingWords(title, cleaned),
    lead && !ambiguous
      ? LEAD_SEGMENT_DISCOUNT * similarity(lead, candidateLead)
      : 0,
  );
  const wanted = sequenceNumbers(title);
  const found = sequenceNumbers(cleaned);
  return sameSeriesEntry(wanted, found) ? score : score - SEQUENCE_PENALTY;
};

/**
 * Ranks the longplay collection for one title. The auto-picker takes the first
 * entry only when it clears `LONGPLAY_FLOOR`; the full list backs a manual
 * "choose a different recording" surface.
 */
export const rankLongplays = (
  title: string,
  items: LongplayItem[],
  limit = 12,
): LongplayMatch[] => {
  const leads = namePrefixCounts(items);
  const scored = items
    .map((item) => ({
      identifier: item.identifier,
      title: item.title || item.identifier,
      score: scoreLongplay(title, item, leads),
    }))
    .filter((entry) => entry.score > 0.4);
  scored.sort(
    (a, b) => b.score - a.score || a.identifier.localeCompare(b.identifier),
  );
  return scored.slice(0, limit);
};

export const resolveLongplay = (
  title: string,
  items: LongplayItem[],
): LongplayMatch | null => {
  const best = rankLongplays(title, items, 1)[0];
  return best && best.score >= LONGPLAY_FLOOR ? best : null;
};

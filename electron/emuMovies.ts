import { Client, type FileInfo } from "basic-ftp";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { mediaAssetUrl } from "./mediaCache";

/**
 * EmuMovies as a preview source.
 *
 * The Internet Archive path resolves a *longplay*: a two-hour recording whose
 * relationship to the catalog entry is a fuzzy score against an uploader's
 * free-text title, and which has to be streamed and sampled before it can show
 * anything. EmuMovies publishes the opposite shape — a per-game "video snap",
 * their own stated format being thirty seconds of gameplay followed by ten
 * seconds of title screen, named by the same No-Intro/Redump convention the
 * collection index already parses. That turns matching from a similarity
 * problem into a filename lookup, and turns the preview from a 2 GB stream into
 * a file measured in megabytes that can simply be cached and looped.
 *
 * Access uses the member's EmuMovies forum username and password against the
 * published file server (`files.emumovies.com`, port 21). The published API
 * (`api.gamesdbase.com/login.aspx?user=&api=&product=`) additionally requires a
 * registered partner product key, which this application does not have, so the
 * credential a member can actually supply is the FTP one.
 */
export type EmuMoviesCredentials = { username: string; password: string };
const EMUMOVIES_HOST = "files.emumovies.com";

export type SnapFile = { path: string; name: string; bytes: number; quality?: string };
export type SnapManifest = {
  system: string;
  folder: string;
  quality: string;
  indexedAt: number;
  files: SnapFile[];
  coverage?: SnapCoverage;
  folders?: SnapFolder[];
};
export type SnapCatalogGame = { title: string; region: string; coverName?: string };
export type SnapCoverage = {
  catalog: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
};

/**
 * What a login is allowed to conclude.
 *
 * The available directories disclose video quality once the file-server
 * account is authenticated. A failed FTP login does *not* disclose membership
 * tier. Authentication and locating content within the member's visible FTP
 * tree are reported separately.
 */
export type AccountProbe = {
  ok: boolean;
  secure: boolean;
  message: string;
  systems: string[];
  snapFolder?: string;
  qualities: string[];
};

const TIMEOUT = 25_000;
const SYSTEM_DEPTH = 5;
const MAX_LISTINGS = 160;
/**
 * Whole-probe ceiling. The listing cap alone does not bound the wall clock:
 * 160 listings that each time out at 25s is over an hour of a UI that only
 * says "Connecting". A sign-in has to finish, or say why it did not, in a time
 * a person is willing to sit through.
 */
const PROBE_BUDGET_MS = 75_000;
/**
 * Consecutive failed listings that mean the session is gone rather than the
 * folder being unreadable. Individual directories legitimately refuse access
 * per entitlement, so one failure proves nothing; several in a row while the
 * clock burns is a dead control socket being retried.
 */
const DEAD_SESSION_STREAK = 4;

export type ProbeProgress = (message: string) => void;

/** Rejects when the budget expires, so no single stage can strand the caller. */
class ProbeDeadline {
  private readonly expiresAt: number;
  constructor(budgetMs: number = PROBE_BUDGET_MS) {
    this.expiresAt = Date.now() + budgetMs;
  }
  get expired() {
    return Date.now() >= this.expiresAt;
  }
  get remainingMs() {
    return Math.max(0, this.expiresAt - Date.now());
  }
  /** Caps a stage at whatever budget is left rather than its own timeout. */
  async guard<T>(label: string, work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out ${label}.`)),
            this.remainingMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Quality tiers, best first. The names appear both as directory components
 * (`Video_Snaps_HD`) and as bare folders (`HD1080`), so each is matched by
 * pattern rather than by literal equality.
 */
const QUALITIES: [RegExp, string][] = [
  [/(?:^|[^a-z])hd(?:1080)?(?:[^a-z]|$)|1080/i, "HD1080"],
  [/(?:^|[^a-z])hq(?:480)?(?:[^a-z]|$)|480/i, "HQ480"],
  [/(?:^|[^a-z])sq(?:240)?(?:[^a-z]|$)|240/i, "SQ240"],
];
const SNAP_FOLDER = /video[\s_-]*snaps?/i;
const VIDEO_FOLDER = /video|snap|movies?/i;
/**
 * `PlayStation` alone also names every later Sony console, and those carry
 * their own complete snap sets — indexing PS3 against a PS1 catalog would
 * produce confident matches for the wrong game entirely.
 */
const LATER_SONY = /\b(2|3|4|5|portable|psp|vita)\b/i;

const SYSTEM_ALIASES: Record<string, RegExp> = {
  PS1: /sony|playstation|psx/i,
  N64: /nintendo\W*(?:64|n64)\b|\bn64\b/i,
  SAT: /sega\s*saturn|\bsaturn\b/i,
};

/**
 * Provider libraries may group consoles under a manufacturer before naming
 * the individual system (`/Nintendo/Nintendo 64/...`). These aliases are only
 * navigation hints: a vendor folder is worth descending into, but it is never
 * accepted as the requested console's video folder by itself.
 */
const SYSTEM_GROUP_ALIASES: Record<string, RegExp> = {
  PS1: /\bsony\b/i,
  N64: /\bnintendo\b/i,
  SAT: /\bsega\b/i,
};

/**
 * The member FTP's current published layout. These are deliberately concrete
 * paths, rather than hints for a crawler: the normal scrape should take a few
 * listings for the requested console, not inspect every console in a quality
 * library. The generic resolver below remains a last-resort compatibility
 * path if EmuMovies reorganises this known layout again.
 */
const OFFICIAL_VIDEO_ROOTS = [
  "/Official/Video Snaps (HD)",
  "/Official/Video Snaps (HQ)",
  "/Official/Video Snaps (SQ)",
];

const connect = async (credentials: EmuMoviesCredentials, secure: boolean) => {
  const client = new Client(TIMEOUT);
  client.ftp.verbose = false;
  await client.access({
    host: EMUMOVIES_HOST,
    user: credentials.username,
    password: credentials.password,
    secure,
    secureOptions: { servername: EMUMOVIES_HOST },
  });
  return client;
};

/**
 * Opens a session, preferring explicit TLS.
 *
 * A failed `AUTH TLS` and a rejected password are both just "the session did
 * not open", and treating them alike would report a working account as a bad
 * one. The plain retry runs only when the secure attempt failed for a reason
 * other than credentials, and the caller is told which transport it got.
 */
const openSession = async (credentials: EmuMoviesCredentials) => {
  try {
    return { client: await connect(credentials, true), secure: true };
  } catch (error) {
    if (isAuthFailure(error)) throw error;
    return { client: await connect(credentials, false), secure: false };
  }
};

const isAuthFailure = (error: unknown) => {
  const code = (error as { code?: number })?.code;
  return code === 530 || code === 430;
};

const explain = (error: unknown) => {
  if (isAuthFailure(error))
    return "EmuMovies rejected the login. Use your EmuMovies forum username and password for files.emumovies.com; a rejected login does not determine your membership tier.";
  if (error instanceof SnapSessionLost)
    return `${error.message} This is a connection problem, not a verdict about your account or membership tier. Check that port 21 to files.emumovies.com is not blocked by a firewall, VPN or ISP, then try again.`;
  const message = error instanceof Error ? error.message : String(error);
  return `Could not reach the EmuMovies file server: ${message}`;
};

const directories = (list: FileInfo[]) =>
  list.filter((item) => item.isDirectory).map((item) => item.name);

const qualityOf = (value: string) =>
  QUALITIES.find(([pattern]) => pattern.test(value))?.[1] ?? "Unknown";
const joinRemote = (base: string, name: string) =>
  `${base === "/" ? "" : base}/${name}`.replace(/\/{2,}/g, "/");
const videoFiles = (entries: FileInfo[]) =>
  entries.filter((item) => item.isFile && /\.(mp4|webm|avi)$/i.test(item.name));

export type SnapFolder = { path: string; quality: string };

/**
 * Walks down from the account root looking for a system's snap directory.
 *
 * The layout is discovered rather than assumed. EmuMovies reorganises the file
 * server periodically — it has been rebuilt at least once outright — and a
 * hardcoded path would fail as a wrong password rather than as a moved folder,
 * which is the most expensive possible way to be wrong about someone's account.
 */
/**
 * Raised when the crawl stops because the session died, so the caller reports a
 * connection failure instead of a content verdict. Swallowing listing errors and
 * running to the end of the queue turns a dropped socket into "no snap folder
 * was visible to this account", which blames the user's membership for a
 * network fault.
 */
export class SnapSessionLost extends Error {
  constructor(message = "Lost the EmuMovies connection while scanning folders.") {
    super(message);
    this.name = "SnapSessionLost";
  }
}

/**
 * `truncated` means the scan stopped early — budget or listing cap — with more
 * of the tree unvisited. An empty result then means "not reached", which is a
 * different statement from "this account has none", and the two must not be
 * reported with the same sentence.
 */
export type SnapScan = { folders: SnapFolder[]; truncated: boolean };

/**
 * Orders discovery by intent instead of breadth. EmuMovies roots can expose
 * dozens of unrelated media/system folders; FIFO traversal paid to list every
 * plausible sibling before reaching an obvious `Video Snaps` branch. Paths
 * carrying both the requested console and video language are nearly terminal,
 * followed by video/quality branches and system-first branches.
 */
const discoveryScore = (remote: string, alias: RegExp, groupAlias: RegExp) => {
  const system = alias.test(remote) && !LATER_SONY.test(remote);
  const group = groupAlias.test(remote);
  const snaps = SNAP_FOLDER.test(remote);
  const video = VIDEO_FOLDER.test(remote);
  const quality = qualityOf(remote);
  const qualityScore = quality === "HD1080" ? 40 : quality === "HQ480" ? 30 : quality === "SQ240" ? 20 : 0;
  return (system && video ? 200 : 0) + (snaps ? 100 : video ? 60 : 0) +
    (system ? 80 : group ? 30 : 0) + qualityScore + (/official/i.test(remote) ? 20 : 0);
};

/**
 * Query EmuMovies' published quality roots directly. A complete current N64
 * discovery is three root listings plus up to one console listing per tier.
 * In particular, never open every HD console merely because that root sorts
 * ahead of HQ: a requested N64 HQ folder is more useful than every unrelated
 * HD library combined.
 */
const findOfficialSnapFolders = async (
  client: Pick<Client, "list">,
  alias: RegExp,
  deadline: ProbeDeadline,
  onProgress?: ProbeProgress,
) => {
  const folders: SnapFolder[] = [];
  let listed = 0;
  let failures = 0;
  for (const root of OFFICIAL_VIDEO_ROOTS) {
    if (deadline.expired) return { folders, listed, failures, truncated: true };
    onProgress?.(`Scanning the known ${root.split("/").at(-1)} video set…`);
    let systems: FileInfo[];
    try {
      systems = await deadline.guard(`listing ${root}`, Promise.resolve(client.list(root)));
      listed += 1;
    } catch {
      failures += 1;
      continue;
    }
    const systemFolders = directories(systems).filter((name) =>
      alias.test(name) && !LATER_SONY.test(name),
    );
    for (const name of systemFolders) {
      const candidate = joinRemote(root, name);
      if (deadline.expired) return { folders, listed, failures, truncated: true };
      try {
        const entries = await deadline.guard(
          `listing ${candidate}`,
          Promise.resolve(client.list(candidate)),
        );
        listed += 1;
        if (videoFiles(entries).length)
          folders.push({ path: candidate, quality: qualityOf(root) });
      } catch {
        failures += 1;
      }
    }
  }
  return { folders, listed, failures, truncated: false };
};

export const findSnapFolders = async (
  client: Pick<Client, "list">,
  system: string,
  deadline: ProbeDeadline = new ProbeDeadline(),
  onProgress?: ProbeProgress,
): Promise<SnapScan> => {
  const alias = SYSTEM_ALIASES[system] ?? new RegExp(system, "i");
  const groupAlias = SYSTEM_GROUP_ALIASES[system] ?? alias;
  const direct = await findOfficialSnapFolders(client, alias, deadline, onProgress);
  if (direct.folders.length) {
    return {
      folders: direct.folders,
      truncated: direct.truncated,
    };
  }
  if (direct.truncated) return { folders: [], truncated: true };
  const useful = /official|video|snap|media|download/i;
  const queue = [{ path: "/", depth: 0, score: Number.MAX_SAFE_INTEGER }];
  const visited = new Set<string>();
  const found: SnapFolder[] = [];
  let failureStreak = 0;
  let failures = 0;
  let listed = 0;
  let truncated = false;
  let listingsAfterFirstMatch = 0;
  while (queue.length && visited.size < MAX_LISTINGS) {
    queue.sort((a, b) => b.score - a.score || a.depth - b.depth || a.path.localeCompare(b.path));
    const current = queue.shift()!;
    if (visited.has(current.path) || current.depth > SYSTEM_DEPTH) continue;
    if (deadline.expired) {
      truncated = true;
      break;
    }
    visited.add(current.path);
    onProgress?.(
      `Finding ${system} video folders (${visited.size} targeted paths checked)…`,
    );
    let entries: FileInfo[];
    try {
      entries = await deadline.guard(
        `listing ${current.path}`,
        Promise.resolve(client.list(current.path)),
      );
      failureStreak = 0;
      listed += 1;
    } catch {
      failures += 1;
      failureStreak += 1;
      if (failureStreak >= DEAD_SESSION_STREAK) throw new SnapSessionLost();
      continue;
    }
    const pathHasSystem = alias.test(current.path) && !LATER_SONY.test(current.path);
    // `Sony` also houses later PlayStations.  A manufacturer context must not
    // turn a rejected PS2/PS3 branch back into a broad traversal candidate.
    const pathHasGroup = groupAlias.test(current.path) && !LATER_SONY.test(current.path);
    /*
     * A console branch is the trustworthy boundary, not a spelling convention
     * for its last directory.  The live provider has used folders such as
     * `USA`, `MP4`, and entitlement labels below a system name.  Requiring
     * `video` or `snap` in that final path made those perfectly valid leaves
     * invisible even though the contained files are unambiguously video.
     */
    if (pathHasSystem && videoFiles(entries).length) {
      found.push({ path: current.path, quality: qualityOf(current.path) });
      // A provider's highest quality tier can be only a partial set. Keep
      // checking the nearby console/video candidates so coverage, rather than
      // folder name, chooses the manifest used by the catalog.
      listingsAfterFirstMatch += 1;
    }

    for (const name of directories(entries)) {
      const child = joinRemote(current.path, name);
      const childHasSystem = alias.test(name) && !LATER_SONY.test(name);
      const childHasGroup = groupAlias.test(name);
      const childHasVideo = VIDEO_FOLDER.test(name);
      /*
       * Once a manufacturer or exact-system branch is verified, its neutral
       * intermediate directories are in scope too.  This remains bounded by
       * the existing depth, listing-count, and wall-clock ceilings; it merely
       * avoids treating `Nintendo/Consoles/Nintendo 64/MP4` as unrelated just
       * because `Consoles` and `MP4` do not repeat the console name.
       */
      const relevant =
        pathHasSystem ||
        pathHasGroup ||
        childHasSystem ||
        childHasGroup ||
        childHasVideo ||
        useful.test(name) ||
        qualityOf(name) !== "Unknown";
      if (relevant) queue.push({
        path: child,
        depth: current.depth + 1,
        score: discoveryScore(child, alias, groupAlias),
      });
    }
    if (found.length && (found.some((item) => item.quality === "HD1080") &&
      found.some((item) => item.quality === "HQ480") &&
      found.some((item) => item.quality === "SQ240") || listingsAfterFirstMatch >= 12))
      break;
    if (found.length)
      queue.splice(0, queue.length, ...queue.filter((item) => item.score >= 200));
  }
  // Nothing listed at all means the session never worked, not that the account
  // has no snaps. Reporting an empty crawl as a content result is what turns a
  // dropped connection into a false claim about the user's membership.
  if (!listed && failures) throw new SnapSessionLost();
  return {
    folders: found.filter(
      (folder, index) => found.findIndex((item) => item.path === folder.path) === index,
    ),
    truncated: truncated || queue.length > 0,
  };
};

/**
 * Ranks the snap directories a folder offers by quality, best entitlement
 * first. A directory the account cannot read is not a quality it has.
 */
const rankFolders = (folders: SnapFolder[]) =>
  [...folders].sort((a, b) => {
    const order = ["HD1080", "HQ480", "SQ240", "Unknown"];
    return order.indexOf(a.quality) - order.indexOf(b.quality) || a.path.localeCompare(b.path);
  });

export async function probeAccount(
  credentials: EmuMoviesCredentials,
  onProgress?: ProbeProgress,
): Promise<AccountProbe> {
  let session: { client: Client; secure: boolean } | null = null;
  const deadline = new ProbeDeadline();
  try {
    onProgress?.("Connecting to the EmuMovies file server…");
    session = await deadline.guard(
      "connecting to the EmuMovies file server",
      openSession(credentials),
    );
    onProgress?.("Signed in to EmuMovies.");
    return {
      ok: true,
      secure: session.secure,
      systems: [],
      qualities: [],
      message: "Signed in. Use Settings → Scraping when you want to match video for a console.",
    };
  } catch (error) {
    return {
      ok: false,
      secure: false,
      systems: [],
      qualities: [],
      message: explain(error),
    };
  } finally {
    session?.client.close();
  }
}

/**
 * Reads the snap directory once and keeps the filenames.
 *
 * This is the same bargain the collection index makes: a listing is cheap to
 * store and expensive to re-fetch, and every later lookup is a string match
 * against something already on disk rather than a new FTP session.
 */
export async function indexSnaps(
  dir: string,
  credentials: EmuMoviesCredentials,
  system = "PS1",
  onProgress?: ProbeProgress,
  catalog: SnapCatalogGame[] = [],
): Promise<SnapManifest> {
  let session: { client: Client; secure: boolean } | null = null;
  try {
    session = await openSession(credentials);
    const cached = await readSnapManifest(dir, system);
    let folders: SnapFolder[] = [];
    let cachedEntries: FileInfo[] | null = null;
    if (cached?.folders?.length) {
      onProgress?.(`Refreshing ${system} video snaps from ${cached.folders.length} saved quality tiers…`);
      folders = cached.folders;
    } else if (cached?.folder) {
      onProgress?.(`Refreshing ${system} video snaps from the saved folder…`);
      try {
        cachedEntries = await session.client.list(cached.folder);
        folders = [{ path: cached.folder, quality: cached.quality }];
      } catch {
        onProgress?.(`The saved ${system} folder moved; running a targeted rediscovery…`);
      }
    }
    if (folders.length && cachedEntries && catalog.length) {
      const cachedFiles = videoFiles(cachedEntries).map((item) => ({
        path: `${cached!.folder}/${item.name}`,
        name: item.name,
        bytes: item.size,
      }));
      const cachedCoverage = auditSnapCoverage(cachedFiles, catalog);
      if (cachedCoverage.matched / catalog.length < 0.7) {
        onProgress?.(
          `The saved ${system} folder covers only ${cachedCoverage.matched.toLocaleString()} of ${catalog.length.toLocaleString()} games; checking adjacent quality tiers…`,
        );
        const scan = await findSnapFolders(session.client, system, undefined, onProgress);
        folders = rankFolders([
          ...folders,
          ...scan.folders.filter((candidate) => candidate.path !== cached!.folder),
        ]);
      }
    }
    if (!folders.length) {
      onProgress?.(`Finding ${system} video snaps in console and media folders…`);
      const scan = await findSnapFolders(session.client, system, undefined, onProgress);
      folders = rankFolders(scan.folders);
      if (!folders.length)
        throw new Error(
          scan.truncated
            ? `No readable ${system} video folder was found within the targeted provider paths. EmuMovies may have renamed or moved this console; retrying the same broad scan is not required.`
            : `No ${system} video snap folder is visible to this account.`,
        );
    }
    onProgress?.(`Comparing ${system} video sets with the catalog…`);
    // basic-ftp has one command queue per control connection. The directed
    // resolver can legitimately return HD/HQ/SQ together, so list those few
    // folders serially instead of racing commands on a single session.
    const choices: { candidate: SnapFolder; files: SnapFile[]; coverage?: SnapCoverage }[] = [];
    for (const candidate of folders) {
      const entries = cachedEntries && candidate.path === cached?.folder
        ? cachedEntries
        : await session!.client.list(candidate.path);
      const files = videoFiles(entries).map((item) => ({
        path: `${candidate.path}/${item.name}`,
        name: item.name,
        bytes: item.size,
        quality: candidate.quality,
      }));
      const coverage = catalog.length ? auditSnapCoverage(files, catalog) : undefined;
      choices.push({ candidate, files, coverage });
    }
    choices.sort((a, b) => rankFolders([a.candidate, b.candidate]).indexOf(a.candidate) -
      rankFolders([a.candidate, b.candidate]).indexOf(b.candidate));
    const selected = choices[0].candidate;
    const folder = selected.path;
    // Keep every discovered tier. Resolution applies HD → HQ → SQ per title,
    // so a sparse HD set can coexist with HQ/SQ files that fill its gaps.
    const files = choices.flatMap((choice) => choice.files);
    if (!files.length)
      throw new Error(`No video files were listed under ${folder}.`);
    const manifest: SnapManifest = {
      system,
      folder,
      quality: choices.map((choice) => choice.candidate.quality)
        .filter((quality, index, all) => all.indexOf(quality) === index).join(" / "),
      indexedAt: Date.now(),
      files,
      coverage: catalog.length ? auditSnapCoverage(files, catalog) : undefined,
      folders: choices.map((choice) => choice.candidate),
    };
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, `${system}.json`),
      JSON.stringify(manifest),
      "utf8",
    );
    return manifest;
  } finally {
    session?.client.close();
  }
}

export async function readSnapManifest(dir: string, system = "PS1") {
  try {
    const manifest = JSON.parse(
      await fsp.readFile(path.join(dir, `${system}.json`), "utf8"),
    ) as SnapManifest;
    return manifest.files?.length ? manifest : null;
  } catch {
    return null;
  }
}

export async function removeSnapManifest(dir: string, system = "PS1") {
  await fsp.rm(path.join(dir, `${system}.json`), { force: true });
}

/**
 * Title comparison for Redump-named files.
 *
 * Redump writes the title as the publisher printed it, and the catalog writes
 * it as a person would type it, so the two disagree in exactly three ways that
 * matter: the volume number may be roman or arabic (`Suikoden II` against
 * `Suikoden 2`), initialisms may be dotted (`Future Cop: L.A.P.D.` against
 * `Future Cop - L.A.P.D.`), and leading articles may be moved to the end
 * (`The Legend of Dragoon` against `Legend of Dragoon, The`). Each is folded
 * away before comparison rather than absorbed by lowering the match floor,
 * which is what previously let a different game in the same series score above
 * the right one.
 */
const ROMAN: [RegExp, string][] = [
  [/\bviii\b/g, "8"],
  [/\bvii\b/g, "7"],
  [/\bxiii\b/g, "13"],
  [/\bxii\b/g, "12"],
  [/\bxi\b/g, "11"],
  [/\biii\b/g, "3"],
  [/\bix\b/g, "9"],
  [/\biv\b/g, "4"],
  [/\bvi\b/g, "6"],
  [/\bii\b/g, "2"],
  [/\bx\b/g, "10"],
  [/\bv\b/g, "5"],
];

export const snapKey = (value: string) => {
  let text = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.(mp4|webm|avi)$/i, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/(?:\b[a-z]\.){2,}/g, (run) => run.replace(/\./g, ""))
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  /**
   * Articles are removed from both ends rather than moved between them. The
   * comma that marks a Redump-style inversion (`Legend of Dragoon, The`) is
   * already gone by this point, so the two spellings only converge if a leading
   * and a trailing article are treated the same way.
   */
  text = text.replace(/^(the|a|an)\s+/, "").replace(/\s+(the|a|an)$/, "");
  for (const [pattern, digit] of ROMAN) text = text.replace(pattern, digit);
  return text.replace(/\s+/g, " ").trim();
};

export type SnapMatch = SnapFile & { exact: boolean; disc: number; confidence: number };

const discNumber = (name: string) =>
  Number(name.match(/\(dis[ck]\s*(\d+)\)/i)?.[1] ?? 0);

const grams = (value: string) => {
  const compact = ` ${snapKey(value).replace(/\s+/g, " ")} `;
  const result = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1)
    result.add(compact.slice(index, index + 2));
  return result;
};
const titleNumbers = (value: string) =>
  [...new Set((snapKey(value).match(/\b\d+\b/g) ?? []).map(Number))].sort();
const preparedSnaps = new WeakMap<SnapFile, { key: string; grams: Set<string>; numbers: string }>();
const prepareSnap = (file: SnapFile) => {
  let prepared = preparedSnaps.get(file);
  if (!prepared) {
    prepared = {
      key: snapKey(file.name),
      grams: grams(file.name),
      numbers: JSON.stringify(titleNumbers(file.name)),
    };
    preparedSnaps.set(file, prepared);
  }
  return prepared;
};
const preparedSimilarity = (left: Set<string>, right: Set<string>) => {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
};

export type SnapResolution = {
  match: SnapMatch | null;
  ambiguous: boolean;
  confidence: number;
};

/** Resolve Redump/provider naming without letting nearby sequels cross-match. */
export function resolveSnap(
  files: SnapFile[],
  title: string,
  region: string,
  coverName?: string,
): SnapResolution {
  const keys = [coverName, title].filter(Boolean) as string[];
  if (!keys.length) return { match: null, ambiguous: false, confidence: 0 };
  const preparedKeys = keys.map((key) => ({
    key: snapKey(key),
    grams: grams(key),
    numbers: JSON.stringify(titleNumbers(key)),
  }));
  const ranked = files.map((file) => {
    const prepared = prepareSnap(file);
    const exact = preparedKeys.some((key) => key.key === prepared.key);
    const compatible = preparedKeys.some((key) => key.numbers === prepared.numbers);
    const confidence = exact ? 1 : compatible
      ? Math.max(...preparedKeys.map((key) => preparedSimilarity(key.grams, prepared.grams)))
      : 0;
    const requestedRegion = new RegExp(`\\(${region}[^)]*\\)`, "i").test(file.name);
    const english = /\((usa|world|europe)[^)]*\)/i.test(file.name);
    return { ...file, exact, confidence, disc: discNumber(file.name), requestedRegion, english };
  }).filter((file) => file.confidence >= 0.78)
    .sort((a, b) => b.confidence - a.confidence ||
      Number(b.requestedRegion) - Number(a.requestedRegion) ||
      Number(b.english) - Number(a.english) || a.disc - b.disc ||
      a.name.localeCompare(b.name));
  if (!ranked.length) return { match: null, ambiguous: false, confidence: 0 };
  const best = ranked[0];
  const runnerUp = ranked.find((candidate) => snapKey(candidate.name) !== snapKey(best.name));
  const ambiguous = !best.exact && !!runnerUp && best.confidence - runnerUp.confidence < 0.06;
  if (ambiguous) return { match: null, ambiguous: true, confidence: best.confidence };
  const { requestedRegion: _requested, english: _english, ...match } = best;
  return { match, ambiguous: false, confidence: best.confidence };
}

export function auditSnapCoverage(files: SnapFile[], catalog: SnapCatalogGame[]): SnapCoverage {
  let matched = 0;
  let ambiguous = 0;
  for (const game of catalog) {
    const result = resolveSnapByQuality(files, game.title, game.region, game.coverName);
    if (result.match) matched += 1;
    else if (result.ambiguous) ambiguous += 1;
  }
  return { catalog: catalog.length, matched, ambiguous, unmatched: catalog.length - matched - ambiguous };
}

/**
 * The snap for one catalog game.
 *
 * A snap set holds one file per *release*, so a game with regional printings
 * and multiple discs has several. The preview only ever shows one, and it must
 * be the release the catalog entry is about — the same rule the download picker
 * follows — so region decides between candidates and the first disc breaks the
 * remaining tie.
 */
export function matchSnap(
  files: SnapFile[],
  title: string,
  region: string,
  coverName?: string,
): SnapMatch | null {
  return resolveSnapByQuality(files, title, region, coverName).match;
}

/** Fill each game's preview from the best tier that safely matches it. */
export function resolveSnapByQuality(
  files: SnapFile[],
  title: string,
  region: string,
  coverName?: string,
): SnapResolution {
  let ambiguous = false;
  let confidence = 0;
  const tiers = ["HD1080", "HQ480", "SQ240", "Unknown"];
  for (const tier of tiers) {
    const pool = files.filter((file) => (file.quality ?? "Unknown") === tier);
    if (!pool.length) continue;
    const result = resolveSnap(pool, title, region, coverName);
    if (result.match) return result;
    ambiguous ||= result.ambiguous;
    confidence = Math.max(confidence, result.confidence);
  }
  return { match: null, ambiguous, confidence };
}

/**
 * Fetches one snap into the media cache. Snaps are small enough to hold
 * outright, which is the whole point of preferring them: the preview becomes a
 * local file that loops instantly instead of a range-request stream against a
 * remote node that is sometimes unhealthy.
 */
export async function fetchSnap(
  cacheDir: string,
  credentials: EmuMoviesCredentials,
  remote: string,
): Promise<{ localUrl: string; bytes: number }> {
  const name = `${crypto.createHash("sha1").update(remote).digest("hex")}${path.extname(remote) || ".mp4"}`;
  const file = path.join(cacheDir, name);
  try {
    const stat = await fsp.stat(file);
    if (stat.size > 0)
      return { localUrl: mediaAssetUrl(file), bytes: stat.size };
  } catch {
    /* download below */
  }
  await fsp.mkdir(cacheDir, { recursive: true });
  const temp = `${file}.part`;
  let session: { client: Client; secure: boolean } | null = null;
  try {
    session = await openSession(credentials);
    await session.client.downloadTo(temp, remote);
    await fsp.rename(temp, file);
    const stat = await fsp.stat(file);
    return { localUrl: mediaAssetUrl(file), bytes: stat.size };
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  } finally {
    session?.client.close();
  }
}

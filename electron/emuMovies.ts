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

export type SnapFile = { path: string; name: string; bytes: number };
export type SnapManifest = {
  system: string;
  folder: string;
  quality: string;
  indexedAt: number;
  files: SnapFile[];
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
/**
 * `PlayStation` alone also names every later Sony console, and those carry
 * their own complete snap sets — indexing PS3 against a PS1 catalog would
 * produce confident matches for the wrong game entirely.
 */
const LATER_SONY = /\b(2|3|4|5|portable|psp|vita)\b/i;

const SYSTEM_ALIASES: Record<string, RegExp> = {
  PS1: /sony|playstation|psx/i,
};

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
export const findSnapFolders = async (
  client: Pick<Client, "list">,
  system: string,
): Promise<SnapFolder[]> => {
  const alias = SYSTEM_ALIASES[system] ?? new RegExp(system, "i");
  const useful = /official|video|snap|media|download/i;
  const queue = [{ path: "/", depth: 0 }];
  const visited = new Set<string>();
  const found: SnapFolder[] = [];
  while (queue.length && visited.size < MAX_LISTINGS) {
    const current = queue.shift()!;
    if (visited.has(current.path) || current.depth > SYSTEM_DEPTH) continue;
    visited.add(current.path);
    let entries: FileInfo[];
    try {
      entries = await client.list(current.path);
    } catch {
      continue;
    }
    const pathHasSystem = alias.test(current.path) && !LATER_SONY.test(current.path);
    const pathHasSnaps = SNAP_FOLDER.test(current.path);
    if (pathHasSystem && pathHasSnaps && videoFiles(entries).length)
      found.push({ path: current.path, quality: qualityOf(current.path) });

    for (const name of directories(entries)) {
      const child = joinRemote(current.path, name);
      const childHasSystem = alias.test(name) && !LATER_SONY.test(name);
      const childHasSnaps = SNAP_FOLDER.test(name);
      const relevant =
        current.depth === 0 ||
        pathHasSystem ||
        pathHasSnaps ||
        childHasSystem ||
        childHasSnaps ||
        useful.test(name) ||
        qualityOf(name) !== "Unknown";
      if (relevant) queue.push({ path: child, depth: current.depth + 1 });
    }
  }
  return found.filter(
    (folder, index) => found.findIndex((item) => item.path === folder.path) === index,
  );
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
): Promise<AccountProbe> {
  let session: { client: Client; secure: boolean } | null = null;
  try {
    session = await openSession(credentials);
    const systems = directories(await session.client.list("/"));
    const folders = rankFolders(await findSnapFolders(session.client, "PS1"));
    const qualities = [...new Set(folders.map((folder) => folder.quality))];
    return {
      ok: true,
      secure: session.secure,
      systems,
      snapFolder: folders[0]?.path,
      qualities,
      message: folders.length
        ? qualities.length
          ? `Signed in. PlayStation video snaps available in ${qualities.join(", ")}.`
          : "Signed in, but the PlayStation snap folder exposed no recognised quality tier."
        : `Signed in, but no PlayStation video snap folder was visible to this account across ${systems.length} systems.`,
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
): Promise<SnapManifest> {
  let session: { client: Client; secure: boolean } | null = null;
  try {
    session = await openSession(credentials);
    const folders = rankFolders(await findSnapFolders(session.client, system));
    if (!folders.length)
      throw new Error(
        "No video snap folder for this system is visible to this account.",
      );
    const selected = folders[0];
    const folder = selected.path;
    const entries = await session.client.list(folder);
    const files = videoFiles(entries)
      .map((item) => ({
        path: `${folder}/${item.name}`,
        name: item.name,
        bytes: item.size,
      }));
    if (!files.length)
      throw new Error(`No video files were listed under ${folder}.`);
    const manifest: SnapManifest = {
      system,
      folder,
      quality: selected.quality,
      indexedAt: Date.now(),
      files,
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

export type SnapMatch = SnapFile & { exact: boolean; disc: number };

const discNumber = (name: string) =>
  Number(name.match(/\(dis[ck]\s*(\d+)\)/i)?.[1] ?? 0);

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
): SnapMatch | null {
  const key = snapKey(title);
  if (!key) return null;
  const candidates = files
    .map((file) => ({
      ...file,
      exact: snapKey(file.name) === key,
      disc: discNumber(file.name),
    }))
    .filter((file) => file.exact);
  if (!candidates.length) return null;
  const regional = candidates.filter((file) =>
    new RegExp(`\\(${region}[^)]*\\)`, "i").test(file.name),
  );
  const english = candidates.filter((file) =>
    /\((usa|world|europe)[^)]*\)/i.test(file.name),
  );
  const pool = regional.length ? regional : english.length ? english : candidates;
  return [...pool].sort((a, b) => a.disc - b.disc || a.name.localeCompare(b.name))[0];
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

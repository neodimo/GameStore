import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import fsp from "node:fs/promises";

type Node = Buffer | number | Node[] | { [key: string]: Node };
export type CollectionFile = { path: string; bytes: number; index: number };

function decode(input: Buffer, at = 0): { value: Node; end: number } {
  const byte = input[at];
  if (byte === 0x69) {
    const end = input.indexOf(0x65, at + 1);
    return { value: Number(input.subarray(at + 1, end).toString()), end: end + 1 };
  }
  if (byte === 0x6c) {
    const value: Node[] = [];
    let cursor = at + 1;
    while (input[cursor] !== 0x65) { const item = decode(input, cursor); value.push(item.value); cursor = item.end; }
    return { value, end: cursor + 1 };
  }
  if (byte === 0x64) {
    const value: { [key: string]: Node } = {};
    let cursor = at + 1;
    while (input[cursor] !== 0x65) {
      const key = decode(input, cursor); cursor = key.end;
      const item = decode(input, cursor); cursor = item.end;
      value[(key.value as Buffer).toString("utf8")] = item.value;
    }
    return { value, end: cursor + 1 };
  }
  const colon = input.indexOf(0x3a, at);
  const size = Number(input.subarray(at, colon).toString());
  const start = colon + 1;
  return { value: input.subarray(start, start + size), end: start + size };
}

const text = (node: Node | undefined) => Buffer.isBuffer(node) ? node.toString("utf8") : "";
export function torrentFiles(buffer: Buffer): CollectionFile[] {
  const root = decode(buffer).value as { [key: string]: Node };
  const info = root.info as { [key: string]: Node };
  if (!info) throw new Error("Torrent metadata has no info dictionary.");
  const files = info.files as Node[] | undefined;
  if (!files) return [{ path: text(info.name), bytes: Number(info.length || 0), index: 0 }];
  return files.map((node, index) => {
    const file = node as { [key: string]: Node };
    return { path: (file.path as Node[]).map(text).join("/"), bytes: Number(file.length || 0), index };
  });
}

const normalize = (value: string) => value
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\.(zip|7z|rar|chd|cue|bin|iso|pbp)$/i, "")
  .replace(/\([^)]*(disc|disk)\s*\d+[^)]*\)/gi, "")
  .replace(/[^a-z0-9]+/g, " ").trim();
const score = (query: string, candidate: string, region: string) => {
  const q = new Set(normalize(query).split(" "));
  const c = new Set(normalize(path.basename(candidate)).split(" "));
  const overlap = [...q].filter((word) => c.has(word)).length;
  const union = new Set([...q, ...c]).size || 1;
  const title = overlap / union;
  const exact = normalize(candidate).includes(normalize(query)) ? 0.45 : 0;
  const regionBonus = new RegExp(`\\(${region === "USA" ? "USA" : region}[^)]*\\)`, "i").test(candidate) ? 0.2 : 0;
  return title + exact + regionBonus;
};

/**
 * The release a filename announces, in the terms a person picking a download
 * cares about: which region, and whether it is a fan translation.
 *
 * Add to Cart is meant to be one decision, so the list behind it has to be the
 * few releases actually worth choosing between \u2014 the catalog region, an English
 * translation of an import, or a World release. Every other printing of the
 * same game is noise at that moment.
 */
export type ReleaseVariant = {
  region: "USA" | "Europe" | "Japan" | "World" | "Unknown";
  translated: boolean;
  english: boolean;
  /** Prerelease, promotional and modified dumps need an explicit direct link. */
  retail: boolean;
  label: string;
};
const REGION_WORDS: [RegExp, ReleaseVariant["region"]][] = [
  [/\b(usa|us|ntsc-u)\b/i, "USA"],
  [/\b(europe|eur|pal|uk)\b/i, "Europe"],
  [/\b(japan|jpn|jp|ntsc-j)\b/i, "Japan"],
  [/\bworld\b/i, "World"],
];
const TRANSLATION = /\b(t-en|t\+en|english (?:translation|patch(?:ed)?)|eng(?:lish)? translated|translation)\b/i;
// These are release-status tags, rather than title words: keeping the marker
// inside parentheses/brackets avoids treating a legitimate title such as
// Pandemonium! as a demo. A collection search is the automatic path, so it
// must only ever yield a conventional retail release. Deliberate oddities can
// still be sent through the explicit direct-link control in the UI.
const NON_RETAIL_TAG = /[\[(]\s*(?:beta|demo(?:\s*(?:disc|cd|version))?|proto(?:type)?|preview|sample|kiosk|trial|promotional|promo|not\s+for\s+resale|aftermarket|hack|homebrew)\b/i;

export function releaseVariant(filePath: string): ReleaseVariant {
  const name = path.basename(filePath);
  const tags = [...name.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]).join(" ");
  const region = REGION_WORDS.find(([pattern]) => pattern.test(tags))?.[1] ?? "Unknown";
  const translated = TRANSLATION.test(name);
  const english = translated || region === "USA" || region === "Europe" || region === "World";
  const retail = !NON_RETAIL_TAG.test(name);
  const label = translated
    ? `${region === "Unknown" ? "Import" : region} (English translation)`
    : region === "Unknown"
      ? "Unlabelled release"
      : region;
  return { region, translated, english, retail, label };
}

export type CollectionMatch = CollectionFile & {
  score: number;
  variant: ReleaseVariant;
};

/**
 * Candidate downloads for one catalog game, narrowed to its primary releases.
 *
 * Ranking alone was not enough: a well-stocked collection carries a dozen
 * printings of a popular game, so the picker showed twelve near-identical rows
 * and made the user adjudicate No-Intro tags. Only releases matching the
 * catalog's own region survive, plus World releases and English translations of
 * imports, which are the other two ways a listed game is actually playable.
 * When a game exists in no such form the region filter is dropped rather than
 * returning nothing, and the rows stay labelled so the compromise is visible.
 */
export function matchCollectionFiles(
  files: CollectionFile[],
  title: string,
  region: string,
): CollectionMatch[] {
  const scored = files
    .map((file) => ({
      ...file,
      score: score(title, file.path, region),
      variant: releaseVariant(file.path),
    }))
    // Never let the region-fallback below turn a beta or demo into the
    // one-click default. The user's intentional alternative is a direct link.
    .filter((file) => file.score >= 0.62 && file.variant.retail)
    .sort((a, b) => b.score - a.score || a.bytes - b.bytes);
  const primary = scored.filter(
    (file) =>
      file.variant.region === region ||
      file.variant.region === "World" ||
      file.variant.translated,
  );
  return (primary.length ? primary : scored).slice(0, 8);
}

/**
 * A collection's file manifest, parsed once and kept.
 *
 * Every "Find release" click used to re-download the whole `.torrent` — up to
 * 64 MB — and re-decode its bencode before it could rank a single filename,
 * which is what made searching feel like indexing. The manifest is textual and
 * small next to the torrent it came from, so it is written beside the settings
 * that configured it and read back directly.
 */
export type CollectionManifest = {
  url: string;
  name: string;
  platform: string;
  indexedAt: number;
  files: CollectionFile[];
};
export type CollectionSource = { name: string; url: string; platform: string };

const manifestName = (url: string) =>
  `${crypto.createHash("sha1").update(url).digest("hex")}.json`;

export async function readCollectionManifest(dir: string, url: string) {
  try {
    const raw = await fsp.readFile(path.join(dir, manifestName(url)), "utf8");
    const manifest = JSON.parse(raw) as CollectionManifest;
    return manifest.files?.length ? manifest : null;
  } catch {
    return null;
  }
}

/** Downloads, parses and stores one collection's manifest. */
export async function indexCollection(dir: string, source: CollectionSource) {
  const files = torrentFiles(await fetchTorrent(source.url));
  const manifest: CollectionManifest = {
    url: source.url,
    name: source.name,
    platform: source.platform,
    indexedAt: Date.now(),
    files,
  };
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, manifestName(source.url)), JSON.stringify(manifest), "utf8");
  return manifest;
}

/**
 * The manifest for a configured source, indexing it only if it was never
 * indexed. A source saved in Settings is indexed there; this is the recovery
 * path for a manifest that was cleared, not the normal one.
 */
export async function ensureCollectionManifest(dir: string, source: CollectionSource) {
  return (await readCollectionManifest(dir, source.url)) ?? indexCollection(dir, source);
}

export async function removeCollectionManifest(dir: string, url: string) {
  await fsp.rm(path.join(dir, manifestName(url)), { force: true });
}

export async function fetchTorrent(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Collection sources must use HTTPS.");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || (net.isIP(host) && /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)))
    throw new Error("Collection sources cannot target localhost or private-network services.");
  const response = await fetch(parsed, { headers: { "User-Agent": "GameStore collection index" } });
  if (!response.ok) throw new Error(`Collection source returned ${response.status}`);
  const size = Number(response.headers.get("content-length") || 0);
  if (size > 64 * 1024 ** 2) throw new Error("Torrent metadata exceeds the 64 MB safety limit.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 64 * 1024 ** 2) throw new Error("Torrent metadata exceeds the 64 MB safety limit.");
  return buffer;
}

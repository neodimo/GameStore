import path from "node:path";
import net from "node:net";

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
export function matchCollectionFiles(files: CollectionFile[], title: string, region: string) {
  return files.map((file) => ({ ...file, score: score(title, file.path, region) }))
    .filter((file) => file.score >= 0.62)
    .sort((a, b) => b.score - a.score || a.bytes - b.bytes)
    .slice(0, 12);
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

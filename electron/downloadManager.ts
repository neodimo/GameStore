import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type DebridProvider = "realdebrid" | "torbox";

const libraryRoot = () => path.join(app.getPath("documents"), "GameStore", "Games");
const cleanName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim();
const allowedGameExtensions = new Set([".chd", ".cue", ".bin", ".iso", ".pbp", ".zip", ".7z", ".rar", ".ccd", ".img", ".sub", ".m3u"]);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const apiError = async (response: Response) => {
  const body = await response.text();
  throw new Error(`${response.status} ${body.slice(0, 240)}`);
};

export async function testDebrid(provider: DebridProvider, token: string) {
  const url =
    provider === "realdebrid"
      ? "https://api.real-debrid.com/rest/1.0/user"
      : "https://api.torbox.app/v1/api/user/me";
  const response = await fetch(url, { headers: auth(token) });
  if (!response.ok) await apiError(response);
  const data = (await response.json()) as any;
  return { ok: true, account: data.username || data.email || data.data?.email || "connected" };
}

type ResolvedFile = { url: string; filename: string; bytes: number };
const realDebridUnrestrict = async (token: string, link: string): Promise<ResolvedFile> => {
  const body = new URLSearchParams({ link });
  const response = await fetch("https://api.real-debrid.com/rest/1.0/unrestrict/link", {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) await apiError(response);
  const data = (await response.json()) as any;
  return { url: data.download as string, filename: data.filename as string, bytes: Number(data.filesize || 0) };
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveLink(provider: DebridProvider, token: string, link: string): Promise<ResolvedFile[]> {
  if (provider === "realdebrid") {
    if (!link.startsWith("magnet:")) return [await realDebridUnrestrict(token, link)];
    const added = await fetch("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ magnet: link }),
    });
    if (!added.ok) await apiError(added);
    const id = String(((await added.json()) as any).id);
    const selected = await fetch(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${id}`, {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ files: "all" }),
    });
    if (!selected.ok && selected.status !== 204) await apiError(selected);
    for (let attempt = 0; attempt < 120; attempt++) {
      const response = await fetch(`https://api.real-debrid.com/rest/1.0/torrents/info/${id}`, { headers: auth(token) });
      if (!response.ok) await apiError(response);
      const info = (await response.json()) as any;
      if (info.status === "downloaded" && info.links?.length)
        return Promise.all((info.links as string[]).map((item) => realDebridUnrestrict(token, item)));
      if (["error", "magnet_error", "virus", "dead"].includes(info.status))
        throw new Error(`Real-Debrid torrent failed with status: ${info.status}`);
      await delay(1500);
    }
    throw new Error("Real-Debrid is still fetching this torrent. It remains in your account; retry after it finishes.");
  }
  const body = new FormData();
  body.set("link", link);
  const response = await fetch("https://api.torbox.app/v1/api/webdl/createwebdownload", {
    method: "POST",
    headers: auth(token),
    body,
  });
  if (!response.ok) await apiError(response);
  const payload = (await response.json()) as any;
  const direct = payload.data?.download_url || payload.data?.url;
  if (!direct)
    throw new Error("TorBox accepted the link but has not produced a direct file yet. Open TorBox to finish selecting the file, then retry its direct link here.");
  return [{ url: direct as string, filename: payload.data?.name || "download.bin", bytes: 0 }];
}

export async function resolveRealDebridTorrentSelection(token: string, torrent: Buffer, wantedPaths: string[]) {
  const body = new FormData();
  body.set("file", new Blob([torrent]), "collection.torrent");
  const added = await fetch("https://api.real-debrid.com/rest/1.0/torrents/addTorrent", { method: "PUT", headers: auth(token), body });
  if (!added.ok) await apiError(added);
  const id = String(((await added.json()) as any).id);
  let info: any;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`https://api.real-debrid.com/rest/1.0/torrents/info/${id}`, { headers: auth(token) });
    if (!response.ok) await apiError(response);
    info = await response.json();
    if (info.files?.length) break;
    await delay(500);
  }
  const wanted = new Set(wantedPaths.map((item) => item.replace(/^\//, "")));
  const ids = (info?.files ?? []).filter((file: any) => wanted.has(String(file.path).replace(/^\//, ""))).map((file: any) => file.id);
  if (!ids.length) throw new Error("The selected release could not be mapped to Real-Debrid's torrent file list.");
  const selected = await fetch(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${id}`, {
    method: "POST", headers: { ...auth(token), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ files: ids.join(",") }),
  });
  if (!selected.ok && selected.status !== 204) await apiError(selected);
  for (let attempt = 0; attempt < 240; attempt++) {
    const response = await fetch(`https://api.real-debrid.com/rest/1.0/torrents/info/${id}`, { headers: auth(token) });
    if (!response.ok) await apiError(response);
    info = await response.json();
    if (info.status === "downloaded" && info.links?.length)
      return Promise.all((info.links as string[]).map((item) => realDebridUnrestrict(token, item)));
    if (["error", "magnet_error", "virus", "dead"].includes(info.status)) throw new Error(`Real-Debrid torrent failed: ${info.status}`);
    await delay(1500);
  }
  throw new Error("Real-Debrid is still preparing the selected file. It remains in your account; retry shortly.");
}

export async function downloadResolvedLink(args: {
  provider: DebridProvider;
  token: string;
  link: string;
  gameTitle: string;
  window: BrowserWindow | null;
}) {
  if (!/^https?:\/\//i.test(args.link) && !args.link.startsWith("magnet:"))
    throw new Error("Paste a supported HTTP(S) link or magnet URI.");
  if (args.link.startsWith("magnet:") && args.provider === "torbox")
    throw new Error("TorBox magnet file selection is not enabled in this build yet. Use Real-Debrid for magnets or paste a TorBox-resolved host link.");
  const resolvedFiles = (await resolveLink(args.provider, args.token, args.link)).filter((file) =>
    allowedGameExtensions.has(path.extname(file.filename).toLowerCase()),
  );
  if (!resolvedFiles.length)
    throw new Error("The provider result contained no supported game-image or archive files. Executables and unrelated files are refused.");
  const dir = path.join(libraryRoot(), cleanName(args.gameTitle));
  await fs.mkdir(dir, { recursive: true });
  let combinedBytes = 0;
  const targets: string[] = [];
  for (const resolved of resolvedFiles) {
    const response = await fetch(resolved.url, { headers: { "User-Agent": `GameStore/${app.getVersion()}` } });
    if (!response.ok || !response.body) await apiError(response);
    if (!response.body) throw new Error("Download returned an empty response body.");
    const responseBody = response.body;
    const filename = cleanName(resolved.filename || path.basename(new URL(resolved.url).pathname) || "game.bin");
    const target = path.join(dir, filename);
    const temp = `${target}.part`;
    const total = Number(response.headers.get("content-length") || resolved.bytes || 0);
    let bytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      args.window?.webContents.send("game-download-progress", { gameTitle: args.gameTitle, filename, bytes, total, percent: total ? Math.min(100, Math.round((bytes / total) * 100)) : 0 });
      controller.enqueue(chunk);
    }});
    await pipeline(Readable.fromWeb(responseBody.pipeThrough(counter) as any), await fs.open(temp, "w").then((handle) => handle.createWriteStream()));
    await fs.rename(temp, target);
    targets.push(target);
    combinedBytes += bytes;
  }
  return { path: targets[0], files: targets, filename: path.basename(targets[0]), bytes: combinedBytes, directory: dir };
}

export async function downloadCollectionFiles(args: { token: string; torrent: Buffer; wantedPaths: string[]; gameTitle: string; window: BrowserWindow | null }) {
  const resolvedFiles = await resolveRealDebridTorrentSelection(args.token, args.torrent, args.wantedPaths);
  const dir = path.join(libraryRoot(), cleanName(args.gameTitle));
  await fs.mkdir(dir, { recursive: true });
  const targets: string[] = [];
  let combinedBytes = 0;
  for (const resolved of resolvedFiles.filter((file) => allowedGameExtensions.has(path.extname(file.filename).toLowerCase()))) {
    const response = await fetch(resolved.url, { headers: { "User-Agent": `GameStore/${app.getVersion()}` } });
    if (!response.ok || !response.body) await apiError(response);
    if (!response.body) throw new Error("Download returned an empty response body.");
    const filename = cleanName(resolved.filename);
    const target = path.join(dir, filename); const temp = `${target}.part`;
    const total = Number(response.headers.get("content-length") || resolved.bytes || 0); let bytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { bytes += chunk.byteLength; args.window?.webContents.send("game-download-progress", { gameTitle: args.gameTitle, filename, bytes, total, percent: total ? Math.min(100, Math.round(bytes / total * 100)) : 0 }); controller.enqueue(chunk); } });
    const body = response.body;
    await pipeline(Readable.fromWeb(body.pipeThrough(counter) as any), await fs.open(temp, "w").then((handle) => handle.createWriteStream()));
    await fs.rename(temp, target); targets.push(target); combinedBytes += bytes;
  }
  if (!targets.length) throw new Error("The selected torrent files did not resolve to supported game-image/archive downloads.");
  return { path: targets[0], files: targets, filename: path.basename(targets[0]), bytes: combinedBytes, directory: dir };
}

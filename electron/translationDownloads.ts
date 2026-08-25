import { BrowserWindow, type DownloadItem } from "electron";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";

type BrowseRequest = {
  gameId: string;
  title: string;
  url: string;
  expectedFile?: string;
  container: string;
};

const cleanName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim();

const extractZip = (archive: string, destination: string) => new Promise<string[]>((resolve, reject) => {
  const files: string[] = [];
  yauzl.open(archive, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) return reject(error ?? new Error("Could not open the downloaded ZIP."));
    const fail = (reason: unknown) => { zip.close(); reject(reason); };
    zip.on("error", fail);
    zip.on("end", () => resolve(files));
    zip.on("entry", async (entry) => {
      try {
        const normalized = entry.fileName.replace(/\\/g, "/");
        const target = path.resolve(destination, normalized);
        if (!target.startsWith(`${path.resolve(destination)}${path.sep}`))
          throw new Error(`Unsafe ZIP path refused: ${entry.fileName}`);
        const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (fileType === 0o120000) throw new Error(`ZIP symlink refused: ${entry.fileName}`);
        if (/\/$/.test(normalized)) {
          await fs.mkdir(target, { recursive: true });
          zip.readEntry();
          return;
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, async (streamError, stream) => {
          if (streamError || !stream) return fail(streamError ?? new Error(`Could not extract ${entry.fileName}`));
          try {
            await pipeline(stream, createWriteStream(target, { flags: "wx" }));
            files.push(target);
            zip.readEntry();
          } catch (writeError) { fail(writeError); }
        });
      } catch (entryError) { fail(entryError); }
    });
    zip.readEntry();
  });
});

export const chooseDownloadedPatch = (files: string[], request: Pick<BrowseRequest, "expectedFile" | "container">) => {
  if (request.expectedFile) {
    const exact = files.find((file) => path.basename(file).toLowerCase() === request.expectedFile!.toLowerCase());
    if (exact) return exact;
  }
  const wanted = request.container === "xdelta" ? /\.(xdelta|vcdiff)$/i : new RegExp(`\\.${request.container}$`, "i");
  const candidates = files.filter((file) => wanted.test(file));
  if (candidates.length !== 1)
    throw new Error(`The download contains ${candidates.length} ${request.container} patch files; GameStore cannot choose safely.`);
  return candidates[0];
};

const finishDownload = async (item: DownloadItem, destination: string, request: BrowseRequest) => {
  await fs.mkdir(destination, { recursive: true });
  const downloaded = path.join(destination, cleanName(item.getFilename()));
  item.setSavePath(downloaded);
  return new Promise<string>((resolve, reject) => item.once("done", async (_event, state) => {
    if (state !== "completed") return reject(new Error(`Patch download ended with ${state}.`));
    try {
      if (!/\.zip$/i.test(downloaded)) return resolve(chooseDownloadedPatch([downloaded], request));
      const extracted = path.join(destination, path.basename(downloaded, path.extname(downloaded)));
      await fs.mkdir(extracted, { recursive: true });
      const files = await extractZip(downloaded, extracted);
      const chosen = chooseDownloadedPatch(files, request);
      await fs.rm(downloaded, { force: true });
      resolve(chosen);
    } catch (error) { reject(error); }
  }));
};

export const openTranslationBrowser = async (
  parent: BrowserWindow,
  libraryRoot: string,
  request: BrowseRequest,
) => {
  const parsed = new URL(request.url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP(S) patch pages can open inside GameStore.");
  const browser = new BrowserWindow({
    parent,
    width: 1180,
    height: 820,
    title: `${request.title} translation patch`,
    backgroundColor: "#0d0f12",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `translation-${randomUUID()}`,
    },
  });
  browser.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void browser.loadURL(url);
    return { action: "deny" };
  });
  const browserSession = browser.webContents.session;
  const onDownload = (_event: Electron.Event, item: DownloadItem) => {
    browserSession.removeListener("will-download", onDownload);
    const destination = path.join(libraryRoot, "Patches", cleanName(request.title), randomUUID());
    void finishDownload(item, destination, request)
      .then((patchPath) => {
        parent.webContents.send("translation-patch-ready", { gameId: request.gameId, path: patchPath });
        browser.close();
      })
      .catch((error) => {
        parent.webContents.send("translation-patch-error", {
          gameId: request.gameId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!browser.isDestroyed()) browserSession.on("will-download", onDownload);
      });
  };
  browserSession.on("will-download", onDownload);
  browser.once("closed", () => browserSession.removeListener("will-download", onDownload));
  await browser.loadURL(request.url);
};

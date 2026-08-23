import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

export type LibraryItem = {
  id: string;
  title: string;
  platform: string;
  directory: string;
  files: string[];
  queuedAt: string;
};

type LibraryIndex = { version: 1; cart: LibraryItem[] };
const emptyIndex = (): LibraryIndex => ({ version: 1, cart: [] });
const cleanName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim();
const discPlatforms = new Set(["PSX", "PS2", "SATURN", "DREAMCAST", "SEGACD", "PCECD"]);
const playableExtensions = new Set([
  ".chd", ".cue", ".bin", ".iso", ".pbp", ".ccd", ".img", ".sub", ".m3u",
  ".gba", ".gb", ".gbc", ".z64", ".n64", ".v64", ".nes", ".sfc", ".smc", ".md", ".gen",
]);

const walk = async (root: string, current = root): Promise<string[]> => {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
};

const extractZip = (archive: string, destination: string) => new Promise<void>((resolve, reject) => {
  yauzl.open(archive, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zip) => {
    if (openError || !zip) return reject(openError ?? new Error("Could not open ZIP archive."));
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", resolve);
    zip.on("entry", async (entry) => {
      try {
        const normalized = entry.fileName.replace(/\\/g, "/");
        const target = path.resolve(destination, normalized);
        if (target !== destination && !target.startsWith(`${path.resolve(destination)}${path.sep}`))
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
          try { await pipeline(stream, createWriteStream(target, { flags: "wx" })); zip.readEntry(); }
          catch (error) { fail(error); }
        });
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
});

const readIndex = async (root: string): Promise<LibraryIndex> => {
  try {
    const value = JSON.parse(await fs.readFile(path.join(root, "library.json"), "utf8"));
    return value?.version === 1 && Array.isArray(value.cart) ? value : emptyIndex();
  } catch {
    return emptyIndex();
  }
};

const writeIndex = async (root: string, index: LibraryIndex) => {
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, "library.json");
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(index, null, 2));
  await fs.rename(temp, target);
};

export const getCart = async (root: string) => (await readIndex(root)).cart;

export const removeFromCart = async (root: string, id: string) => {
  const index = await readIndex(root);
  index.cart = index.cart.filter((item) => item.id !== id);
  await writeIndex(root, index);
  return index.cart;
};

export const checkoutCart = async (
  root: string,
  transfer: (item: LibraryItem) => Promise<void>,
  onChange?: () => void,
) => {
  const cart = await getCart(root);
  const completed: LibraryItem[] = [];
  for (const item of cart) {
    await transfer(item);
    completed.push(item);
    await removeFromCart(root, item.id);
    onChange?.();
  }
  return completed;
};

export async function finalizeDownload(args: {
  root: string;
  title: string;
  platform: string;
  downloadedFiles: string[];
}) {
  const platform = cleanName(args.platform.toUpperCase());
  const archives = args.downloadedFiles.filter((file) => path.extname(file).toLowerCase() === ".zip");
  if (archives.length > 1 || (archives.length && args.downloadedFiles.length > 1))
    throw new Error("A release must resolve to one ZIP archive or a set of game files, not both.");

  let sourceRoot = path.dirname(args.downloadedFiles[0]);
  let sourceFiles = args.downloadedFiles;
  let staging: string | undefined;
  if (archives.length === 1) {
    staging = path.join(args.root, ".staging", randomUUID());
    await fs.mkdir(staging, { recursive: true });
    try {
      await extractZip(archives[0], staging);
      sourceRoot = staging;
      sourceFiles = await walk(staging);
      const topLevels = new Set(sourceFiles.map((file) => path.relative(staging!, file).split(path.sep)[0]));
      if (topLevels.size === 1) {
        const singleRoot = path.join(staging, [...topLevels][0]);
        if ((await fs.stat(singleRoot)).isDirectory()) sourceRoot = singleRoot;
      }
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  const playable = sourceFiles.filter((file) => playableExtensions.has(path.extname(file).toLowerCase()));
  if (!playable.length) {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    throw new Error("The downloaded release contains no supported playable game files. The original download was kept.");
  }
  const needsFolder = discPlatforms.has(platform) || playable.length > 1 || playable.some((file) => path.extname(file).toLowerCase() === ".cue");
  const destination = needsFolder
    ? path.join(args.root, "Games", platform, cleanName(args.title))
    : path.join(args.root, "Games", platform);
  await fs.mkdir(destination, { recursive: true });

  const moved: string[] = [];
  const filesToMove = needsFolder ? sourceFiles : playable;
  try {
    for (const source of filesToMove) {
      const relative = needsFolder ? path.relative(sourceRoot, source) : path.basename(source);
      const target = path.join(destination, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      moved.push(target);
    }
  } catch (error) {
    await Promise.all(moved.map((file) => fs.rm(file, { force: true })));
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }

  if (staging) {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(archives[0], { force: true });
  } else {
    await Promise.all(args.downloadedFiles.map((file) => fs.rm(file, { force: true })));
  }
  const queuedFiles = moved.filter((file) => playableExtensions.has(path.extname(file).toLowerCase()));
  const item: LibraryItem = {
    id: `${platform}:${cleanName(args.title).toLowerCase()}`,
    title: args.title,
    platform,
    directory: destination,
    files: queuedFiles,
    queuedAt: new Date().toISOString(),
  };
  const index = await readIndex(args.root);
  index.cart = [...index.cart.filter((existing) => existing.id !== item.id), item];
  await writeIndex(args.root, index);
  return item;
}

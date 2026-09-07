import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import { extractZip } from "./libraryManager";
import { archiveKind, type ArchiveKind, type ReleaseAsset } from "./portsPipeline";

/**
 * Fetching and unpacking a port's release archive.
 *
 * The formats here are the ones the scene actually publishes: across a sample
 * of the catalog's release pages, `.zip` accounts for the large majority,
 * `.AppImage` and `.tar.gz` cover nearly all of the rest, and a handful of
 * projects ship a bare executable. Nothing else is attempted — an archive that
 * downloads and then cannot be opened is a worse outcome than a refusal before
 * the download, so `archiveKind` gates this module and the planner alike.
 *
 * `tar.gz` is parsed here rather than pulled in as a dependency: `tar` exists
 * in the tree only as a transitive dependency of the packager, and taking a
 * runtime dependency on something nothing declares is how a build breaks
 * quietly later.
 */

/** Streams a release asset to disk, reporting bytes as they land. */
export async function downloadAsset(
  asset: ReleaseAsset,
  destination: string,
  onProgress?: (received: number, total: number) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const response = await fetchImpl(asset.downloadUrl, {
    headers: { "User-Agent": "GameStore", Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Downloading ${asset.name} failed with HTTP ${response.status}.`);
  }
  const total = Number(response.headers.get("content-length")) || asset.size;
  let received = 0;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onProgress?.(received, total);
  });
  await pipeline(source, createWriteStream(destination));
  return destination;
}

const TAR_BLOCK = 512;
const readString = (block: Buffer, offset: number, length: number) =>
  block.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/, "").trim();
const readOctal = (block: Buffer, offset: number, length: number) => {
  const raw = readString(block, offset, length);
  return raw ? parseInt(raw, 8) || 0 : 0;
};

/**
 * Unpacks a gzipped tar into `destination`.
 *
 * Refuses the same things the ZIP path refuses — links, and any member whose
 * resolved path escapes the destination — because a release archive is
 * attacker-influenced content from a third-party repo, and this runs with the
 * user's own privileges.
 */
export async function extractTarGz(archive: string, destination: string): Promise<void> {
  const tar = gunzipSync(await fs.readFile(archive));
  const root = path.resolve(destination);
  let offset = 0;
  let longName = "";

  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    offset += TAR_BLOCK;
    if (header.every((byte) => byte === 0)) break;

    const name = longName || readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156]) || "0";
    const dataBlocks = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    longName = "";

    if (typeFlag === "L") {
      longName = tar.subarray(offset, offset + size).toString("utf8").replace(/\0.*$/, "");
      offset += dataBlocks;
      continue;
    }
    // Pax/global headers carry metadata about the *next* entry, not content.
    if (typeFlag === "x" || typeFlag === "g") {
      offset += dataBlocks;
      continue;
    }
    if (typeFlag === "1" || typeFlag === "2") {
      throw new Error(`Archive link refused: ${name}`);
    }

    const full = prefix ? `${prefix}/${name}` : name;
    const target = path.resolve(root, full.replace(/\\/g, "/"));
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Unsafe archive path refused: ${full}`);
    }

    if (typeFlag === "5" || full.endsWith("/")) {
      await fs.mkdir(target, { recursive: true });
      offset += dataBlocks;
      continue;
    }
    if (typeFlag !== "0" && typeFlag !== "\0") {
      offset += dataBlocks;
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, tar.subarray(offset, offset + size));
    // Preserve the executable bit: a tarball is how Linux ports ship a binary
    // that has to be runnable the moment it reaches the target.
    if (readOctal(header, 100, 8) & 0o111) await fs.chmod(target, 0o755);
    offset += dataBlocks;
  }
}

/** Recursively lists files under a directory as absolute paths. */
export const walkFiles = async (root: string, current = root): Promise<string[]> => {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
};

export type StagedRelease = {
  kind: ArchiveKind;
  /** Root of the staged tree; every file below is uploaded relative to this. */
  root: string;
  files: string[];
};

/**
 * Turns a downloaded asset into a staged directory ready to upload.
 *
 * Single-file assets (an AppImage, or a bare `.exe`) are staged into a
 * directory of their own rather than handled as a special case downstream, so
 * the transfer and shortcut steps see one shape regardless of how the project
 * chose to package itself.
 */
export async function stageRelease(
  assetName: string,
  archivePath: string,
  stagingRoot: string,
): Promise<StagedRelease> {
  const kind = archiveKind(assetName);
  if (!kind) throw new Error(`GameStore cannot unpack ${assetName}.`);
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(stagingRoot, { recursive: true });

  if (kind === "zip") await extractZip(archivePath, stagingRoot);
  else if (kind === "tar.gz") await extractTarGz(archivePath, stagingRoot);
  else {
    const target = path.join(stagingRoot, assetName);
    await fs.copyFile(archivePath, target);
    await fs.chmod(target, 0o755);
  }

  const files = await walkFiles(stagingRoot);
  return { kind, root: unwrapSingleDirectory(files, stagingRoot), files };
}

/**
 * Collapses the redundant top folder archives are usually built with.
 *
 * Extracting `soh-1.1.0-windows.zip` typically yields a single `soh-1.1.0/`
 * directory holding everything. Uploading that as-is buries the executable one
 * level below the install directory, which then breaks the shortcut's working
 * directory and the port's own relative asset lookups. Treating that lone
 * directory as the real root is what makes the two layouts behave the same.
 */
export function unwrapSingleDirectory(files: string[], root: string): string {
  if (!files.length) return root;
  const firstSegments = new Set(
    files.map((file) => path.relative(root, file).split(path.sep)[0]),
  );
  if (firstSegments.size !== 1) return root;
  const only = [...firstSegments][0];
  // A lone *file* at the root is already flat; only a lone directory nests.
  const nested = files.some((file) => path.relative(root, file).split(path.sep).length > 1);
  return nested ? path.join(root, only) : root;
}

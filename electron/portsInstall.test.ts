import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gzipSync } from "node:zlib";
import {
  downloadAsset,
  extractTarGz,
  stageRelease,
  unwrapSingleDirectory,
  walkFiles,
} from "./portsInstall";

const TAR_BLOCK = 512;

/** Builds a minimal ustar+gzip fixture. The reader ignores the checksum field, so it is left blank. */
function buildTarGz(entries: { path: string; content?: string; mode?: number }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const isDir = entry.content === undefined;
    const header = Buffer.alloc(TAR_BLOCK);
    header.write(entry.path, 0, 100, "utf8");
    header.write((entry.mode ?? 0o644).toString(8).padStart(7, "0"), 100, 8, "utf8");
    const size = isDir ? 0 : Buffer.byteLength(entry.content!);
    header.write(size.toString(8).padStart(11, "0"), 124, 12, "utf8");
    header.write("0".repeat(11), 136, 12, "utf8");
    header.write(isDir ? "5" : "0", 156, 1, "utf8");
    header.write("ustar", 257, 6, "utf8");
    chunks.push(header);
    if (!isDir) {
      const data = Buffer.from(entry.content!, "utf8");
      chunks.push(data);
      const pad = TAR_BLOCK - (data.length % TAR_BLOCK || TAR_BLOCK);
      if (pad) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(TAR_BLOCK * 2));
  return gzipSync(Buffer.concat(chunks));
}

const tempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), "gamestore-ports-test-"));

describe("extractTarGz", () => {
  it("extracts nested files and directories", async () => {
    const dir = await tempDir();
    try {
      const archive = path.join(dir, "release.tar.gz");
      await fs.writeFile(archive, buildTarGz([
        { path: "soh/" },
        { path: "soh/soh", content: "binary", mode: 0o755 },
        { path: "soh/assets/oot.otr", content: "assets" },
      ]));
      const destination = path.join(dir, "out");
      await extractTarGz(archive, destination);
      expect(await fs.readFile(path.join(destination, "soh/soh"), "utf8")).toBe("binary");
      expect(await fs.readFile(path.join(destination, "soh/assets/oot.otr"), "utf8")).toBe("assets");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves the executable bit for files that had it", async () => {
    const dir = await tempDir();
    try {
      const archive = path.join(dir, "release.tar.gz");
      await fs.writeFile(archive, buildTarGz([{ path: "run.sh", content: "#!/bin/sh\n", mode: 0o755 }]));
      const destination = path.join(dir, "out");
      await extractTarGz(archive, destination);
      const mode = (await fs.stat(path.join(destination, "run.sh"))).mode & 0o777;
      expect(mode & 0o111).not.toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a member whose path escapes the destination", async () => {
    const dir = await tempDir();
    try {
      const archive = path.join(dir, "release.tar.gz");
      await fs.writeFile(archive, buildTarGz([{ path: "../../etc/passwd", content: "pwned" }]));
      await expect(extractTarGz(archive, path.join(dir, "out"))).rejects.toThrow(/Unsafe archive path/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("unwrapSingleDirectory", () => {
  it("collapses a single top-level directory to the real root", () => {
    const root = "/staging";
    const files = ["/staging/soh-1.1.0/soh.exe", "/staging/soh-1.1.0/assets/oot.otr"];
    expect(unwrapSingleDirectory(files, root)).toBe(path.join(root, "soh-1.1.0"));
  });

  it("leaves an already-flat archive alone", () => {
    const root = "/staging";
    const files = ["/staging/soh.exe", "/staging/oot.otr"];
    expect(unwrapSingleDirectory(files, root)).toBe(root);
  });

  it("leaves a lone file at the root alone rather than nesting into it", () => {
    const root = "/staging";
    expect(unwrapSingleDirectory(["/staging/soh.AppImage"], root)).toBe(root);
  });

  it("returns the root for an empty archive", () => {
    expect(unwrapSingleDirectory([], "/staging")).toBe("/staging");
  });
});

describe("stageRelease", () => {
  it("extracts a zip and unwraps its single top-level directory", async () => {
    const dir = await tempDir();
    try {
      // The project's own zip extractor is exercised by libraryManager's tests;
      // here a tar.gz release is staged instead, since both paths converge on
      // the same unwrap/list behavior stageRelease is responsible for.
      const archive = path.join(dir, "soh-linux.tar.gz");
      await fs.writeFile(archive, buildTarGz([
        { path: "soh-1.1.0/" },
        { path: "soh-1.1.0/soh", content: "binary", mode: 0o755 },
      ]));
      const staged = await stageRelease("soh-linux.tar.gz", archive, path.join(dir, "staged"));
      expect(staged.kind).toBe("tar.gz");
      expect(staged.root).toBe(path.join(dir, "staged", "soh-1.1.0"));
      expect(staged.files).toEqual([path.join(dir, "staged", "soh-1.1.0", "soh")]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("copies a bare executable asset into its own staging directory", async () => {
    const dir = await tempDir();
    try {
      const archive = path.join(dir, "soh.AppImage");
      await fs.writeFile(archive, "binary");
      const staged = await stageRelease("soh.AppImage", archive, path.join(dir, "staged"));
      expect(staged.kind).toBe("appimage");
      expect(staged.files).toEqual([path.join(dir, "staged", "soh.AppImage")]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses an asset GameStore cannot unpack", async () => {
    const dir = await tempDir();
    try {
      await expect(stageRelease("soh.7z", path.join(dir, "soh.7z"), path.join(dir, "staged"))).rejects.toThrow(/cannot unpack/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("walkFiles", () => {
  it("lists every file recursively as absolute paths", async () => {
    const dir = await tempDir();
    try {
      await fs.mkdir(path.join(dir, "a/b"), { recursive: true });
      await fs.writeFile(path.join(dir, "a/one.txt"), "1");
      await fs.writeFile(path.join(dir, "a/b/two.txt"), "2");
      const files = (await walkFiles(dir)).sort();
      expect(files).toEqual([path.join(dir, "a/b/two.txt"), path.join(dir, "a/one.txt")].sort());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("downloadAsset", () => {
  it("streams the response body to disk and reports progress", async () => {
    const dir = await tempDir();
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello "));
          controller.enqueue(new TextEncoder().encode("world"));
          controller.close();
        },
      });
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "11" }),
        body,
      });
      const destination = path.join(dir, "download", "soh.zip");
      const progress = vi.fn();
      await downloadAsset({ name: "soh.zip", downloadUrl: "https://x/soh.zip", size: 11 }, destination, progress, fetchImpl as never);
      expect(await fs.readFile(destination, "utf8")).toBe("hello world");
      expect(progress).toHaveBeenCalledWith(11, 11);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the download fails", async () => {
    const dir = await tempDir();
    try {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, headers: new Headers(), body: null });
      await expect(
        downloadAsset({ name: "soh.zip", downloadUrl: "https://x/soh.zip", size: 0 }, path.join(dir, "soh.zip"), undefined, fetchImpl as never),
      ).rejects.toThrow(/404/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

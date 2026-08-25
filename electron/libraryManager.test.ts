import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkoutCart, finalizeDownload, findCartDiscImage, getCart } from "./libraryManager";

const roots: string[] = [];
const root = async () => {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "gamestore-library-"));
  roots.push(value);
  return value;
};
afterEach(async () => Promise.all(roots.splice(0).map((item) => fs.rm(item, { recursive: true, force: true }))));

describe("managed library", () => {
  it("extracts a ZIP, preserves its filenames, and deletes the archive only after success", async () => {
    const dir = await root();
    const archive = path.join(dir, "Tekken 3.zip");
    await fs.writeFile(archive, Buffer.from("UEsDBAoAAAAAAIRrF12Z8MQgGwAAABsAAAAMABwAVGVra2VuIDMuY3VlVVQJAAPYV4tq2FeLanV4CwABBOgDAAAE6AMAAEZJTEUgIlRla2tlbiAzLmJpbiIgQklOQVJZClBLAwQKAAAAAACEaxddkyY+8AgAAAAIAAAADAAcAFRla2tlbiAzLmJpblVUCQAD2FeLathXi2p1eAsAAQToAwAABOgDAABkaXNjZGF0YVBLAQIeAwoAAAAAAIRrF12Z8MQgGwAAABsAAAAMABgAAAAAAAEAAACkgQAAAABUZWtrZW4gMy5jdWVVVAUAA9hXi2p1eAsAAQToAwAABOgDAABQSwECHgMKAAAAAACEaxddkyY+8AgAAAAIAAAADAAYAAAAAAABAAAApIFhAAAAVGVra2VuIDMuYmluVVQFAAPYV4tqdXgLAAEE6AMAAAToAwAAUEsFBgAAAAACAAIApAAAAK8AAAAAAA==", "base64"));
    const item = await finalizeDownload({ root: dir, title: "Tekken 3 (USA)", platform: "PSX", downloadedFiles: [archive] });
    expect(item.files.map((file) => path.basename(file)).sort()).toEqual(["Tekken 3.bin", "Tekken 3.cue"]);
    await expect(fs.access(archive)).rejects.toThrow();
  });

  it("keeps multi-file disc releases together with original filenames and queues them", async () => {
    const dir = await root();
    const incoming = path.join(dir, "incoming");
    await fs.mkdir(incoming);
    const files = ["Tekken 3 (USA).cue", "Tekken 3 (USA).bin"];
    await Promise.all(files.map((name) => fs.writeFile(path.join(incoming, name), name)));
    const item = await finalizeDownload({ root: dir, title: "Tekken 3 (USA)", platform: "PSX", downloadedFiles: files.map((name) => path.join(incoming, name)) });
    expect(item.files.map((file) => path.basename(file))).toEqual(files);
    expect(item.directory).toBe(path.join(dir, "Games", "PSX", "Tekken 3 (USA)"));
    expect(await getCart(dir)).toHaveLength(1);
    await expect(fs.access(path.join(incoming, files[0]))).rejects.toThrow();
    expect(await findCartDiscImage(dir, "Tekken 3 (USA)")).toBe(path.join(item.directory, "Tekken 3 (USA).bin"));
  });

  it("does not guess when a cart item contains more than one disc image", async () => {
    const dir = await root();
    const incoming = path.join(dir, "incoming");
    await fs.mkdir(incoming);
    const files = ["Disc 1.bin", "Disc 2.bin", "Set.cue"];
    await Promise.all(files.map((name) => fs.writeFile(path.join(incoming, name), name)));
    await finalizeDownload({ root: dir, title: "Two-disc game", platform: "PSX", downloadedFiles: files.map((name) => path.join(incoming, name)) });
    expect(await findCartDiscImage(dir, "Two-disc game")).toBeNull();
  });

  it("places a single cartridge image directly in its console folder", async () => {
    const dir = await root();
    const incoming = path.join(dir, "incoming");
    await fs.mkdir(incoming);
    const source = path.join(incoming, "Advance Wars (USA).gba");
    await fs.writeFile(source, "rom");
    const item = await finalizeDownload({ root: dir, title: "Advance Wars", platform: "GBA", downloadedFiles: [source] });
    expect(item.files).toEqual([path.join(dir, "Games", "GBA", "Advance Wars (USA).gba")]);
  });

  it("removes completed checkout items while retaining the failed item for retry", async () => {
    const dir = await root();
    const incoming = path.join(dir, "incoming");
    await fs.mkdir(incoming);
    for (const title of ["First", "Second"]) {
      const source = path.join(incoming, `${title}.chd`);
      await fs.writeFile(source, title);
      await finalizeDownload({ root: dir, title, platform: "PSX", downloadedFiles: [source] });
    }
    await expect(checkoutCart(dir, async (item) => {
      if (item.title === "Second") throw new Error("device disconnected");
    })).rejects.toThrow("device disconnected");
    expect((await getCart(dir)).map((item) => item.title)).toEqual(["Second"]);
  });
});

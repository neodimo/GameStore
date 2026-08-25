import { describe, expect, it } from "vitest";
import { chooseDownloadedPatch } from "./translationDownloads";

describe("translation download handoff", () => {
  it("finds the curated patch inside a downloaded archive", () => {
    expect(chooseDownloadedPatch(
      ["/patch/README.txt", "/patch/files/ProjectMizzurnaBeta.xdelta"],
      { expectedFile: "ProjectMizzurnaBeta.xdelta", container: "xdelta" },
    )).toBe("/patch/files/ProjectMizzurnaBeta.xdelta");
  });

  it("refuses to guess between multiple uncurated patch files", () => {
    expect(() => chooseDownloadedPatch(
      ["/patch/v1.ppf", "/patch/v2.ppf"],
      { container: "ppf" },
    )).toThrow(/cannot choose safely/i);
  });
});

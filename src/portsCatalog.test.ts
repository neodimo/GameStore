import { describe, it, expect } from "vitest";
import {
  portsCatalog,
  portsById,
  portsByPlatform,
  PORT_PLATFORMS,
  PORT_PLATFORM_LABELS,
  type PortEntry,
} from "./portsCatalog";

describe("portsCatalog", () => {
  it("lists every priority platform", () => {
    expect(PORT_PLATFORMS).toEqual([
      "N64",
      "PS1",
      "Dreamcast",
      "GameCube",
      "Wii",
      "Wii U",
      "Xbox",
      "Xbox 360",
      "Switch",
      "Saturn",
      "PS2",
    ]);
  });

  it("labels every priority platform", () => {
    for (const platform of PORT_PLATFORMS) {
      expect(PORT_PLATFORM_LABELS[platform]).toBeTruthy();
    }
  });

  it("only contains entries whose source platform is in the priority list", () => {
    const allowed = new Set<string>(PORT_PLATFORMS);
    for (const entry of portsCatalog) {
      expect(allowed.has(entry.sourcePlatform)).toBe(true);
    }
  });

  it("never ships an entry with a fabricated download URL", () => {
    // Distribution URLs are curated by DiMo from Minerva / Real-Debrid sources.
    // This file must NEVER bake one in, since ROM/asset data is not ours to ship.
    for (const entry of portsCatalog) {
      if (entry.downloadUrl) {
        expect(entry.downloadUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it("flags whether each entry needs original game assets", () => {
    const decomps = portsCatalog.filter((e) => e.needsOriginalAssets);
    const recomps = portsCatalog.filter((e) => !e.needsOriginalAssets);
    expect(decomps.length).toBeGreaterThan(0);
    expect(recomps.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = new Set<string>();
    for (const entry of portsCatalog) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
    }
  });

  it("has a projectUrl for every entry", () => {
    for (const entry of portsCatalog) {
      expect(entry.projectUrl).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it("indexes entries by id", () => {
    for (const entry of portsCatalog) {
      expect(portsById[entry.id]).toEqual(entry);
    }
  });

  it("groups entries by source platform in priority order", () => {
    const grouped = portsByPlatform;
    for (const platform of PORT_PLATFORMS) {
      expect(Array.isArray(grouped[platform])).toBe(true);
      for (const entry of grouped[platform]) {
        expect(entry.sourcePlatform).toBe(platform);
      }
    }
  });

  it("every entry satisfies the PortEntry shape", () => {
    const requiredKeys: Array<keyof PortEntry> = [
      "id",
      "title",
      "sourcePlatform",
      "year",
      "project",
      "description",
      "projectUrl",
      "needsOriginalAssets",
    ];
    for (const entry of portsCatalog) {
      for (const key of requiredKeys) {
        expect(entry[key]).toBeDefined();
      }
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.title).toBe("string");
      expect(typeof entry.year).toBe("number");
      expect(typeof entry.description).toBe("string");
    }
  });
});

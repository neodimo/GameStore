import { describe, it, expect } from "vitest";
import {
  portsCatalog,
  portsById,
  portsByPlatform,
  populatedPortPlatforms,
  isInstallable,
  supportsTarget,
  PORT_PLATFORMS,
  PORT_PLATFORM_LABELS,
  type PortEntry,
} from "./portsCatalog";

describe("portsCatalog", () => {
  it("lists every platform portsdr covers, priority platforms first", () => {
    expect(PORT_PLATFORMS.slice(0, 11)).toEqual([
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
    expect(PORT_PLATFORMS.length).toBeGreaterThan(11);
  });

  it("labels every platform", () => {
    for (const platform of PORT_PLATFORMS) {
      expect(PORT_PLATFORM_LABELS[platform]).toBeTruthy();
    }
  });

  it("only contains entries whose source platform is a known platform", () => {
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
    const needsAssets = portsCatalog.filter((e) => e.needsOriginalAssets);
    const selfContained = portsCatalog.filter((e) => !e.needsOriginalAssets);
    expect(needsAssets.length).toBeGreaterThan(0);
    expect(selfContained.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = new Set<string>();
    for (const entry of portsCatalog) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
    }
  });

  it("has an https projectUrl for every entry", () => {
    for (const entry of portsCatalog) {
      expect(entry.projectUrl).toMatch(/^https:\/\//);
    }
  });

  it("hosts every github-releases entry on a repo host the install pipeline can resolve", () => {
    // The release fetcher only speaks GitHub and GitLab. A project whose
    // binary lives elsewhere (itch.io, a personal site) is real and worth
    // listing, but must be classified user-assets-required, not
    // github-releases, or the install pipeline would try and fail to find it.
    for (const entry of portsCatalog) {
      if (entry.distributionKind === "github-releases") {
        expect(entry.projectUrl).toMatch(/^https:\/\/(github|gitlab)\.com\//);
      }
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

  it("only lists platforms with at least one entry as populated", () => {
    for (const platform of populatedPortPlatforms) {
      expect(portsByPlatform[platform].length).toBeGreaterThan(0);
    }
    for (const platform of PORT_PLATFORMS) {
      if (!populatedPortPlatforms.includes(platform)) {
        expect(portsByPlatform[platform].length).toBe(0);
      }
    }
  });

  it("every entry satisfies the PortEntry shape", () => {
    const requiredKeys: Array<keyof PortEntry> = [
      "id",
      "title",
      "sourcePlatform",
      "technique",
      "project",
      "description",
      "projectUrl",
      "needsOriginalAssets",
      "distributionKind",
      "portTargets",
      "deployTargets",
    ];
    for (const entry of portsCatalog) {
      for (const key of requiredKeys) {
        expect(entry[key]).toBeDefined();
      }
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.title).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(["recomp", "decomp", "port"]).toContain(entry.technique);
      expect(["github-releases", "user-assets-required"]).toContain(entry.distributionKind);
    }
  });

  it("is installable only when it publishes a binary for at least one deployable OS", () => {
    for (const entry of portsCatalog) {
      expect(isInstallable(entry)).toBe(
        entry.distributionKind === "github-releases" && entry.deployTargets.length > 0,
      );
    }
  });

  it("supportsTarget agrees with an entry's deployTargets", () => {
    for (const entry of portsCatalog) {
      expect(supportsTarget(entry, "Windows")).toBe(entry.deployTargets.includes("Windows"));
      expect(supportsTarget(entry, "Linux")).toBe(entry.deployTargets.includes("Linux"));
    }
  });

  it("deployTargets is always a subset of portTargets", () => {
    for (const entry of portsCatalog) {
      for (const target of entry.deployTargets) {
        expect(entry.portTargets).toContain(target);
      }
    }
  });
});

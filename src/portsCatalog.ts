import { generatedPortsCatalog } from "./portsCatalog.generated";
import { portOverrides } from "./portsCatalogOverrides";
import {
  PORT_PLATFORMS,
  type PortEntry,
  type PortPlatform,
  type PortTarget,
} from "./portsCatalogTypes";

export * from "./portsCatalogTypes";

/**
 * Ports catalog — PC-native releases of retro games.
 *
 * Data flows in one direction: portsdr.com is scraped into `data/sources/`,
 * that dataset generates `portsCatalog.generated.ts`, and human curation in
 * `portsCatalogOverrides.ts` is merged on top here. Regenerating never
 * clobbers curation, and curation never has to be re-derived from the source.
 *
 * Earlier revisions of this file hand-listed ten entries chosen from memory,
 * which is how eight priority platforms ended up wrongly reported as having no
 * projects at all. Generating from an index is the fix for that class of error.
 */
export const portsCatalog: PortEntry[] = generatedPortsCatalog.map((entry) => {
  const override = portOverrides[entry.id];
  return override ? ({ ...entry, ...override } as PortEntry) : (entry as PortEntry);
});

/** Index by id for the cart / install / Steam deploy paths. */
export const portsById: Record<string, PortEntry> = Object.fromEntries(
  portsCatalog.map((entry) => [entry.id, entry]),
);

/** Group entries by source platform in the UI's priority order. */
export const portsByPlatform: Record<PortPlatform, PortEntry[]> = PORT_PLATFORMS.reduce(
  (acc, platform) => {
    acc[platform] = portsCatalog.filter((entry) => entry.sourcePlatform === platform);
    return acc;
  },
  {} as Record<PortPlatform, PortEntry[]>,
);

/** Platforms with at least one entry, so the UI never renders a dead filter. */
export const populatedPortPlatforms: PortPlatform[] = PORT_PLATFORMS.filter(
  (platform) => portsByPlatform[platform].length > 0,
);

/**
 * True when GameStore can install this port itself.
 *
 * Requires a published binary and a build for an OS we deploy to. An
 * Android-only release is real and worth listing, but there is nothing this app
 * can do with it, and the card should say so rather than offering a dead button.
 */
export const isInstallable = (entry: PortEntry): boolean =>
  entry.distributionKind === "github-releases" && entry.deployTargets.length > 0;

/** Ports that publish a build for the OS the deploy target is running. */
export const supportsTarget = (entry: PortEntry, target: PortTarget): boolean =>
  entry.deployTargets.includes(target);

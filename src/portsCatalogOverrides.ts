import type { PortOverride } from "./portsCatalogTypes";

/**
 * Hand-curation layered over the generated catalog.
 *
 * This file is the only place a human edits port data. `portsCatalog.generated.ts`
 * is rewritten wholesale every time the scraper runs, so anything typed by hand
 * — above all DiMo's MiNERVA / Real-Debrid links for base game data — has to
 * live here to survive.
 *
 * Keys are generated entry ids, which are derived from the GitHub repo path
 * (`owner/name` slugified). That keeps them stable across regenerations even
 * when a project renames itself or two projects share a game title.
 *
 * `executableHint` is what makes a Steam shortcut launch the right binary, so
 * it is worth adding for any port you intend to actually deploy. Without it the
 * install pipeline falls back to scanning the extracted release for an
 * executable, which works but is a guess.
 */
export const portOverrides: Record<string, PortOverride> = {
  "harbourmasters-shipwright": {
    executableHint: "soh.exe",
    steamAppId: 2098750,
  },
  "harbourmasters-2ship2harkinian": {
    executableHint: "2s2h.exe",
  },
  "zelda64recomp-zelda64recomp": {
    executableHint: "Zelda64Recompiled.exe",
    requiredRomRevision: "Majora's Mask US 1.0 (Z64)",
  },
};

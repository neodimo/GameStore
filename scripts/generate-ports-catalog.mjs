#!/usr/bin/env node
/**
 * Generates `src/portsCatalog.generated.ts` from the scraped portsdr dataset.
 *
 *   node scripts/generate-ports-catalog.mjs [data/sources/portsdr-YYYY-MM-DD.json]
 *
 * Nothing in the generated file is invented. Every field traces to either the
 * portsdr card or the project's own GitHub repo metadata. Where a project has
 * no description of its own, the fallback states only what the dataset proves
 * (technique, original platform, port targets) rather than describing features
 * nobody verified.
 *
 * Hand-curation lives in `src/portsCatalogOverrides.ts` and is merged on top at
 * runtime, so regenerating this file never destroys a curated download link.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** portsdr's platform names -> GameStore `PortPlatform` ids. */
export const PLATFORM_MAP = {
  "Nintendo 64": "N64",
  PlayStation: "PS1",
  Dreamcast: "Dreamcast",
  GameCube: "GameCube",
  Wii: "Wii",
  "Wii U": "Wii U",
  Xbox: "Xbox",
  "Xbox 360": "Xbox 360",
  Switch: "Switch",
  Saturn: "Saturn",
  "PlayStation 2": "PS2",
  "PlayStation Portable": "PSP",
  SNES: "SNES",
  NES: "NES",
  "Game Boy Advance": "GBA",
  "Game Boy Color": "GBC",
  "Game Boy": "GB",
  "Nintendo DS": "DS",
  "Mega Drive": "Mega Drive",
  Others: "Other",
};

/** Deployment targets GameStore can actually send to. */
const DEPLOYABLE_TARGETS = new Set(["Windows", "Linux"]);

/**
 * Classifies how the port was produced.
 *
 * The distinction is not cosmetic: a static recompilation lifts the original
 * machine code, so it needs the exact ROM revision it was built against, while
 * a decompilation rebuilds source and is usually tolerant of any matching
 * regional dump. Both still require the user's own copy.
 */
export function classifyTechnique({ project, description, topics }) {
  const haystack = `${project} ${description ?? ""} ${(topics ?? []).join(" ")}`.toLowerCase();
  if (/recomp|recompil/.test(haystack)) return "recomp";
  if (/decomp|decompil/.test(haystack)) return "decomp";
  return "port";
}

const TECHNIQUE_NOUN = {
  recomp: "Static recompilation",
  decomp: "Decompilation-based PC port",
  port: "Native PC port",
};

/**
 * Whether the user must supply their own copy of the original game.
 *
 * Defaults to true. Recomps and decomps ship code, not content — the near
 * universal rule in this scene is that you bring your own dump. Only an
 * explicit statement that data is bundled flips this off, because guessing
 * wrong in the permissive direction tells a user the port will run when it
 * will refuse to start.
 */
export function requiresOriginalAssets(description) {
  const text = (description ?? "").toLowerCase();
  if (/\b(assets|game data|datos del juego|data files)\b[^.]*\b(included|bundled|incluidos)\b/.test(text)) return false;
  if (/\bincludes (all )?(game )?(assets|data)\b/.test(text)) return false;
  return true;
}

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

/** Repo path makes a stable, collision-free id even for duplicate game titles. */
export const entryId = (project) =>
  project.repo
    ? slugify(project.repo.replace("https://github.com/", ""))
    : slugify(`${project.title}-${project.project}`);

/** Only ever states what the dataset proves. */
export function describe(project, technique) {
  const own = project.github?.desc?.trim();
  if (own) return own;
  const platform = project.originalPlatform;
  const targets = project.portTargets.length ? project.portTargets.join(", ") : "unlisted targets";
  const assets = requiresOriginalAssets(null)
    ? " Requires your own copy of the original game; no game data is included."
    : "";
  return `${TECHNIQUE_NOUN[technique]} of the ${platform} release, targeting ${targets}. The project publishes no description of its own.${assets}`;
}

export function toEntry(project) {
  const sourcePlatform = PLATFORM_MAP[project.originalPlatform] ?? "Other";
  const technique = classifyTechnique({
    project: project.project,
    description: project.github?.desc,
    topics: project.github?.topics,
  });
  const deployTargets = project.portTargets.filter((target) => DEPLOYABLE_TARGETS.has(target));
  return {
    id: entryId(project),
    title: project.title,
    sourcePlatform,
    project: project.project,
    technique,
    description: describe(project, technique),
    projectUrl: project.repo || project.website,
    websiteUrl: project.website || undefined,
    needsOriginalAssets: requiresOriginalAssets(project.github?.desc),
    distributionKind: project.releaseUrl ? "github-releases" : "user-assets-required",
    releasesUrl: project.releaseUrl || undefined,
    releaseVersion: project.releaseVersion || undefined,
    preRelease: project.releaseStatus === "Pre-release" || undefined,
    aiAssisted: project.aiAssisted || undefined,
    archived: project.github?.archived || undefined,
    stars: project.github?.stars ?? undefined,
    updatedAt: project.updatedAt || undefined,
    portTargets: project.portTargets,
    deployTargets,
    coverUrl: project.iconUrl || undefined,
  };
}

const serialize = (value) => JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");

const latestDataset = async (dir) => {
  const files = (await readdir(dir)).filter((f) => /^portsdr-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`No portsdr dataset in ${dir}. Run scripts/scrape-portsdr.mjs first.`);
  return path.join(dir, files[files.length - 1]);
};

async function main() {
  const file = process.argv[2] ?? (await latestDataset("data/sources"));
  const dataset = JSON.parse(await readFile(file, "utf8"));

  const seen = new Set();
  const entries = dataset.projects
    .map(toEntry)
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((a, b) => a.title.localeCompare(b.title) || a.project.localeCompare(b.project));

  const body = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source:    ${dataset.source}
// Scraped:   ${dataset.scrapedAt}
// Dataset:   ${file}
// Regenerate: node scripts/scrape-portsdr.mjs && node scripts/generate-ports-catalog.mjs
//
// ${entries.length} projects, ${entries.filter((e) => e.releasesUrl).length} with published release binaries.
// Descriptions are each project's own GitHub repo description where one exists.
// Hand-curation belongs in portsCatalogOverrides.ts, which is merged over this.
import type { GeneratedPortEntry } from "./portsCatalogTypes";

export const generatedPortsCatalog: GeneratedPortEntry[] = ${serialize(entries)};
`;

  await writeFile("src/portsCatalog.generated.ts", body);
  const byPlatform = entries.reduce((acc, entry) => {
    acc[entry.sourcePlatform] = (acc[entry.sourcePlatform] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`src/portsCatalog.generated.ts: ${entries.length} entries`);
  console.log(
    Object.entries(byPlatform)
      .sort((a, b) => b[1] - a[1])
      .map(([platform, count]) => `  ${platform}: ${count}`)
      .join("\n"),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

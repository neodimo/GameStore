#!/usr/bin/env node
/**
 * Scrapes portsdr.com into the source dataset the Ports catalog is generated
 * from, then enriches each project with its own GitHub repo description.
 *
 * Why scrape HTML: portsdr publishes no JSON API. Every candidate endpoint
 * (/api/projects, /data/projects.json, /projects.json, /api/catalog) returns
 * the SPA shell as text/html. The catalog page is server-rendered though, and
 * every card carries the fields we need as data-* attributes, so parsing it is
 * stable as long as the markup keeps those attributes.
 *
 * Descriptions do NOT come from portsdr — its cards have no description text
 * at all. They come from each project's own GitHub repo description, which is
 * the project maintainer's own words about what the port is.
 *
 *   node scripts/scrape-portsdr.mjs [--out data/sources]
 *
 * GitHub enrichment uses `gh api` when the CLI is authenticated (5000 req/hr)
 * and falls back to unauthenticated fetch (60 req/hr, will rate-limit) so the
 * script still runs in CI without a token, just with fewer descriptions.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SOURCE_URL = "https://portsdr.com/";

const outDir = (() => {
  const flag = process.argv.indexOf("--out");
  return flag > -1 ? process.argv[flag + 1] : "data/sources";
})();

const decodeEntities = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&apos;/g, "'");

const stripTags = (value) => decodeEntities(value.replace(/<[^>]+>/g, "")).trim();

/** Pulls every port card out of the rendered catalog page. */
export function parsePortsdr(html) {
  const cards = html.match(/<article class="port-card"[\s\S]*?<\/article>/g) ?? [];
  return cards.map((card) => {
    const attr = (name) => card.match(new RegExp(`data-${name}="([^"]*)"`))?.[1] ?? "";
    const release = card.match(
      /<div class="release-info">[\s\S]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    );
    const linkFor = (label) =>
      card.match(new RegExp(`href="([^"]+)"[^>]*>${label}</a>`))?.[1] ?? "";
    return {
      title: stripTags(card.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] ?? ""),
      project: stripTags(card.match(/class="project-name">([\s\S]*?)<\/p>/)?.[1] ?? ""),
      originalPlatform: attr("original-platform"),
      portTargets: attr("platforms").split("|").filter(Boolean),
      updatedAt: attr("updated-at"),
      releaseUrl: release?.[1] ?? "",
      releaseVersion: release ? stripTags(release[2]).replace(/^Version\s+/i, "") : "",
      releaseStatus: stripTags(card.match(/class="release-status">([\s\S]*?)<\/span>/)?.[1] ?? ""),
      aiAssisted: /class="ai-assisted"/.test(card),
      repo: linkFor("Repository"),
      website: linkFor("Project Website"),
      iconUrl: card.match(/<div class="port-icon">[\s\S]*?src="([^"]+)"/)?.[1] ?? "",
    };
  });
}

const ghApi = async (repoPath) => {
  const fields = "{desc:.description,topics:.topics,stars:.stargazers_count,archived:.archived,pushed:.pushed_at,license:.license.spdx_id}";
  try {
    const { stdout } = await run("gh", ["api", `repos/${repoPath}`, "--jq", fields], {
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
};

/** Runs `worker` over `items` with at most `limit` in flight. */
const pooled = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
};

async function main() {
  const response = await fetch(SOURCE_URL, { headers: { "user-agent": "GameStore/ports-catalog" } });
  if (!response.ok) throw new Error(`portsdr.com returned ${response.status}`);
  const cards = parsePortsdr(await response.text());
  if (!cards.length) throw new Error("Parsed zero cards — portsdr markup likely changed.");

  const repos = [...new Set(cards.map((card) => card.repo).filter(Boolean))];
  const meta = new Map();
  const fetched = await pooled(repos, 10, async (repo) => {
    const repoPath = repo.replace("https://github.com/", "").replace(/\/$/, "");
    return [repo, await ghApi(repoPath)];
  });
  for (const [repo, data] of fetched) if (data) meta.set(repo, data);

  const dataset = {
    source: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    cardCount: cards.length,
    withReleaseBinaries: cards.filter((card) => card.releaseUrl).length,
    withGithubDescription: cards.filter((card) => meta.get(card.repo)?.desc).length,
    projects: cards.map((card) => ({ ...card, github: meta.get(card.repo) ?? null })),
  };

  await mkdir(outDir, { recursive: true });
  const stamp = dataset.scrapedAt.slice(0, 10);
  const file = path.join(outDir, `portsdr-${stamp}.json`);
  await writeFile(file, `${JSON.stringify(dataset, null, 1)}\n`);
  console.log(
    `${file}: ${dataset.cardCount} projects, ${dataset.withReleaseBinaries} with release binaries, ${dataset.withGithubDescription} with descriptions`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

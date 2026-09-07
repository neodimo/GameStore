import type { PortRelease, ReleaseAsset } from "./portsPipeline";

export type FetchLike = typeof fetch;

/**
 * Resolves a port's current release from GitHub or GitLab.
 *
 * The catalog records the release tag that was current when the dataset was
 * scraped, which is right for display and wrong for installing — these projects
 * ship often, and installing a tag from a week-old scrape would hand users a
 * stale build with no way to notice. So the tag in the catalog is treated as a
 * fact about the dataset, and the binary is always fetched from whatever the
 * project publishes as latest at install time.
 *
 * GitHub hosts the large majority of the catalog, but a handful of recomps —
 * several N64 titles among them — live on GitLab with their own published
 * releases. Treating those as source-only because the host isn't GitHub would
 * quietly drop real, installable projects from the pipeline.
 *
 * Transport is injected so the resolution logic is testable without a network.
 */
const GITHUB_API = "https://api.github.com";
const GITLAB_API = "https://gitlab.com/api/v4";

export type RepoHost = "github" | "gitlab";
export type RepoRef = { host: RepoHost; path: string };

/** Parses a GitHub or GitLab project URL into its API path. */
export function repoPath(projectUrl: string): RepoRef | null {
  const github = projectUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (github) return { host: "github", path: `${github[1]}/${github[2].replace(/\.git$/, "")}` };
  const gitlab = projectUrl.match(/^https:\/\/gitlab\.com\/([^#?]+?)\/?$/i);
  if (gitlab) return { host: "gitlab", path: gitlab[1].replace(/\.git$/, "") };
  return null;
}

type GithubApiRelease = {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
};

const toGithubRelease = (raw: GithubApiRelease): PortRelease => ({
  tag: raw.tag_name ?? "",
  htmlUrl: raw.html_url ?? "",
  assets: (raw.assets ?? [])
    .filter((asset): asset is { name: string; browser_download_url: string; size?: number } =>
      Boolean(asset.name && asset.browser_download_url),
    )
    .map<ReleaseAsset>((asset) => ({
      name: asset.name,
      downloadUrl: asset.browser_download_url,
      size: asset.size ?? 0,
    })),
});

async function fetchGithubRelease(
  path: string,
  fetchImpl: FetchLike,
  token?: string,
): Promise<PortRelease | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "GameStore",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const latest = await fetchImpl(`${GITHUB_API}/repos/${path}/releases/latest`, { headers });
  if (latest.ok) {
    const release = toGithubRelease((await latest.json()) as GithubApiRelease);
    if (release.assets.length) return release;
  } else if (latest.status !== 404) {
    throw new Error(`GitHub returned ${latest.status} resolving the latest release for ${path}.`);
  }

  // `/releases/latest` 404s for a project that has only ever published
  // pre-releases — common among these recomps — so the full list is the
  // fallback rather than treating that 404 as "no binary".
  const list = await fetchImpl(`${GITHUB_API}/repos/${path}/releases?per_page=10`, { headers });
  if (!list.ok) throw new Error(`GitHub returned ${list.status} listing releases for ${path}.`);
  const releases = ((await list.json()) as GithubApiRelease[]) ?? [];
  return releases.filter((raw) => !raw.draft).map(toGithubRelease).find((release) => release.assets.length) ?? null;
}

type GitlabApiRelease = {
  tag_name?: string;
  _links?: { self?: string };
  assets?: { links?: { name?: string; direct_asset_url?: string; url?: string }[]; count?: number };
};

const toGitlabRelease = (raw: GitlabApiRelease): PortRelease => ({
  tag: raw.tag_name ?? "",
  htmlUrl: raw._links?.self ?? "",
  assets: (raw.assets?.links ?? [])
    .filter((link): link is { name: string; direct_asset_url?: string; url: string } =>
      Boolean(link.name && (link.direct_asset_url || link.url)),
    )
    .map<ReleaseAsset>((link) => ({
      name: link.name,
      downloadUrl: link.direct_asset_url ?? link.url!,
      // GitLab's release-links API does not report asset size.
      size: 0,
    })),
});

async function fetchGitlabRelease(
  path: string,
  fetchImpl: FetchLike,
  token?: string,
): Promise<PortRelease | null> {
  const headers: Record<string, string> = { "User-Agent": "GameStore" };
  if (token) headers["PRIVATE-TOKEN"] = token;
  const encoded = encodeURIComponent(path);
  const list = await fetchImpl(`${GITLAB_API}/projects/${encoded}/releases?per_page=10`, { headers });
  if (!list.ok) throw new Error(`GitLab returned ${list.status} listing releases for ${path}.`);
  const releases = ((await list.json()) as GitlabApiRelease[]) ?? [];
  return releases.map(toGitlabRelease).find((release) => release.assets.length) ?? null;
}

/** Fetches the newest installable release for a project, from whichever host it lives on. */
export async function fetchLatestRelease(
  projectUrl: string,
  fetchImpl: FetchLike = fetch,
  token?: string,
): Promise<PortRelease | null> {
  const repo = repoPath(projectUrl);
  if (!repo) return null;
  return repo.host === "github"
    ? fetchGithubRelease(repo.path, fetchImpl, token)
    : fetchGitlabRelease(repo.path, fetchImpl, token);
}

import { describe, expect, it, vi } from "vitest";
import { fetchLatestRelease, repoPath } from "./portsRelease";

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

describe("repoPath", () => {
  it("parses a GitHub project URL into owner/name", () => {
    expect(repoPath("https://github.com/HarbourMasters/Shipwright")).toEqual({
      host: "github",
      path: "HarbourMasters/Shipwright",
    });
  });

  it("strips a trailing .git suffix", () => {
    expect(repoPath("https://github.com/HarbourMasters/Shipwright.git")).toEqual({
      host: "github",
      path: "HarbourMasters/Shipwright",
    });
  });

  it("parses a GitLab project URL", () => {
    expect(repoPath("https://gitlab.com/sonicdcer/Starfox64Recomp")).toEqual({
      host: "gitlab",
      path: "sonicdcer/Starfox64Recomp",
    });
  });

  it("returns null for a URL on neither host", () => {
    expect(repoPath("https://openpete.com/")).toBeNull();
  });
});

describe("fetchLatestRelease — GitHub", () => {
  it("uses /releases/latest when it has assets", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ tag_name: "v8.0", html_url: "https://x/v8.0", assets: [{ name: "soh.zip", browser_download_url: "https://x/soh.zip", size: 10 }] }),
    );
    const release = await fetchLatestRelease("https://github.com/HarbourMasters/Shipwright", fetchImpl as never);
    expect(release?.tag).toBe("v8.0");
    expect(release?.assets).toEqual([{ name: "soh.zip", downloadUrl: "https://x/soh.zip", size: 10 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the release list when latest 404s, common for pre-release-only Xbox 360 recomps", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 404))
      .mockResolvedValueOnce(
        jsonResponse([
          { tag_name: "v0.2-pre", draft: false, assets: [{ name: "recomp.zip", browser_download_url: "https://x/r.zip", size: 5 }] },
        ]),
      );
    const release = await fetchLatestRelease("https://github.com/owner/repo", fetchImpl as never);
    expect(release?.tag).toBe("v0.2-pre");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips draft releases in the fallback list", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 404))
      .mockResolvedValueOnce(
        jsonResponse([
          { tag_name: "v0.3-draft", draft: true, assets: [{ name: "x.zip", browser_download_url: "https://x/x.zip", size: 1 }] },
          { tag_name: "v0.2", draft: false, assets: [{ name: "r.zip", browser_download_url: "https://x/r.zip", size: 5 }] },
        ]),
      );
    const release = await fetchLatestRelease("https://github.com/owner/repo", fetchImpl as never);
    expect(release?.tag).toBe("v0.2");
  });

  it("returns null when no release has any assets", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 404))
      .mockResolvedValueOnce(jsonResponse([{ tag_name: "v0.1", draft: false, assets: [] }]));
    expect(await fetchLatestRelease("https://github.com/owner/repo", fetchImpl as never)).toBeNull();
  });

  it("throws on a non-404 error rather than silently reporting no release", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    await expect(fetchLatestRelease("https://github.com/owner/repo", fetchImpl as never)).rejects.toThrow(/500/);
  });

  it("returns null for a project URL on neither GitHub nor GitLab", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchLatestRelease("https://openpete.com/", fetchImpl as never)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchLatestRelease — GitLab", () => {
  it("resolves the newest release with assets from the GitLab releases API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          tag_name: "v1.0.3",
          _links: { self: "https://gitlab.com/sonicdcer/Starfox64Recomp/-/releases/v1.0.3" },
          assets: { links: [{ name: "starfox64-windows.zip", direct_asset_url: "https://gitlab.com/x/starfox64-windows.zip" }] },
        },
      ]),
    );
    const release = await fetchLatestRelease("https://gitlab.com/sonicdcer/Starfox64Recomp", fetchImpl as never);
    expect(release?.tag).toBe("v1.0.3");
    expect(release?.assets).toEqual([{ name: "starfox64-windows.zip", downloadUrl: "https://gitlab.com/x/starfox64-windows.zip", size: 0 }]);
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://gitlab.com/api/v4/projects/sonicdcer%2FStarfox64Recomp/releases?per_page=10");
  });

  it("skips a release with no asset links", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        { tag_name: "v1.0.4", assets: { links: [] } },
        { tag_name: "v1.0.3", assets: { links: [{ name: "x.zip", url: "https://gitlab.com/x.zip" }] } },
      ]),
    );
    const release = await fetchLatestRelease("https://gitlab.com/sonicdcer/Starfox64Recomp", fetchImpl as never);
    expect(release?.tag).toBe("v1.0.3");
  });
});

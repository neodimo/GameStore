import { describe, expect, it, vi } from "vitest";
import { normalizeTitle, searchGame, verticalGridFor, verticalGrids } from "./steamGridDb";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("SteamGridDB title normalization", () => {
  it("drops the region and disc decoration a catalog title carries", () => {
    expect(normalizeTitle("Final Fantasy VII (USA) (Disc 1)")).toBe("final fantasy vii");
    expect(normalizeTitle("Castlevania: Symphony of the Night [T-En]")).toBe("castlevania symphony of the night");
  });
});

describe("SteamGridDB search", () => {
  it("addresses www.steamgriddb.com, the host that resolves", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("https://www.steamgriddb.com/api/v2/");
      expect(String(url)).not.toContain("api.steamgriddb.com");
      return json({ success: true, data: [{ id: 1, name: "Anything" }] });
    });
    await searchGame("Anything", "key", fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("prefers an exact title over the service's own ranking", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        success: true,
        data: [
          { id: 10, name: "Final Fantasy VII Remake" },
          { id: 11, name: "Final Fantasy VII" },
        ],
      }),
    );
    await expect(searchGame("Final Fantasy VII (USA) (Disc 1)", "key", fetchImpl as typeof fetch)).resolves.toMatchObject({
      id: 11,
    });
  });

  it("falls back to the top hit when nothing matches exactly", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, data: [{ id: 7, name: "Tekken 3 Arcade" }] }));
    await expect(searchGame("Tekken 3", "key", fetchImpl as typeof fetch)).resolves.toMatchObject({ id: 7 });
  });

  it("reports the API's own refusal instead of a generic failure", async () => {
    const fetchImpl = vi.fn(async () => json({ success: false, errors: ["Invalid key format"] }, 401));
    await expect(searchGame("Anything", "bad", fetchImpl as typeof fetch)).rejects.toThrow(/401.*Invalid key format/s);
  });
});

describe("SteamGridDB vertical grids", () => {
  it("asks only for 2:3 static art and ranks by score", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("dimensions=600x900");
      expect(String(url)).toContain("types=static");
      return json({
        success: true,
        data: [
          { id: 1, url: "https://cdn/low.png", width: 600, height: 900, score: 2 },
          { id: 2, url: "https://cdn/high.png", width: 600, height: 900, score: 9 },
        ],
      });
    });
    const grids = await verticalGrids(11, "key", fetchImpl as typeof fetch);
    expect(grids.map((grid) => grid.id)).toEqual([2, 1]);
  });

  it("refuses art that is not the grid's shape even if the API returns it", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        success: true,
        data: [{ id: 3, url: "https://cdn/banner.png", width: 460, height: 215, score: 99 }],
      }),
    );
    await expect(verticalGrids(11, "key", fetchImpl as typeof fetch)).resolves.toEqual([]);
  });
});

describe("SteamGridDB cover resolution", () => {
  it("returns the highest-scoring vertical for a title", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/search/")
        ? json({ success: true, data: [{ id: 11, name: "Final Fantasy VII" }] })
        : json({ success: true, data: [{ id: 2, url: "https://cdn/ff7.png", width: 600, height: 900, score: 9 }] }),
    );
    await expect(verticalGridFor("Final Fantasy VII (USA)", "key", fetchImpl as typeof fetch)).resolves.toBe(
      "https://cdn/ff7.png",
    );
  });

  it("stays quiet for an unknown game so the native cover can be used", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, data: [] }));
    await expect(verticalGridFor("Some Obscure Release", "key", fetchImpl as typeof fetch)).resolves.toBeUndefined();
  });

  it("never calls the network without a key", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, data: [] }));
    await expect(verticalGridFor("Anything", "   ", fetchImpl as typeof fetch)).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

export type FetchLike = typeof fetch;

/**
 * SteamGridDB as the source of Steam-shaped cover art.
 *
 * The covers GameStore already holds are the console's own artwork: a PS1 jewel
 * case is roughly 4:3, a cartridge label is nearly square. Steam's library grid
 * draws 2:3. Handing Steam a native cover means Steam crops or pillarboxes it,
 * so the tile that lands in the library is not the picture the user approved.
 * SteamGridDB publishes art drawn *for* that grid, which is why it is worth a
 * network call rather than cropping locally.
 *
 * The host is `www.steamgriddb.com`; `api.steamgriddb.com` has no DNS record at
 * all, so a request there fails as a connection error and never reaches the
 * point where the key would be judged.
 *
 * Every function here takes its key as an argument and its transport as an
 * injectable `fetchImpl`. Nothing in this module reads settings or disk: the
 * caller owns where the key lives, which keeps the credential out of the layer
 * that formats URLs.
 */
const API = "https://www.steamgriddb.com/api/v2";

/** Steam's library grid. Assets are published at exact multiples of this. */
export const GRID_WIDTH = 600;
export const GRID_HEIGHT = 900;

export type GridCandidate = {
  id: number;
  url: string;
  width: number;
  height: number;
  score: number;
  style: string;
  nsfw: boolean;
  humor: boolean;
};

type SearchHit = { id: number; name: string };

const authorized = (key: string) => ({ Authorization: `Bearer ${key}`, Accept: "application/json" });

/**
 * Reports the API's own failure text rather than a generic one. A wrong key and
 * a rate limit are both 4xx and are fixed by different actions, so the message
 * has to survive to the UI.
 */
const readBody = async <T>(response: Response, what: string): Promise<T> => {
  const text = await response.text();
  if (!response.ok) throw new Error(`SteamGridDB ${what} failed: ${response.status} ${text.slice(0, 200)}`);
  let parsed: { success?: boolean; data?: T; errors?: string[] };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`SteamGridDB ${what} returned a non-JSON body: ${text.slice(0, 120)}`);
  }
  if (!parsed.success) throw new Error(`SteamGridDB ${what} refused: ${(parsed.errors ?? []).join("; ") || "no reason given"}`);
  return parsed.data as T;
};

/**
 * Strips the decoration that catalog titles carry and SteamGridDB names do not
 * — region tags, disc numbers, revision markers, subtitle punctuation — so that
 * "Final Fantasy VII (USA) (Disc 1)" can be compared against "Final Fantasy VII".
 */
export const normalizeTitle = (title: string) =>
  title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[:\-–—_.!?'’,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export async function searchGame(
  title: string,
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<SearchHit | undefined> {
  const term = normalizeTitle(title);
  if (!term) return undefined;
  const response = await fetchImpl(`${API}/search/autocomplete/${encodeURIComponent(term)}`, {
    headers: authorized(key),
  });
  const hits = await readBody<SearchHit[]>(response, "search");
  if (!hits?.length) return undefined;
  // An exact normalized match beats the service's own ranking, which is tuned
  // for partial typing and will happily rank a sequel above the game asked for.
  return hits.find((hit) => normalizeTitle(hit.name) === term) ?? hits[0];
}

export async function verticalGrids(
  gameId: number,
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<GridCandidate[]> {
  const query = new URLSearchParams({
    dimensions: `${GRID_WIDTH}x${GRID_HEIGHT}`,
    types: "static",
    nsfw: "false",
    humor: "false",
  });
  const response = await fetchImpl(`${API}/grids/game/${gameId}?${query}`, { headers: authorized(key) });
  const grids = await readBody<GridCandidate[]>(response, "grid lookup");
  return (grids ?? [])
    // The dimensions filter is server-side, but a defensive check here keeps a
    // future API change from putting a 460x215 banner into a 2:3 frame.
    .filter((grid) => grid.url && Math.abs(grid.width / grid.height - GRID_WIDTH / GRID_HEIGHT) < 0.02)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * The one call the rest of the app needs: a title in, a 2:3 image URL out.
 *
 * Returns `undefined` when the game is unknown or has no vertical art, because
 * that is an ordinary outcome for an obscure region release and the caller
 * should quietly fall back to the native cover. Genuine failures — a rejected
 * key, an unreachable host — throw, so they can be shown instead of silently
 * degrading into "no art found".
 */
export async function verticalGridFor(
  title: string,
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | undefined> {
  if (!key.trim()) return undefined;
  const hit = await searchGame(title, key, fetchImpl);
  if (!hit) return undefined;
  const [best] = await verticalGrids(hit.id, key, fetchImpl);
  return best?.url;
}

/**
 * Platform-scoped IGDB lookup for the gaps in the Libretro thumbnail packs.
 * IGDB's search is broad, so callers must still require a normalized exact
 * title before automatically applying a result.
 */
const PLATFORM_IDS: Record<string, number> = {
  PS1: 7,
  PS2: 8,
  N64: 4,
  SAT: 32,
  X360: 12,
};

type Credentials = { clientId: string; clientSecret: string };
type Token = { value: string; expiresAt: number };
let token: Token | null = null;
let queue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const igdbPlatformId = (platform: string) => PLATFORM_IDS[platform];
export const igdbImageUrl = (url: string | undefined, size: "cover_big" | "screenshot_huge") =>
  url ? `https:${url}`.replace("t_thumb", `t_${size}`) : undefined;

const getToken = async ({ clientId, clientSecret }: Credentials) => {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`IGDB sign-in returned ${response.status}`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("IGDB sign-in returned no access token.");
  token = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 };
  return token.value;
};

export type IgdbMedia = { title: string; cover?: string; screenshots: string[] };

export const findIgdbMedia = async (credentials: Credentials, title: string, platform: string): Promise<IgdbMedia[]> => {
  const platformId = igdbPlatformId(platform);
  if (!platformId) return [];
  const scheduled = queue.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay) await pause(delay);
    // IGDB permits four requests/s. One spaced queue covers automatic card
    // fallbacks and an open ArtPicker without competing bursts.
    nextRequestAt = Date.now() + 300;
    const accessToken = await getToken(credentials);
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: { "Client-ID": credentials.clientId, Authorization: `Bearer ${accessToken}` },
      body: `search ${JSON.stringify(title)}; fields name,cover.url,screenshots.url; where platforms = (${platformId}); limit 12;`,
    });
    if (!response.ok) throw new Error(`IGDB returned ${response.status}`);
    const games = await response.json() as { name?: string; cover?: { url?: string }; screenshots?: { url?: string }[] }[];
    return games.map((game) => ({
      title: game.name ?? "",
      cover: igdbImageUrl(game.cover?.url, "cover_big"),
      screenshots: (game.screenshots ?? []).map((shot) => igdbImageUrl(shot.url, "screenshot_huge")).filter((url): url is string => Boolean(url)),
    }));
  });
  queue = scheduled.then(() => undefined, () => undefined);
  return scheduled;
};

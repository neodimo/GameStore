import type { Game } from "./catalog";
import { usCatalog } from "./n64UsCatalog";

const art = (name: string) =>
  `https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%2064/Named_Boxarts/${encodeURIComponent(name)}.png`;
const wiki = (title: string) =>
  `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(title)}`;

/** USA first; English European releases are retained only when no USA title exists. */
export const n64Games: Game[] = usCatalog.map((seed) => ({
  id: `n64-${seed.id}`,
  platform: "N64",
  title: seed.title,
  year: seed.year,
  region: seed.coverName.includes("(Europe)") ? "Europe" : "USA",
  genres: seed.genres,
  facets: [],
  description: seed.description ?? "",
  descriptionSource: seed.descriptionSource
    ? { label: "Catalog description source", url: seed.descriptionSource }
    : undefined,
  cover: art(seed.coverName),
  coverName: seed.coverName,
  players: !seed.players || seed.players === "0" ? "Unknown" : seed.players === "1" ? "1" : `1-${seed.players}`,
  developer: seed.developer ?? "Unknown",
  publisher: seed.publisher ?? undefined,
  esrb: seed.esrb ?? undefined,
  rating: seed.rating
    ? { source: "LaunchBox community", score: seed.rating.score, count: seed.rating.count }
    : undefined,
  links: [
    { label: "Game reference", url: wiki(seed.title), state: "verified" },
    ...(seed.descriptionSource
      ? [{ label: "Description source", url: seed.descriptionSource, state: "verified" as const }]
      : []),
  ],
}));

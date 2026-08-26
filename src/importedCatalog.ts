import type { Game } from "./catalog";
import type { UsCatalogSeed } from "./n64UsCatalog";
import { platformOf, type PlatformId } from "./platforms";

/**
 * Turns a generated importer seed into catalog records.
 *
 * The N64 mapper was written inline and would have been copied verbatim for
 * Saturn, which is how the cover URL builder came to be duplicated with a
 * hardcoded system in the first place. The thumbnail system is read from the
 * platform registry instead, so a console cannot be added with another
 * console's artwork.
 */
const wiki = (title: string) =>
  `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(title)}`;

/**
 * The release name Libretro publishes a thumbnail under. The importer strips
 * the dump extension, because Libretro names the file after the release and
 * never after the ROM.
 */
export const coverUrl = (platform: PlatformId, coverName: string) =>
  `https://thumbnails.libretro.com/${platformOf(platform).thumbnailSystem}/Named_Boxarts/${encodeURIComponent(coverName)}.png`;

/** USA first; English European releases are retained only when no USA title exists. */
export const importedGames = (
  platform: PlatformId,
  idPrefix: string,
  seeds: UsCatalogSeed[],
): Game[] =>
  seeds.map((seed) => ({
    id: `${idPrefix}-${seed.id}`,
    platform,
    title: seed.title,
    year: seed.year,
    region: seed.coverName.includes("(Europe)") ? "Europe" : "USA",
    genres: seed.genres,
    facets: [],
    description: seed.description ?? "",
    descriptionSource: seed.descriptionSource
      ? { label: "Catalog description source", url: seed.descriptionSource }
      : undefined,
    cover: coverUrl(platform, seed.coverName),
    coverName: seed.coverName,
    players:
      !seed.players || seed.players === "0"
        ? "Unknown"
        : seed.players === "1"
          ? "1"
          : `1-${seed.players}`,
    developer: seed.developer ?? "Unknown",
    publisher: seed.publisher ?? undefined,
    esrb: seed.esrb ?? undefined,
    rating: seed.rating
      ? {
          source: "LaunchBox community",
          score: seed.rating.score,
          count: seed.rating.count,
        }
      : undefined,
    links: [
      { label: "Game reference", url: wiki(seed.title), state: "verified" as const },
      ...(seed.descriptionSource
        ? [
            {
              label: "Description source",
              url: seed.descriptionSource,
              state: "verified" as const,
            },
          ]
        : []),
    ],
  }));

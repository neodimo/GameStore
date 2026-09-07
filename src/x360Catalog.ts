import type { Game } from "./catalog";
import { importedGames } from "./importedCatalog";
import { usCatalog } from "./x360UsCatalog";

/**
 * Xbox 360. Catalog and library console only — there is no MiSTer core and no
 * libretro core for it, so it never appears on an FPGA control and cannot be
 * deployed to RetroArch. Native builds live in the Ports section instead.
 *
 * Almost every record here has no `coverName`: the Libretro thumbnail pack for
 * the 360 publishes 12 box arts in total, so artwork resolves at runtime
 * through TheGamesDB rather than by index lookup.
 */
export const x360Games: Game[] = importedGames("X360", "x360", usCatalog);

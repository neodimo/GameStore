import type { Game } from "./catalog";
import { importedGames } from "./importedCatalog";
import { usCatalog } from "./ps2UsCatalog";

/**
 * PlayStation 2. Sourced differently from PS1/N64/Saturn out of necessity:
 * OpenVGDB v29.0 has no PS2 table, so LaunchBox supplies release identity and
 * metadata and the Libretro thumbnail index supplies the box-art names.
 * See scripts/import-launchbox-catalog.py.
 */
export const ps2Games: Game[] = importedGames("PS2", "ps2", usCatalog);

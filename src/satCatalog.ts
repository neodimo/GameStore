import type { Game } from "./catalog";
import { importedGames } from "./importedCatalog";
import { usCatalog } from "./satUsCatalog";

/**
 * Sega Saturn, imported by the same pinned pipeline as PlayStation and N64:
 * OpenVGDB v29.0 decides which releases exist and what Redump filename each is
 * published under, LaunchBox supplies the fields the UI renders.
 */
export const saturnGames: Game[] = importedGames("SAT", "sat", usCatalog);

import type { Game } from "./catalog";
import { importedGames } from "./importedCatalog";
import { usCatalog } from "./n64UsCatalog";

export const n64Games: Game[] = importedGames("N64", "n64", usCatalog);

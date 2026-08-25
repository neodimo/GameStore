/** Stable, deliberately conservative matching for MiSTer game folders. */
export const normalizeRemoteTitle = (value: string) =>
  value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export type InventoryCatalogGame = { id: string; title: string; platform?: "PSX" | "N64" };

export const matchRemoteTitles = (
  remoteTitles: string[],
  catalog: InventoryCatalogGame[],
) => {
  const remote = new Set(remoteTitles.map(normalizeRemoteTitle).filter(Boolean));
  return catalog
    .filter((game) => remote.has(normalizeRemoteTitle(game.title)))
    .map((game) => game.id);
};

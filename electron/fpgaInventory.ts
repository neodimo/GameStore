import {
  DEVICE_PLATFORMS,
  deviceEntryTitle,
  isGameEntry,
  type DeviceFolder,
} from "./devicePlatforms";

/** Stable, deliberately conservative matching for MiSTer game folders. */
export const normalizeRemoteTitle = (value: string) =>
  value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export type InventoryCatalogGame = { id: string; title: string; platform?: DeviceFolder };

export const matchRemoteTitles = (
  remoteTitles: string[],
  catalog: InventoryCatalogGame[],
) => {
  const remote = new Set(remoteTitles.map(normalizeRemoteTitle).filter(Boolean));
  return catalog
    .filter((game) => remote.has(normalizeRemoteTitle(game.title)))
    .map((game) => game.id);
};

/** Just enough of the SFTP client to read a directory. */
export type DirectoryReader = {
  list(path: string): Promise<{ name: string; type: string }[]>;
};

/**
 * What is actually installed in each core folder on the device.
 *
 * This lives here rather than inline in `main.ts` so the defect it fixes is
 * directly testable. It used to keep only directory entries, which is a
 * disc-console assumption: a PlayStation release is several files and gets a
 * folder per game, while a cartridge is one `.z64` sitting directly in
 * `/media/fat/games/N64`. A real N64 folder full of games therefore listed as
 * empty, and the single unrelated subdirectory in it — `media` — was reported
 * as the entire installed library.
 *
 * Entries come back as display names: a folder name, or a ROM filename with
 * its extension dropped, so both layouts match catalog titles the same way.
 */
export const listDeviceGames = async (
  client: DirectoryReader,
  root: string,
): Promise<Record<DeviceFolder, string[]>> =>
  Object.fromEntries(
    await Promise.all(
      DEVICE_PLATFORMS.map(async (platform) => {
        const entries = await client
          .list(`${root}/${platform.deviceFolder}`)
          .catch(() => []);
        return [
          platform.deviceFolder,
          entries
            .filter((entry) => isGameEntry(platform, entry))
            .map((entry) => deviceEntryTitle(platform, entry.name)),
        ];
      }),
    ),
  ) as Record<DeviceFolder, string[]>;

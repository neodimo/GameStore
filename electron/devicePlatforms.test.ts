import { describe, expect, it } from "vitest";
import {
  CATALOG_PLATFORMS,
  DEVICE_FOLDERS,
  DEVICE_PLATFORMS,
  LIBRARY_FOLDERS,
  deviceFolderForCatalog,
  deviceFolderForPlatformId,
  deviceFolderForStored,
  isDeviceFolder,
  isMisterPlatform,
  libraryFolderForCatalog,
  libraryFolderForPlatformId,
  libraryFolderForStored,
} from "./devicePlatforms";

/**
 * The catalog used to be derived from the MiSTer core table, so a console the
 * MiSTer has no core for could not exist at all. Splitting the two introduced a
 * failure mode worth pinning: a PlayStation 2 or Xbox 360 game reaching an FPGA
 * resolver and being quietly filed under PlayStation, which would copy a DVD
 * image into the MiSTer's `PSX` folder and report success.
 */
describe("platform identity", () => {
  it("keeps the MiSTer folders a strict subset of the library folders", () => {
    for (const folder of DEVICE_FOLDERS) expect(LIBRARY_FOLDERS).toContain(folder);
    expect(LIBRARY_FOLDERS.length).toBeGreaterThan(DEVICE_FOLDERS.length);
    expect(DEVICE_PLATFORMS.map((platform) => platform.deviceFolder)).toEqual([...DEVICE_FOLDERS]);
  });

  it("derives the device table from the catalog rather than a second list", () => {
    expect(DEVICE_PLATFORMS).toEqual(CATALOG_PLATFORMS.filter((platform) => platform.mister));
    expect(CATALOG_PLATFORMS.filter((platform) => !platform.mister).map((p) => p.catalogId)).toEqual([
      "PS2",
      "X360",
    ]);
  });

  it("files every catalog console under its own library folder", () => {
    for (const platform of CATALOG_PLATFORMS) {
      expect(libraryFolderForCatalog(platform.catalogId)).toBe(platform.deviceFolder);
      expect(libraryFolderForPlatformId(platform.catalogId)).toBe(platform.deviceFolder);
      expect(libraryFolderForStored(platform.deviceFolder)).toBe(platform.deviceFolder);
    }
  });

  it("never resolves a console with no core to a MiSTer folder it does not own", () => {
    for (const platform of CATALOG_PLATFORMS.filter((entry) => !entry.mister)) {
      expect(isMisterPlatform(platform.catalogId)).toBe(false);
      expect(isDeviceFolder(platform.deviceFolder)).toBe(false);
      // The FPGA resolvers stay narrow on purpose. What matters is that they
      // never hand back the folder these consoles' files would be written into.
      expect(deviceFolderForCatalog(platform.catalogId)).not.toBe(platform.deviceFolder);
      expect(deviceFolderForPlatformId(platform.catalogId)).not.toBe(platform.deviceFolder);
      expect(deviceFolderForStored(platform.deviceFolder)).not.toBe(platform.deviceFolder);
    }
  });

  it("still routes every MiSTer console to its own core folder", () => {
    for (const platform of DEVICE_PLATFORMS) {
      expect(isMisterPlatform(platform.catalogId)).toBe(true);
      expect(isDeviceFolder(platform.deviceFolder)).toBe(true);
      expect(deviceFolderForCatalog(platform.catalogId)).toBe(platform.deviceFolder);
      expect(deviceFolderForStored(platform.deviceFolder)).toBe(platform.deviceFolder);
    }
  });

  it("gives a console with no BIOS an empty list rather than another console's", () => {
    for (const platform of CATALOG_PLATFORMS.filter((entry) => !entry.mister))
      expect(platform.bios).toEqual([]);
  });
});

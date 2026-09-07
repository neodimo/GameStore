import { describe, expect, it, vi } from "vitest";
import { installRetroCore, isRetroPlatform, listRetroCores } from "./retroArchCores";

describe("RetroArch core management", () => {
  it("lists the recommended core first for every supported console", async () => {
    const result = await listRetroCores("linux", vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }));
    expect(result.map((platform) => platform.platform)).toEqual(["PS1", "N64", "PS2", "SAT"]);
    expect(result.every((platform) => platform.cores[0].recommended)).toBe(true);
  });

  it("maps actual installed Linux core files back to their consoles", async () => {
    const result = await listRetroCores("linux", vi.fn().mockResolvedValue({ stdout: "swanstation\nmupen64plus_next\n", stderr: "", code: 0 }));
    // Looked up by console rather than by position: these assertions were
    // indexed, and adding PlayStation 2 ahead of Saturn moved every index.
    const of = (id: string) => result.find((platform) => platform.platform === id)!;
    expect(of("PS1").cores.find((core) => core.id === "swanstation")?.installed).toBe(true);
    expect(of("N64").cores.find((core) => core.id === "mupen64plus_next")?.installed).toBe(true);
    expect(of("SAT").cores.some((core) => core.installed)).toBe(false);
  });

  it("installs a verified Linux x64 build into Flatpak's core directory", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    await installRetroCore("linux", "kronos", run);
    expect(run.mock.calls[0][0]).toContain("nightly/linux/x86_64/latest/kronos_libretro.so.zip");
    expect(run.mock.calls[0][0]).toContain(".var/app/org.libretro.RetroArch/config/retroarch/cores");
  });

  it("uses Libretro's mednafen package id to install Beetle Saturn", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    await installRetroCore("linux", "mednafen_saturn", run);
    expect(run.mock.calls[0][0]).toContain("nightly/linux/x86_64/latest/mednafen_saturn_libretro.so.zip");
  });

  it("detects Beetle Saturn under Libretro's mednafen core filename", async () => {
    const result = await listRetroCores("linux", vi.fn().mockResolvedValue({ stdout: "mednafen_saturn\n", stderr: "", code: 0 }));
    const saturn = result.find((platform) => platform.platform === "SAT")!;
    expect(saturn.cores.find((core) => core.name === "Beetle Saturn")?.installed).toBe(true);
  });

  it("installs PCSX2 from the package id the buildbot actually publishes", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    await installRetroCore("linux", "pcsx2", run);
    expect(run.mock.calls[0][0]).toContain("nightly/linux/x86_64/latest/pcsx2_libretro.so.zip");
  });

  /**
   * The Xbox 360 is a catalog console with no emulator behind it. Libretro's
   * nightly index carries no `xenia` package on either Linux or Windows, so a
   * 360 title must be refused before the PC lane starts looking for a core and
   * reports it as merely uninstalled.
   */
  it("refuses to treat the Xbox 360 as a RetroArch console", async () => {
    expect(isRetroPlatform("X360")).toBe(false);
    expect(isRetroPlatform("PS2")).toBe(true);
    const result = await listRetroCores("linux", vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }));
    expect(result.some((platform) => platform.platform === "X360")).toBe(false);
  });
});

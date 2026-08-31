import { describe, expect, it, vi } from "vitest";
import { installRetroCore, listRetroCores } from "./retroArchCores";

describe("RetroArch core management", () => {
  it("lists the recommended core first for every supported console", async () => {
    const result = await listRetroCores("linux", vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }));
    expect(result.map((platform) => platform.platform)).toEqual(["PS1", "N64", "SAT"]);
    expect(result.every((platform) => platform.cores[0].recommended)).toBe(true);
  });

  it("maps actual installed Linux core files back to their consoles", async () => {
    const result = await listRetroCores("linux", vi.fn().mockResolvedValue({ stdout: "swanstation\nmupen64plus_next\n", stderr: "", code: 0 }));
    expect(result[0].cores.find((core) => core.id === "swanstation")?.installed).toBe(true);
    expect(result[1].cores.find((core) => core.id === "mupen64plus_next")?.installed).toBe(true);
    expect(result[2].cores.some((core) => core.installed)).toBe(false);
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
    expect(result[2].cores.find((core) => core.name === "Beetle Saturn")?.installed).toBe(true);
  });
});

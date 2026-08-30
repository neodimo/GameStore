import { describe, expect, it } from "vitest";
import {
  checkRetroArch,
  installRetroArch,
  parseFlatpakList,
  parseFlatpakRemoteInfoVersion,
  parseWingetList,
  updateRetroArch,
  type RetroArchInstallMethod,
} from "./retroArch";
import type { CommandResult } from "./pcTarget";

const fixedRun = (responses: Record<string, CommandResult>) => async (command: string) =>
  responses[command] ?? { stdout: "", stderr: `not found: ${command}`, code: 127 };

describe("parseFlatpakList", () => {
  it("parses tab-separated application/version rows", () => {
    const apps = parseFlatpakList(
      "org.mozilla.firefox\t131.0\norg.libretro.RetroArch\t1.19.1\ncom.valvesoftware.Steam\t1.0.0.81\n",
    );
    expect(apps.get("org.libretro.RetroArch")).toBe("1.19.1");
    expect(apps.size).toBe(3);
  });

  it("returns an empty map when RetroArch is not installed", () => {
    expect(parseFlatpakList("org.mozilla.firefox\t131.0\n").has("org.libretro.RetroArch")).toBe(false);
  });
});

describe("parseFlatpakRemoteInfoVersion", () => {
  it("reads the Version: line out of flatpak remote-info's freeform output", () => {
    const output = [
      "ID: org.libretro.RetroArch",
      "Ref: app/org.libretro.RetroArch/x86_64/stable",
      "Arch: x86_64",
      "Branch: stable",
      "Version: 1.20.0",
      "License: GPL-3.0-only",
    ].join("\n");
    expect(parseFlatpakRemoteInfoVersion(output)).toBe("1.20.0");
  });

  it("returns undefined when the remote has no version line, e.g. an unconfigured remote's error text", () => {
    expect(parseFlatpakRemoteInfoVersion("error: No remote refs found for 'flathub'")).toBeUndefined();
  });
});

describe("parseWingetList", () => {
  it("reads installed and available versions from winget's aligned table", () => {
    const output = [
      "Name      Id                  Version  Available  Source",
      "-----------------------------------------------------------",
      "RetroArch Libretro.RetroArch  1.19.1   1.20.0     winget",
    ].join("\n");
    const parsed = parseWingetList(output);
    expect(parsed).toEqual({ found: true, versionUnknown: false, version: "1.19.1", latestVersion: "1.20.0" });
  });

  it("reads an installed version with no available update as a single version token", () => {
    const output = [
      "Name      Id                  Version  Source",
      "RetroArch Libretro.RetroArch  1.20.0   winget",
    ].join("\n");
    const parsed = parseWingetList(output);
    expect(parsed.version).toBe("1.20.0");
    expect(parsed.latestVersion).toBeUndefined();
  });

  it("flags the real Steam-managed case: winget lists it with an Unknown version", () => {
    const output = [
      "Name      Id                  Version  Source",
      "RetroArch Libretro.RetroArch  Unknown  winget",
    ].join("\n");
    expect(parseWingetList(output)).toEqual({ found: true, versionUnknown: true });
  });

  it("reports not found when winget has no matching row", () => {
    expect(parseWingetList("No installed package found matching input criteria.").found).toBe(false);
  });
});

describe("checkRetroArch", () => {
  it("detects a Flatpak install with an update available", async () => {
    const status = await checkRetroArch(
      "linux",
      fixedRun({
        "flatpak list --user --app --columns=application,version": {
          stdout: "org.libretro.RetroArch\t1.19.1\n",
          stderr: "",
          code: 0,
        },
        "flatpak remote-info --user flathub org.libretro.RetroArch": {
          stdout: "Version: 1.20.0\n",
          stderr: "",
          code: 0,
        },
      }),
    );
    expect(status).toMatchObject({ installed: true, method: "flatpak", flatpakScope: "user", version: "1.19.1", latestVersion: "1.20.0", updateAvailable: true });
  });

  it("detects a Flatpak install that is already current", async () => {
    const status = await checkRetroArch(
      "linux",
      fixedRun({
        "flatpak list --user --app --columns=application,version": { stdout: "org.libretro.RetroArch\t1.20.0\n", stderr: "", code: 0 },
        "flatpak remote-info --user flathub org.libretro.RetroArch": { stdout: "Version: 1.20.0\n", stderr: "", code: 0 },
      }),
    );
    expect(status.updateAvailable).toBe(false);
  });

  it("detects a system-scoped Flatpak without confusing duplicate remote names", async () => {
    const status = await checkRetroArch(
      "linux",
      fixedRun({
        "flatpak list --user --app --columns=application,version": { stdout: "", stderr: "", code: 0 },
        "flatpak list --system --app --columns=application,version": { stdout: "org.libretro.RetroArch\t1.20.0\n", stderr: "", code: 0 },
        "flatpak remote-info --system flathub org.libretro.RetroArch": { stdout: "Version: 1.20.0\n", stderr: "", code: 0 },
      }),
    );
    expect(status).toMatchObject({ installed: true, method: "flatpak", flatpakScope: "system", version: "1.20.0" });
  });

  it("falls back to a PATH install when no Flatpak copy exists, and does not offer to update it", async () => {
    const status = await checkRetroArch(
      "linux",
      fixedRun({
        "flatpak list --user --app --columns=application,version": { stdout: "org.mozilla.firefox\t131.0\n", stderr: "", code: 0 },
        "flatpak list --system --app --columns=application,version": { stdout: "", stderr: "", code: 0 },
        "command -v retroarch": { stdout: "/usr/bin/retroarch\n", stderr: "", code: 0 },
        "retroarch --version": { stdout: "RetroArch 1.18.0 -- \n", stderr: "", code: 0 },
      }),
    );
    expect(status.installed).toBe(true);
    expect(status.method).toBe("path");
    expect(status.version).toBe("1.18.0");
    expect(status.updateBlockedReason).toMatch(/outside flatpak/i);
  });

  it("reports not installed when neither Flatpak nor PATH has it", async () => {
    const status = await checkRetroArch(
      "linux",
      fixedRun({
        "flatpak list --user --app --columns=application,version": { stdout: "org.mozilla.firefox\t131.0\n", stderr: "", code: 0 },
        "flatpak list --system --app --columns=application,version": { stdout: "", stderr: "", code: 0 },
      }),
    );
    expect(status).toEqual({ installed: false });
  });

  it("refuses to offer an update for the real Steam-managed Windows case instead of risking a duplicate install", async () => {
    const status = await checkRetroArch(
      "windows",
      fixedRun({
        "winget list --id Libretro.RetroArch --exact": {
          stdout: "Name      Id                  Version  Source\nRetroArch Libretro.RetroArch  Unknown  winget\n",
          stderr: "",
          code: 0,
        },
      }),
    );
    expect(status.installed).toBe(true);
    expect(status.updateAvailable).toBeUndefined();
    expect(status.updateBlockedReason).toMatch(/steam/i);
  });

  it("detects a normal winget install with an update available", async () => {
    const status = await checkRetroArch(
      "windows",
      fixedRun({
        "winget list --id Libretro.RetroArch --exact": {
          stdout: "Name      Id                  Version  Available  Source\nRetroArch Libretro.RetroArch  1.19.1   1.20.0     winget\n",
          stderr: "",
          code: 0,
        },
      }),
    );
    expect(status).toMatchObject({ installed: true, method: "winget", version: "1.19.1", latestVersion: "1.20.0", updateAvailable: true });
  });
});

describe("updateRetroArch", () => {
  it("runs the Flatpak non-interactive update command", async () => {
    const calls: string[] = [];
    await updateRetroArch("linux", "flatpak", async (cmd) => {
      calls.push(cmd);
      return { stdout: "", stderr: "", code: 0 };
    });
    expect(calls).toEqual(["flatpak update -y --user org.libretro.RetroArch"]);
  });

  it("runs the winget non-interactive upgrade command", async () => {
    const calls: string[] = [];
    await updateRetroArch("windows", "winget", async (cmd) => {
      calls.push(cmd);
      return { stdout: "", stderr: "", code: 0 };
    });
    expect(calls[0]).toContain("winget upgrade --id Libretro.RetroArch --exact");
    expect(calls[0]).toContain("--silent");
  });

  it("refuses to update a PATH install it cannot safely manage", async () => {
    await expect(updateRetroArch("linux", "path" as RetroArchInstallMethod, async () => ({ stdout: "", stderr: "", code: 0 }))).rejects.toThrow(
      /does not know how to update/i,
    );
  });
});

describe("installRetroArch", () => {
  it("installs the Linux stable release from Flathub", async () => {
    const calls: string[] = [];
    await installRetroArch("linux", "stable", async (command) => {
      calls.push(command);
      return { stdout: "", stderr: "", code: 0 };
    });
    expect(calls).toEqual(["flatpak install -y --noninteractive --user flathub org.libretro.RetroArch"]);
  });

  it("adds Flathub beta and installs the Linux nightly channel", async () => {
    const calls: string[] = [];
    await installRetroArch("linux", "nightly", async (command) => {
      calls.push(command);
      return { stdout: "", stderr: "", code: 0 };
    });
    expect(calls[0]).toContain("flathub-beta.flatpakrepo");
    expect(calls[0]).toContain("flatpak install -y --noninteractive --user flathub-beta org.libretro.RetroArch");
  });

  it("installs Windows stable through winget and nightly through the official buildbot installer", async () => {
    const calls: string[] = [];
    const run = async (command: string) => {
      calls.push(command);
      return { stdout: "", stderr: "", code: 0 };
    };
    await installRetroArch("windows", "stable", run);
    await installRetroArch("windows", "nightly", run);
    expect(calls[0]).toContain("winget install --id Libretro.RetroArch --exact");
    expect(calls[1]).toContain("buildbot.libretro.com/nightly/windows/x86_64/RetroArch-Win64-setup.exe");
    expect(calls[1]).toContain("'/S'");
  });

  it("surfaces a failed installer instead of claiming success", async () => {
    await expect(
      installRetroArch("linux", "stable", async () => ({ stdout: "", stderr: "no flathub", code: 1 })),
    ).rejects.toThrow("no flathub");
  });
});

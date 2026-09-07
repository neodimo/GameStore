import { describe, expect, it, vi } from "vitest";
import { checkXenia, installXenia } from "./xenia";

describe("Xenia Canary lifecycle", () => {
  it("reports an installed Linux release and compares its version to GitHub", async () => {
    const run = vi.fn(async (command: string) => command.includes("test -x")
      ? { stdout: "installed\noldtag\n", stderr: "", code: 0 }
      : { stdout: "newtag\n", stderr: "", code: 0 });
    await expect(checkXenia("linux", run)).resolves.toMatchObject({ installed: true, version: "oldtag", latestVersion: "newtag", updateAvailable: true });
  });
  it("installs the official Linux AppImage and records its release tag", async () => {
    const calls: string[] = [];
    await installXenia("linux", async (command) => { calls.push(command); return { stdout: "", stderr: "", code: 0 }; });
    expect(calls[0]).toMatch(/xenia_canary_linux\\\.AppImage/);
    expect(calls[0]).toContain("version.txt");
  });
  it("installs the official Windows archive into GameStore's managed directory", async () => {
    const calls: string[] = [];
    await installXenia("windows", async (command) => { calls.push(command); return { stdout: "", stderr: "", code: 0 }; });
    expect(calls[0]).toContain("xenia_canary_windows.7z");
    expect(calls[0]).toContain("GameStore\\Xenia Canary");
  });
});

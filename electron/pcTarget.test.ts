import { describe, expect, it } from "vitest";
import { detectOsFromProbe, localOs, type CommandResult } from "./pcTarget";

const fixedRun = (responses: Record<string, CommandResult>) => async (command: string) =>
  responses[command] ?? { stdout: "", stderr: `command not found: ${command}`, code: 127 };

describe("localOs", () => {
  it("maps process platforms to the OS identity the rest of the feature reasons about", () => {
    expect(localOs("win32")).toBe("windows");
    expect(localOs("darwin")).toBe("mac");
    expect(localOs("linux")).toBe("linux");
    // Anything else GameStore might run on (freebsd, etc.) reads as Linux-shaped, not Windows.
    expect(localOs("freebsd")).toBe("linux");
  });
});

describe("detectOsFromProbe", () => {
  it("identifies Linux from a successful uname -s", async () => {
    const os = await detectOsFromProbe(fixedRun({ "uname -s": { stdout: "Linux\n", stderr: "", code: 0 } }));
    expect(os).toBe("linux");
  });

  it("identifies macOS from a successful uname -s", async () => {
    const os = await detectOsFromProbe(fixedRun({ "uname -s": { stdout: "Darwin\n", stderr: "", code: 0 } }));
    expect(os).toBe("mac");
  });

  it("falls back to the Windows probe when uname fails, the real shape of a Win32-OpenSSH default shell", async () => {
    const os = await detectOsFromProbe(
      fixedRun({
        "uname -s": { stdout: "", stderr: "'uname' is not recognized as an internal or external command.", code: 1 },
        "cmd /c ver": { stdout: "\r\nMicrosoft Windows [Version 10.0.22631.4602]\r\n", stderr: "", code: 0 },
      }),
    );
    expect(os).toBe("windows");
  });

  it("treats a run() rejection the same as a nonzero exit and still falls through to the Windows probe", async () => {
    const os = await detectOsFromProbe(async (command) => {
      if (command === "uname -s") throw new Error("channel closed");
      if (command === "cmd /c ver") return { stdout: "Microsoft Windows [Version 10.0]", stderr: "", code: 0 };
      throw new Error(`unexpected command: ${command}`);
    });
    expect(os).toBe("windows");
  });

  it("throws rather than guessing when neither probe identifies a known OS", async () => {
    await expect(
      detectOsFromProbe(fixedRun({})),
    ).rejects.toThrow(/could not determine/i);
  });

  it("does not mistake a Linux uname failure that happens to succeed at nothing for Windows", async () => {
    // A flaky/partial shell response (code 0, empty output) must not silently pass as Linux.
    await expect(
      detectOsFromProbe(fixedRun({ "uname -s": { stdout: "", stderr: "", code: 0 } })),
    ).rejects.toThrow(/could not determine/i);
  });
});

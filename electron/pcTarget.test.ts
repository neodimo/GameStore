import { describe, expect, it } from "vitest";
import { classifyPcCandidates, detectOsFromProbe, localOs, type CommandResult } from "./pcTarget";

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

describe("classifyPcCandidates", () => {
  it("treats a machine with an ordinary hostname, or no hostname at all, as a likely PC", () => {
    const [byName, byAddressOnly] = classifyPcCandidates([
      { host: "192.168.1.42", hostname: "dimos-laptop" },
      { host: "192.168.1.50" },
    ]);
    expect(byName).toMatchObject({ confidence: "likely", reason: "Answers to dimos-laptop" });
    expect(byAddressOnly.confidence).toBe("likely");
    expect(byAddressOnly.reason).toMatch(/no network name found/i);
  });

  it("demotes a MiSTer so it never shows up in its own deploy-target scan", () => {
    const [candidate] = classifyPcCandidates([{ host: "192.168.1.96", hostname: "MiSTer.local" }]);
    expect(candidate.confidence).toBe("unknown");
    expect(candidate.reason).toMatch(/not a general-purpose pc/i);
  });

  it("demotes common embedded/IoT device hostnames (router, printer, NAS, smart TV)", () => {
    const results = classifyPcCandidates([
      { host: "192.168.1.1", hostname: "home-router" },
      { host: "192.168.1.20", hostname: "office-printer" },
      { host: "192.168.1.30", hostname: "synology-nas" },
      { host: "192.168.1.40", hostname: "living-room-smart-tv" },
    ]);
    expect(results.every((r) => r.confidence === "unknown")).toBe(true);
  });

  it("sorts likely PCs before unknown/demoted ones, ties broken by address", () => {
    const results = classifyPcCandidates([
      { host: "192.168.1.96", hostname: "MiSTer.local" },
      { host: "192.168.1.50", hostname: "bazzite-steam-pc" },
      { host: "192.168.1.10", hostname: "dimos-laptop" },
    ]);
    expect(results.map((r) => r.host)).toEqual(["192.168.1.10", "192.168.1.50", "192.168.1.96"]);
  });

  it("does not flag a hostname merely containing a denylisted word as a substring, e.g. 'laptop' containing 'ap'", () => {
    // Word-boundary matching: the access-point abbreviation "ap" must match only as its own word,
    // not as a substring of an unrelated word like "laptop".
    const results = classifyPcCandidates([{ host: "192.168.1.11", hostname: "dimos-laptop" }]);
    expect(results[0].confidence).toBe("likely");
  });
});

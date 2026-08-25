import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import { isIpv4, locateDevice, resolveAddress, withTimeout } from "./networkDiscovery";

/** A real listener, so reachability is genuinely exercised rather than stubbed. */
const listeners: net.Server[] = [];
const listen = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer((socket) => socket.end());
    listeners.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/**
 * Reverse DNS inside the sweep loop cost 31 seconds for four hosts, because an
 * address with no PTR record makes the resolver wait out its full retry budget.
 * A hostname label is worth having and never worth waiting for, so the budget
 * that fixed it is pinned here.
 */
describe("bounded lookups", () => {
  it("returns the answer when it arrives in time", async () => {
    await expect(withTimeout(Promise.resolve("quick"), 500, "gave up")).resolves.toBe("quick");
  });

  it("gives up rather than letting a slow lookup set the pace", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("eventually"), 5000).unref?.());
    const started = Date.now();
    await expect(withTimeout(slow, 100, "gave up")).resolves.toBe("gave up");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("treats a failed lookup as an absent one", async () => {
    await expect(withTimeout(Promise.reject(new Error("ENOTFOUND")), 500, "gave up")).resolves.toBe("gave up");
  });
});

describe("device location", () => {
  it("recognizes an address literal without asking the network", () => {
    expect(isIpv4("192.168.1.42")).toBe(true);
    expect(isIpv4("10.0.0.1")).toBe(true);
    expect(isIpv4("192.168.1.256")).toBe(false);
    expect(isIpv4("MiSTer.local")).toBe(false);
    expect(isIpv4("192.168.1")).toBe(false);
  });

  it("passes an address straight through instead of resolving it", async () => {
    await expect(resolveAddress("192.168.1.42")).resolves.toEqual(["192.168.1.42"]);
    await expect(resolveAddress("   ")).resolves.toEqual([]);
  });

  it("returns nothing for a name nothing answers to", async () => {
    await expect(resolveAddress("no-such-device-4b81b2.local", 250)).resolves.toEqual([]);
  });

  it("uses the configured address when it still answers", async () => {
    const port = await listen();
    await expect(
      locateDevice({ configuredHost: "127.0.0.1", port, accept: async () => true, scan: async () => [] }),
    ).resolves.toEqual({ host: "127.0.0.1", via: "configured" });
  });

  /**
   * Reachability is not identity. A home network usually has other machines
   * answering on SSH, and adopting one of them would write a game library onto
   * the wrong device, so a candidate the caller rejects must not be returned
   * even though it answered.
   */
  it("refuses a reachable host the caller will not vouch for", async () => {
    const port = await listen();
    const asked: string[] = [];
    await expect(
      locateDevice({
        configuredHost: "127.0.0.1",
        port,
        accept: async (host) => { asked.push(host); return false; },
        scan: async () => [],
      }),
    ).resolves.toBeNull();
    expect(asked).toEqual(["127.0.0.1"]);
  });

  it("falls back to the sweep and reports how the device was found", async () => {
    const port = await listen();
    const stages: string[] = [];
    await expect(
      locateDevice({
        configuredHost: "192.0.2.7", // TEST-NET-1, guaranteed not to answer
        deviceName: "no-such-device-4b81b2.local",
        port,
        accept: async () => true,
        onStage: (stage) => stages.push(stage),
        scan: async () => [{ host: "127.0.0.1", port, confidence: "unknown", reason: "test" }],
      }),
    ).resolves.toEqual({ host: "127.0.0.1", via: "scan" });
    expect(stages.some((stage) => /Asking the network for/.test(stage))).toBe(true);
    expect(stages.at(-1)).toMatch(/local network/i);
  });

  it("never probes the same address twice across the fallbacks", async () => {
    const port = await listen();
    const asked: string[] = [];
    await locateDevice({
      configuredHost: "127.0.0.1",
      port,
      accept: async (host) => { asked.push(host); return false; },
      scan: async () => [{ host: "127.0.0.1", port, confidence: "unknown", reason: "test" }],
    });
    expect(asked).toEqual(["127.0.0.1"]);
  });
});

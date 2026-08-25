import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";
import { resolveMdns } from "./mdns";

export type NetworkCandidate = {
  host: string;
  hostname?: string;
  port: number;
  confidence: "likely" | "unknown";
  reason: string;
};

/**
 * A MiSTer ships with the hostname `MiSTer` and runs avahi, so it answers to
 * `MiSTer.local` regardless of what address DHCP gave it today. That name is
 * the durable way to reach the device and the default this app configures.
 */
export const DEFAULT_DEVICE_NAME = "MiSTer.local";
export const KNOWN_DEVICE_NAMES = [
  "MiSTer.local",
  "MiSTerFPGA.local",
  "SuperStation.local",
  "superstation-one.local",
];

export const isIpv4 = (host: string) =>
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host) &&
  host.split(".").every((part) => Number(part) <= 255);

/**
 * A bounded TCP reachability probe.
 *
 * Everything that costs real time must be gated on this first. An address that
 * is simply gone — the common case once DHCP has moved the device — makes the
 * kernel retry SYNs for over a minute before it gives up, so handing a stale
 * address straight to an SSH client turns a lost device into a two-minute hang.
 */
export const isReachable = (host: string, port = 22, timeout = 450) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

const localPrefixes = () => {
  const prefixes = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const address of entries ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      const octets = address.address.split(".");
      if (octets.length === 4) prefixes.add(octets.slice(0, 3).join("."));
    }
  }
  return [...prefixes];
};

/**
 * Turns a configured host into the addresses worth trying, most specific first.
 *
 * A `.local` name goes to multicast DNS first because that is the only resolver
 * guaranteed to know it; the OS resolver is still consulted, since Windows and
 * macOS answer `.local` natively and may have a cached result. A bare name is
 * tried both as written and as `<name>.local`, which is what makes an existing
 * install configured as plain `MiSTer` start working again.
 */
/**
 * Runs `work` on a time budget, treating a slow or failed answer as `fallback`.
 * Discovery is full of lookups that are worth having but never worth waiting
 * for, and this is what keeps one of them from dominating the whole operation.
 */
export const withTimeout = <T,>(work: Promise<T>, ms: number, fallback: T) =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });

/** Every name the OS resolver might know, asked in parallel and time-boxed. */
const lookupAll = async (names: string[], timeoutMs: number) => {
  const results = await Promise.all(
    names.map((name) =>
      withTimeout(
        dns.lookup(name, { family: 4, all: true }).then((entries) => entries.map((entry) => entry.address)),
        timeoutMs,
        [] as string[],
      ),
    ),
  );
  return results.flat();
};

const localName = (host: string) => (/\.local$/i.test(host) ? host : `${host}.local`);

export async function resolveAddress(host: string, timeoutMs = 1200): Promise<string[]> {
  const trimmed = host.trim();
  if (!trimmed) return [];
  if (isIpv4(trimmed)) return [trimmed];
  const names = [...new Set([trimmed, localName(trimmed)])];
  const [multicast, looked] = await Promise.all([
    resolveMdns(names.filter((name) => /\.local$/i.test(name)), timeoutMs),
    lookupAll(names, timeoutMs),
  ]);
  return [...new Set([...multicast.values(), ...looked])];
}

export type LocatedDevice = { host: string; via: "configured" | "name" | "scan" };

/**
 * Finds the configured device again after its address changed.
 *
 * `accept` is the caller's identity check — reachability alone is not enough,
 * because a home network usually has other machines listening on SSH and
 * writing a game library onto the wrong one would be a genuinely bad outcome.
 * Only a candidate the caller vouches for is returned.
 */
export async function locateDevice(options: {
  configuredHost?: string;
  deviceName?: string;
  port?: number;
  accept: (host: string) => Promise<boolean>;
  onStage?: (stage: string) => void;
  /** Last-resort sweep; injectable so a caller can report its progress. */
  scan?: () => Promise<NetworkCandidate[]>;
}): Promise<LocatedDevice | null> {
  const port = options.port || 22;
  const tried = new Set<string>();
  const attempt = async (host: string, via: LocatedDevice["via"]) => {
    if (!host || tried.has(host)) return null;
    tried.add(host);
    if (!(await isReachable(host, port))) return null;
    return (await options.accept(host)) ? ({ host, via } as LocatedDevice) : null;
  };

  if (options.configuredHost && isIpv4(options.configuredHost)) {
    options.onStage?.(`Trying ${options.configuredHost}…`);
    const direct = await attempt(options.configuredHost, "configured");
    if (direct) return direct;
  }

  // Every candidate name goes out in one multicast round trip rather than one
  // query each: asking serially made simply finding the device take seconds.
  const names = [...new Set([
    ...(options.deviceName ? [options.deviceName, localName(options.deviceName)] : []),
    ...(options.configuredHost && !isIpv4(options.configuredHost)
      ? [options.configuredHost, localName(options.configuredHost)]
      : []),
    ...KNOWN_DEVICE_NAMES,
  ])];
  options.onStage?.(`Asking the network for ${names[0]}…`);
  const [multicast, looked] = await Promise.all([
    resolveMdns(names.filter((name) => /\.local$/i.test(name))),
    lookupAll(names, 1200),
  ]);
  for (const address of [...new Set([...multicast.values(), ...looked])]) {
    const byName = await attempt(address, "name");
    if (byName) return byName;
  }

  options.onStage?.("Checking the local network…");
  // Vetting swept candidates one at a time meant paying a full SSH handshake
  // timeout per machine that was not the device, which on an ordinary home
  // network turned this fallback into a minute of apparent hang. They are
  // checked concurrently and the best-ranked success wins, so the answer is
  // still deterministic.
  const candidates = (await (options.scan ?? discoverFpgaDevices)()).filter(
    (candidate) => !tried.has(candidate.host),
  );
  const outcomes = await Promise.all(
    candidates.map(async (candidate) => (await attempt(candidate.host, "scan")) ?? null),
  );
  return outcomes.find(Boolean) ?? null;
}

export async function discoverFpgaDevices(
  progress?: (done: number, total: number) => void,
): Promise<NetworkCandidate[]> {
  // Named devices are asked for first and cost one multicast round trip, so a
  // MiSTer that answers to its own name appears immediately rather than after
  // a 254-address sweep.
  const named = new Map<string, string>();
  for (const [name, address] of await resolveMdns(KNOWN_DEVICE_NAMES)) named.set(address, name);

  const hosts = new Set<string>(named.keys());
  for (const prefix of localPrefixes())
    for (let last = 1; last < 255; last++) hosts.add(`${prefix}.${last}`);
  const list = [...hosts];
  const live: string[] = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const host = list[cursor++];
      if (await isReachable(host)) live.push(host);
      done++;
      progress?.(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));

  // Reverse DNS is a cosmetic label, and an address with no PTR record makes
  // the resolver wait out its full retry budget: doing these inside the sweep
  // cost 31 seconds for four hosts and dominated the entire scan. They are
  // resolved together, after the sweep, on a budget that treats a slow answer
  // as no answer. Running them concurrently makes that budget a ceiling on the
  // whole step rather than a cost paid once per host.
  const labels = new Map<string, string>();
  await Promise.all(
    live.map(async (host) => {
      const advertised = named.get(host);
      if (advertised) return labels.set(host, advertised);
      const reversed = await withTimeout(dns.reverse(host), 2000, [] as string[]);
      if (reversed[0]) labels.set(host, reversed[0]);
    }),
  );

  return live
    .map((host) => {
      const hostname = labels.get(host);
      const advertised = named.get(host);
      const likely = !!advertised || /mister|superstation/.test(`${host} ${hostname ?? ""}`.toLowerCase());
      return {
        host,
        hostname,
        port: 22,
        confidence: (likely ? "likely" : "unknown") as NetworkCandidate["confidence"],
        reason: advertised
          ? `Answers to ${advertised} on this network`
          : likely
            ? "MiSTer/SuperStation hostname with SSH available"
            : "SSH/SFTP service available; verify with credentials",
      };
    })
    .sort((a, b) =>
      a.confidence === b.confidence
        ? a.host.localeCompare(b.host, undefined, { numeric: true })
        : a.confidence === "likely"
          ? -1
          : 1,
    );
}

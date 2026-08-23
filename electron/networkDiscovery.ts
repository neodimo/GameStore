import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";

export type NetworkCandidate = {
  host: string;
  hostname?: string;
  port: number;
  confidence: "likely" | "unknown";
  reason: string;
};

const connect = (host: string, port = 22, timeout = 450) =>
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

export async function discoverFpgaDevices(
  progress?: (done: number, total: number) => void,
): Promise<NetworkCandidate[]> {
  const hosts = new Set<string>(["MiSTer", "mister", "superstation", "superstation-one"]);
  for (const prefix of localPrefixes())
    for (let last = 1; last < 255; last++) hosts.add(`${prefix}.${last}`);
  const list = [...hosts];
  const found: NetworkCandidate[] = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const host = list[cursor++];
      if (await connect(host)) {
        let hostname = "";
        try {
          hostname = (await dns.reverse(host))[0] ?? "";
        } catch {
          /* Reverse DNS is optional. */
        }
        const label = `${host} ${hostname}`.toLowerCase();
        const likely = /mister|superstation/.test(label);
        found.push({
          host,
          hostname: hostname || undefined,
          port: 22,
          confidence: likely ? "likely" : "unknown",
          reason: likely
            ? "MiSTer/SuperStation hostname with SSH available"
            : "SSH/SFTP service available; verify with credentials",
        });
      }
      done++;
      progress?.(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));
  return found.sort((a, b) =>
    a.confidence === b.confidence
      ? a.host.localeCompare(b.host, undefined, { numeric: true })
      : a.confidence === "likely"
        ? -1
        : 1,
  );
}

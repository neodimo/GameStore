import dgram from "node:dgram";
import os from "node:os";

/**
 * A one-shot mDNS resolver, just large enough to turn `MiSTer.local` into an
 * address.
 *
 * A MiSTer runs avahi and answers to its hostname, so the name is a far more
 * durable way to reach it than the address DHCP happened to hand out. Node's
 * own resolver cannot be relied on for that: Windows 10 and later resolve
 * `.local` natively, macOS has Bonjour, but a Linux box only resolves it when
 * `nss-mdns` is installed and wired into `/etc/nsswitch.conf`. Asking the
 * network directly removes that dependency.
 *
 * Queries set the unicast-response bit (RFC 6762 §5.4) and bind an ephemeral
 * port, so this never contends for port 5353 with a system avahi-daemon.
 */
const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;
const TYPE_A = 1;
const CLASS_IN = 1;
/** Top bit of QCLASS asks the responder to reply directly to our port. */
const UNICAST_RESPONSE = 0x8000;

export const encodeQuery = (name: string, id = 0) => {
  const labels = name.replace(/\.$/, "").split(".");
  const question = Buffer.concat([
    ...labels.map((label) => {
      const encoded = Buffer.from(label, "utf8");
      if (encoded.length > 63) throw new Error(`mDNS label too long: ${label}`);
      return Buffer.concat([Buffer.from([encoded.length]), encoded]);
    }),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(1, 4); // one question
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(TYPE_A, 0);
  tail.writeUInt16BE(CLASS_IN | UNICAST_RESPONSE, 2);
  return Buffer.concat([header, question, tail]);
};

/**
 * Reads a possibly compressed domain name. A pointer's offset is followed once
 * into the packet; `guard` stops a self-referential pointer from looping.
 */
const readName = (packet: Buffer, start: number) => {
  const labels: string[] = [];
  let at = start;
  let after = 0;
  let guard = 0;
  for (;;) {
    if (at >= packet.length || (guard += 1) > 128) return { name: labels.join("."), next: after || at };
    const length = packet[at];
    if (length === 0) return { name: labels.join("."), next: after || at + 1 };
    if ((length & 0xc0) === 0xc0) {
      if (at + 1 >= packet.length) return { name: labels.join("."), next: packet.length };
      if (!after) after = at + 2;
      at = ((length & 0x3f) << 8) | packet[at + 1];
      continue;
    }
    labels.push(packet.subarray(at + 1, at + 1 + length).toString("utf8"));
    at += 1 + length;
  }
};

export const decodeAnswers = (packet: Buffer) => {
  const results: { name: string; address: string }[] = [];
  if (packet.length < 12) return results;
  const questions = packet.readUInt16BE(4);
  const answers = packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10);
  let at = 12;
  for (let index = 0; index < questions; index += 1) {
    at = readName(packet, at).next + 4;
  }
  for (let index = 0; index < answers && at + 10 <= packet.length; index += 1) {
    const { name, next } = readName(packet, at);
    at = next;
    const type = packet.readUInt16BE(at);
    const length = packet.readUInt16BE(at + 8);
    at += 10;
    if (type === TYPE_A && length === 4 && at + 4 <= packet.length)
      results.push({ name: name.toLowerCase(), address: [...packet.subarray(at, at + 4)].join(".") });
    at += length;
  }
  return results;
};

const localAddresses = () =>
  Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

/**
 * Asks the local network for the A records of `names`, returning what answered
 * before `timeoutMs`. Never rejects: an unreachable multicast group, a firewall
 * or a host with no network is an empty result, not a failure the caller has to
 * handle separately.
 */
export const resolveMdns = (names: string[], timeoutMs = 1200) =>
  new Promise<Map<string, string>>((resolve) => {
    const wanted = new Map(names.map((name) => [name.replace(/\.$/, "").toLowerCase(), name]));
    const found = new Map<string, string>();
    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      resolve(found);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(found);
    };
    const timer = setTimeout(finish, timeoutMs);

    socket.on("error", finish);
    socket.on("message", (message) => {
      for (const answer of decodeAnswers(message)) {
        const original = wanted.get(answer.name);
        if (original && !found.has(original)) found.set(original, answer.address);
      }
      if (found.size === wanted.size) finish();
    });
    socket.bind(0, () => {
      try {
        socket.setMulticastTTL(255);
        // Sending from every interface matters on a machine with more than one
        // network; the default route is not necessarily the one the MiSTer is on.
        for (const address of localAddresses()) {
          try { socket.setMulticastInterface(address); } catch { continue; }
          for (const name of wanted.values()) socket.send(encodeQuery(name), MDNS_PORT, MDNS_ADDRESS);
        }
      } catch {
        finish();
      }
    });
  });

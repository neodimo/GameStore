/**
 * Executing on a PC deploy target, local or remote.
 *
 * The local case needs nothing clever: GameStore already knows its own OS
 * (`process.platform`), so a command just runs in the local shell. The remote
 * case is the real problem DiMo raised — before GameStore can install
 * RetroArch or write a Steam shortcut on another machine, it has to know
 * whether that machine is Windows or Linux, because the install method, the
 * shell, and the Steam config path all differ by OS. Nothing on the wire
 * announces that up front, so it has to be probed.
 *
 * `detectOsFromProbe` is kept pure and injected with a `run` function so it
 * can be tested against fixed command output instead of a real shell or SSH
 * session; `connectPcSsh` and `execLocal` are the two thin, untested edges
 * that actually touch a process or a socket.
 */
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { Client } from "ssh2";

export type PcOs = "windows" | "linux" | "mac";
export type PcTargetKind = "local" | "remote";

export type CommandResult = { stdout: string; stderr: string; code: number };
export type RunCommand = (command: string) => Promise<CommandResult>;

/** `process.platform` -> the OS identity the rest of this feature reasons about. */
export const localOs = (platform: NodeJS.Platform): PcOs =>
  platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";

/**
 * Identifies a connected shell's OS from what it actually does, not from a
 * banner or a guess. `uname -s` is the universal Unix answer; a Windows SSH
 * server's default shell (`cmd.exe`, what Win32-OpenSSH spawns unless the
 * user reconfigured it) does not recognize that command at all, so a failure
 * there is itself the signal to try a command only `cmd.exe` understands.
 * Two real probes rather than one guess is what makes this safe to act on —
 * installing the wrong OS's RetroArch build is a much worse failure than a
 * slower detection.
 */
export const detectOsFromProbe = async (run: RunCommand): Promise<PcOs> => {
  const uname = await run("uname -s").catch(() => ({ stdout: "", stderr: "", code: 1 }));
  const unameOut = uname.stdout.trim();
  if (uname.code === 0 && /^linux$/i.test(unameOut)) return "linux";
  if (uname.code === 0 && /^darwin$/i.test(unameOut)) return "mac";

  const ver = await run("cmd /c ver").catch(() => ({ stdout: "", stderr: "", code: 1 }));
  if (ver.code === 0 && /windows/i.test(ver.stdout)) return "windows";

  throw new Error("Could not determine whether this machine runs Windows or Linux.");
};

/** Runs one command in the local shell, on whatever OS GameStore itself is running on. */
export const execLocal = (command: string): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ stdout, stderr, code: typeof error?.code === "number" ? error.code : 0 });
    });
  });

/** Runs one command over an established SSH connection. */
export const execRemote = (client: Client, command: string): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      stream.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      stream.on("close", (code: number | null) => resolve({ stdout, stderr, code: code ?? 0 }));
      stream.on("error", reject);
    });
  });

/**
 * Opens one SSH connection, capturing the host key on the way in — the same
 * identity contract `openSftp` uses for MiSTer, so a PC target is trusted the
 * same way: `expectKey` set means a mismatch aborts before authentication,
 * and a bare address is never enough on its own to adopt a machine as the
 * configured target.
 */
export const connectPcSsh = (
  host: string,
  port: number,
  username: string,
  password: string | undefined,
  expectKey?: string,
  readyTimeout = 12000,
): Promise<{ client: Client; hostKey: string }> =>
  new Promise((resolve, reject) => {
    let hostKey = "";
    const client = new Client();
    client
      .on("ready", () => resolve({ client, hostKey }))
      .on("error", reject)
      .connect({
        host,
        port,
        username,
        password,
        readyTimeout,
        hostVerifier: (key: Buffer) => {
          hostKey = createHash("sha256").update(key).digest("base64");
          return !expectKey || hostKey === expectKey;
        },
      });
  });

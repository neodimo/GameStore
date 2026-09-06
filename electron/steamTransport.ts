import type { Client, SFTPWrapper } from "ssh2";
import type { PcOs } from "./pcTarget";
import type { SteamFileTransport } from "./steamDeploy";

/**
 * SFTP implementation of the same contract.
 *
 * `mkdir` over SFTP has no portable recursive mode, so directories are created
 * one segment at a time and an already-exists error is the expected outcome
 * rather than a failure.
 */
export const remoteSteamTransport = (client: Client, os: PcOs): SteamFileTransport & { dispose(): Promise<void> } => {
  // One lazy promise also shares an in-flight open across concurrent operations.
  let channel: Promise<SFTPWrapper> | undefined;
  let disposed = false;
  const sftp = () => {
    if (disposed) return Promise.reject(new Error("Steam file transport is closed."));
    return channel ??= new Promise<SFTPWrapper>((resolve, reject) =>
      client.sftp((error, wrapper) => (error ? reject(error) : resolve(wrapper))),
    );
  };
  const separator = os === "windows" ? "\\" : "/";
  const parentOf = (file: string) => file.slice(0, file.lastIndexOf(separator)) || separator;
  const mkdirp = async (directory: string) => {
    const wrapper = await sftp();
    const parts = directory.split(separator);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}${separator}${part}` : part || separator;
      if (!part) continue;
      await new Promise<void>((resolve) => wrapper.mkdir(current, () => resolve()));
    }
  };
  return {
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const wrapper = await channel?.catch(() => undefined);
      wrapper?.end();
    },
    mkdirp,
    readFile: async (remote) => {
      const wrapper = await sftp();
      return new Promise((resolve, reject) =>
        wrapper.readFile(remote, (error, data) => {
          if (error && (error as Error & { code?: number }).code !== 2) reject(error);
          else resolve(error ? null : (data as Buffer));
        }),
      );
    },
    writeFile: async (remote, data) => {
      await mkdirp(parentOf(remote));
      const wrapper = await sftp();
      await new Promise<void>((resolve, reject) =>
        wrapper.writeFile(remote, data, (error) => (error ? reject(error) : resolve())),
      );
    },
    upload: async (localPath, remote) => {
      await mkdirp(parentOf(remote));
      const wrapper = await sftp();
      await new Promise<void>((resolve, reject) =>
        wrapper.fastPut(localPath, remote, (error) => (error ? reject(error) : resolve())),
      );
    },
  };
};


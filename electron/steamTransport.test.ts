import { describe, expect, it, vi } from 'vitest';
import type { Client, SFTPWrapper } from 'ssh2';
import { remoteSteamTransport } from './steamTransport';

function fixture() {
  const files = new Map<string, Buffer>();
  const wrapper = {
    mkdir: vi.fn((_path, callback) => callback(null)),
    readFile: vi.fn((path, callback) => files.has(path)
      ? callback(null, files.get(path)) : callback(Object.assign(new Error('Missing'), { code: 2 }))),
    writeFile: vi.fn((path, data, callback) => { files.set(path, data); callback(null); }),
    fastPut: vi.fn((_local, remote, callback) => { files.set(remote, Buffer.from('uploaded')); callback(null); }),
    end: vi.fn(),
  };
  let opens = 0;
  const client = { sftp: vi.fn((callback) => {
    // Model the server cap that exposed the leak, with asynchronous opening.
    opens++;
    queueMicrotask(() => opens > 10
      ? callback(new Error('(SSH) Channel open failure: open failed'))
      : callback(null, wrapper));
  }) };
  return { files, wrapper, client, transport: remoteSteamTransport(client as unknown as Client, 'linux') };
}

describe('Steam SFTP channel lifetime', () => {
  it('handles a full sequence of many reads, uploads, backups and writes with one channel', async () => {
    const { transport, client, wrapper, files } = fixture();
    for (let index = 0; index < 30; index++) {
      await transport.mkdirp('/games/PS1');
      await transport.upload('/local/game.bin', `/games/PS1/${index}.bin`);
      await transport.writeFile(`/config/${index}.bak`, Buffer.from('backup'));
      expect(await transport.readFile(`/config/${index}.bak`)).toEqual(Buffer.from('backup'));
    }
    expect(files.size).toBe(60);
    expect(client.sftp).toHaveBeenCalledTimes(1);
    await transport.dispose();
    await transport.dispose();
    expect(wrapper.end).toHaveBeenCalledTimes(1);
    await expect(transport.readFile('/anything')).rejects.toThrow(/closed/);
  });
  it('shares an in-flight channel opening between concurrent operations', async () => {
    const { transport, client } = fixture();
    await Promise.all(Array.from({ length: 20 }, () => transport.readFile('/missing')));
    expect(client.sftp).toHaveBeenCalledTimes(1);
    await transport.dispose();
  });
  it('does not open a channel merely to dispose an unused transport', async () => {
    const { transport, client } = fixture();
    await transport.dispose();
    expect(client.sftp).not.toHaveBeenCalled();
  });
  it('propagates open errors and permits cleanup without masking them', async () => {
    const error = new Error('SFTP denied');
    const client = { sftp: vi.fn((callback) => callback(error)) };
    const transport = remoteSteamTransport(client as unknown as Client, 'linux');
    await expect(transport.readFile('/config')).rejects.toBe(error);
    await expect(transport.readFile('/config')).rejects.toBe(error);
    expect(client.sftp).toHaveBeenCalledTimes(1);
    await expect(transport.dispose()).resolves.toBeUndefined();
  });
  it('propagates permission errors instead of treating an unreadable library as absent', async () => {
    const { transport, wrapper } = fixture();
    const error = Object.assign(new Error('Permission denied'), { code: 3 });
    wrapper.readFile.mockImplementation((_path, callback) => callback(error));
    await expect(transport.readFile('/config')).rejects.toBe(error);
    await transport.dispose();
    expect(wrapper.end).toHaveBeenCalledTimes(1);
  });
  it('closes a channel that finishes opening during disposal', async () => {
    let opened: ((error: Error | undefined, wrapper: SFTPWrapper) => void) | undefined;
    const { wrapper } = fixture();
    const client = { sftp: (callback: typeof opened) => { opened = callback; } };
    const transport = remoteSteamTransport(client as unknown as Client, 'linux');
    const read = transport.readFile('/missing');
    const dispose = transport.dispose();
    opened!(undefined, wrapper as unknown as SFTPWrapper);
    await read;
    await dispose;
    expect(wrapper.end).toHaveBeenCalledTimes(1);
  });
});

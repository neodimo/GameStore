import { describe, expect, it, vi } from 'vitest';
import { mergeCollection, platformCollection, prepareCollection } from './steamCollections';
import type { SteamFileTransport } from './steamDeploy';

const now = new Date('2026-09-05T12:00:00Z');
const parse = (data: Buffer) => JSON.parse(data.toString());
describe('Steam console collections', () => {
  it.each([['PS1', 'PS1'], ['N64', 'N64'], ['SAT', 'Saturn']] as const)('maps %s to %s', (platform, name) => {
    expect(platformCollection(platform)).toBe(name);
    const rows = parse(mergeCollection(Buffer.from('[]'), name, 3000000000, now));
    expect(JSON.parse(rows[0][1].value)).toMatchObject({ name, added: [3000000000], removed: [] });
  });
  it('reuses a named collection and preserves unrelated records, custom data and membership', () => {
    const other = ['user-collections.other', { value: JSON.stringify({ id: 'other', name: 'Favorites', added: [12] }) }];
    const input = Buffer.from(JSON.stringify([['preferences', { value: 'keep' }], other,
      ['user-collections.existing', { version: '1', extra: true, value: JSON.stringify({ id: 'existing', name: 'ps1', added: [42], removed: [99, 7], custom: 'keep' }) }]]));
    const once = mergeCollection(input, 'PS1', 99, now);
    const rows = parse(mergeCollection(once, 'PS1', 99, now));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(['preferences', { value: 'keep' }]);
    expect(rows[1]).toEqual(other);
    expect(rows[2][1].extra).toBe(true);
    expect(JSON.parse(rows[2][1].value)).toEqual({ id: 'existing', name: 'ps1', added: [42, 99], removed: [7], custom: 'keep' });
  });
  it('rejects corrupt collection storage instead of replacing it', () => {
    expect(() => mergeCollection(Buffer.from('{}'), 'PS1', 1, now)).toThrow();
    expect(() => mergeCollection(Buffer.from('[["user-collections.x",{"value":"bad"}]]'), 'PS1', 1, now)).toThrow();
  });
  it('backs up the selected namespace and detects concurrent writes', async () => {
    const original = Buffer.from('[]');
    const files = new Map([
      ['/cloud/cloud-storage-namespaces.json', Buffer.from('[[1,"2"],[3,"10"]]')],
      ['/cloud/cloud-storage-namespace-3.json', original],
    ]);
    const transport: SteamFileTransport = {
      readFile: async (file) => files.get(file) ?? null,
      writeFile: vi.fn(async (file, data) => { files.set(file, data); }),
      mkdirp: async () => {}, upload: async () => {},
    };
    const plan = await prepareCollection('/cloud', '/', 'PS1', 99, transport, now);
    expect(plan.file).toBe('/cloud/cloud-storage-namespace-3.json');
    const backup = await plan.commit();
    expect(files.get(backup)).toEqual(original);
    expect(JSON.parse(parse(files.get(plan.file)!)[0][1].value).added).toEqual([99]);
    await expect(plan.commit()).rejects.toThrow(/changed during/);
    expect(transport.writeFile).toHaveBeenCalledTimes(2);
  });
  it('refuses uninitialized storage without writes', async () => {
    const transport = { readFile: vi.fn().mockResolvedValue(null), writeFile: vi.fn(), mkdirp: vi.fn(), upload: vi.fn() };
    await expect(prepareCollection('C:\\config\\cloudstorage', '\\', 'PS1', 1, transport, now)).rejects.toThrow(/not initialized/);
    expect(transport.writeFile).not.toHaveBeenCalled();
  });
});

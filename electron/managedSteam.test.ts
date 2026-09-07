import { describe, it, expect } from 'vitest';
import { readRegistry, saveRegistry, reconcile, legacyCandidates, editManagedShortcut, upsertGame, shortcutEntries, type ManagedGame } from './managedSteam';
import { decodeBinaryVdf } from './steamVdf';
import { mergeCollection } from './steamCollections';
import type { SteamFileTransport } from './steamDeploy';
const game: ManagedGame = { appId: 3000000000, title: 'Example', kind: 'emulated', platform: 'PS1', coreId: 'swanstation',
  location: '/home/test/GameStore/roms/PS1/example.chd', collection: 'PS1', installedAt: '2026-09-06', updatedAt: '2026-09-06', deployment: 'ready',
  shortcut: { appid: 3000000000, AppName: 'Example', Exe: '"/usr/bin/flatpak"', LaunchOptions: '-L "core" "rom" --fullscreen', tags: { '0': 'Favorites' } } };
const registry = { schema: 1 as const, games: [game] };
describe('Managed Steam inventory', () => {
  it('distinguishes live, removed, partial and colliding entries', () => {
    expect(reconcile(registry, [game.shortcut])[0].status).toBe('in-steam');
    expect(reconcile(registry, [])[0].status).toBe('removed');
    expect(reconcile({ schema: 1, games: [{ ...game, deployment: 'pending' }] }, [game.shortcut])[0].status).toBe('partial');
    expect(reconcile(registry, [{ ...game.shortcut, Exe: 'other' }])[0].status).toBe('conflict');
    expect(reconcile(registry, [game.shortcut, game.shortcut])[0].status).toBe('conflict');
  });
  it('updates an installation without duplicating or losing its original date', () => {
    const updated = upsertGame(registry, { ...game, installedAt: 'later', updatedAt: 'later', coreId: 'new-core' });
    expect(updated.games).toHaveLength(1);
    expect(updated.games[0]).toMatchObject({ installedAt: game.installedAt, updatedAt: 'later', coreId: 'new-core' });
  });
  it('removes/restores only its entry and preserves unrelated data and user tags', () => {
    const other = { appid: 123, Exe: 'other', Custom: 'preserved' };
    const removed = editManagedShortcut([game.shortcut, other], game, 'remove');
    expect(shortcutEntries(removed)).toEqual([other]);
    const restored = shortcutEntries(editManagedShortcut([other], game, 'restore'));
    expect(restored[0]).toEqual(other);
    expect(restored[1].tags).toEqual({ '0': 'Favorites' });
    expect(shortcutEntries(editManagedShortcut(restored, game, 'restore'))).toHaveLength(2);
  });
  it('refuses to edit a conflicting ID', () => {
    expect(() => editManagedShortcut([{ ...game.shortcut, Exe: 'different' }], game, 'remove')).toThrow(/conflicts/);
  });
  it('discovers only target-home GameStore paths and excludes already tracked entries', () => {
    const emulated = { ...game.shortcut, LaunchOptions: '-L "/core/swanstation_libretro.so" "/home/test/.var/app/org.libretro.RetroArch/config/retroarch/gamestore/PS1/example.chd" --fullscreen' };
    const port = { appid: 4, AppName: 'Port', Exe: '"/home/test/.local/share/GameStore/ports/zelda/run"' };
    const unrelated = { appid: 5, AppName: 'Other', Exe: '"/home/other/.local/share/GameStore/ports/zelda/run"' };
    expect(legacyCandidates([emulated, port, unrelated], { schema: 1, games: [] }, '/home/test').map((g) => g.kind)).toEqual(['emulated', 'port']);
    expect(legacyCandidates([emulated], registry, '/home/test')).toEqual([]);
  });
  it('finds Windows deployments without adopting arbitrary non-Steam entries', () => {
    const entry = { appid: 6, AppName: 'Windows port', Exe: '"C:\\Users\\test\\GameStore\\ports\\example\\game.exe"' };
    expect(legacyCandidates([entry], { schema: 1, games: [] }, 'C:\\Users\\test')[0].portId).toBe('example');
    expect(legacyCandidates([{ ...entry, Exe: '"C:\\Games\\Other.exe"' }], { schema: 1, games: [] }, 'C:\\Users\\test')).toEqual([]);
  });
  it('backs up registry writes and refuses malformed data', async () => {
    const files = new Map<string, Buffer>();
    const transport: SteamFileTransport = { readFile: async (p) => files.get(p) ?? null,
      writeFile: async (p, data) => { files.set(p, data); }, mkdirp: async () => {}, upload: async () => {} };
    expect(await readRegistry('/record', transport)).toEqual({ schema: 1, games: [] });
    await saveRegistry('/record', registry, transport);
    await saveRegistry('/record', registry, transport);
    expect([...files.keys()].filter((p) => p.endsWith('.bak'))).toHaveLength(1);
    expect((await readRegistry('/record', transport)).games[0].coreId).toBe('swanstation');
    files.set('/record', Buffer.from('{}'));
    await expect(readRegistry('/record', transport)).rejects.toThrow(/invalid/);
  });
  it('removes just the requested membership while retaining collection and others', () => {
    const original = Buffer.from(JSON.stringify([['user-collections.ps1', { value: JSON.stringify({ id: 'ps1', name: 'PS1', added: [1, 2], removed: [], custom: true }) }], ['other', { value: 'keep' }]]));
    const removed = JSON.parse(mergeCollection(original, 'PS1', 1, new Date(), 'remove').toString());
    expect(JSON.parse(removed[0][1].value)).toMatchObject({ added: [2], removed: [1], custom: true });
    expect(removed[1]).toEqual(['other', { value: 'keep' }]);
    const restored = JSON.parse(mergeCollection(Buffer.from(JSON.stringify(removed)), 'PS1', 1, new Date()).toString());
    expect(JSON.parse(restored[0][1].value).added).toEqual([2, 1]);
  });
});

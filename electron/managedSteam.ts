import { randomUUID } from 'node:crypto';
import { decodeBinaryVdf, encodeBinaryVdf, unsignedAppId, type VdfMap } from './steamVdf';
import type { SteamFileTransport } from './steamDeploy';

export type ManagedGame = {
  appId: number; title: string; kind: 'emulated' | 'recomp' | 'decomp' | 'port';
  platform: string; coreId?: string; portId?: string; version?: string; projectUrl?: string;
  location: string; collection: string; installedAt: string; updatedAt: string;
  deployment: 'pending' | 'ready'; shortcut: VdfMap;
};
export type ManagedView = Omit<ManagedGame, 'shortcut'> & {
  status: 'in-steam' | 'removed' | 'conflict' | 'partial';
};
export type Registry = { schema: 1; games: ManagedGame[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export async function readRegistry(file: string, transport: SteamFileTransport): Promise<Registry> {
  const bytes = await transport.readFile(file);
  if (!bytes) return { schema: 1, games: [] };
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!record(value) || value.schema !== 1 || !Array.isArray(value.games) || !value.games.every((g) =>
    record(g) && Number.isInteger(g.appId) && typeof g.title === 'string' &&
    ['emulated', 'recomp', 'decomp', 'port'].includes(String(g.kind)) &&
    ['pending', 'ready'].includes(String(g.deployment)) &&
    ['platform', 'location', 'collection', 'installedAt', 'updatedAt'].every((key) => typeof g[key] === 'string') &&
    record(g.shortcut) && typeof g.shortcut.Exe === 'string'))
    throw new Error('GameStore management record is invalid. No library changes were made.');
  const data = value as Registry;
  if (new Set(data.games.map((g) => g.appId)).size !== data.games.length) throw new Error('Duplicate managed game IDs.');
  return data;
}
export async function saveRegistry(file: string, data: Registry, transport: SteamFileTransport) {
  const previous = await transport.readFile(file);
  if (previous) await transport.writeFile(`${file}.${randomUUID()}.bak`, previous);
  await transport.writeFile(file, Buffer.from(JSON.stringify(data, null, 2)));
}
export function upsertGame(data: Registry, game: ManagedGame): Registry {
  const previous = data.games.find((g) => g.appId === game.appId);
  return { schema: 1, games: [...data.games.filter((g) => g.appId !== game.appId), { ...game, installedAt: previous?.installedAt ?? game.installedAt }] };
}
export function shortcutEntries(bytes: Buffer | null): VdfMap[] {
  if (!bytes) return [];
  const decoded = decodeBinaryVdf(bytes);
  if (decoded.name !== 'shortcuts') throw new Error('Unexpected Steam shortcut document.');
  return Object.values(decoded.value).filter((v): v is VdfMap => record(v));
}
export function reconcile(data: Registry, entries: VdfMap[]): ManagedView[] {
  return data.games.map(({ shortcut, ...game }) => {
    const matches = entries.filter((e) => typeof e.appid === 'number' && unsignedAppId(e.appid) === game.appId);
    const conflict = matches.length > 1 || (matches.length === 1 && matches[0].Exe !== shortcut.Exe);
    return { ...game, status: conflict ? 'conflict' : game.deployment === 'pending' ? 'partial' : !matches.length ? 'removed' : 'in-steam' };
  });
}
/** Only exact paths below GameStore's own deployment roots are offered for adoption. */
export function legacyCandidates(entries: VdfMap[], data: Registry, home: string): ManagedGame[] {
  const normalized = (s: string) => s.replace(/\\/g, '/');
  const base = normalized(home).replace(/\/$/, '');
  return entries.flatMap((e) => {
    if (typeof e.appid !== 'number' || typeof e.AppName !== 'string' || typeof e.Exe !== 'string') return [];
    const appId = unsignedAppId(e.appid);
    if (data.games.some((g) => g.appId === appId)) return [];
    const exe = normalized(e.Exe.replace(/^"|"$/g, ''));
    const args = typeof e.LaunchOptions === 'string' ? normalized(e.LaunchOptions) : '';
    const roots = [`${base}/GameStore/ports/`, `${base}/.local/share/GameStore/ports/`];
    const portRoot = roots.find((root) => exe.startsWith(root));
    const quotedPaths = [...args.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const rom = quotedPaths.find((p) => p.startsWith(`${base}/GameStore/roms/`) || p.startsWith(`${base}/.var/app/org.libretro.RetroArch/config/retroarch/gamestore/`));
    if (!portRoot && !rom) return [];
    if (exe.includes('/../') || rom?.includes('/../')) return [];
    const platform = rom ? rom.split('/').slice(-2)[0] : 'Unknown';
    if (!portRoot && !['PS1', 'N64', 'SAT'].includes(platform)) return [];
    const core = args.match(/([^/" ]+)_libretro\.(so|dll)/)?.[1];
    return [{ appId, title: e.AppName, kind: portRoot ? 'port' as const : 'emulated' as const,
      platform, coreId: core, portId: portRoot ? exe.slice(portRoot.length).split('/')[0] : undefined,
      location: portRoot ? exe.slice(0, exe.lastIndexOf('/')) : rom!,
      collection: portRoot ? 'Ports' : platform === 'SAT' ? 'Saturn' : platform,
      installedAt: 'Unknown (imported)', updatedAt: new Date().toISOString(), deployment: 'ready' as const, shortcut: e }];
  });
}
/** Remove/restore only a tracked entry and preserve all unrelated shortcut fields. */
export function editManagedShortcut(entries: VdfMap[], game: ManagedGame, action: 'remove' | 'restore'): Buffer {
  const matches = entries.filter((e) => typeof e.appid === 'number' && unsignedAppId(e.appid) === game.appId);
  if (matches.length > 1 || matches.some((e) => e.Exe !== game.shortcut.Exe)) throw new Error('Steam entry conflicts with the managed record. No changes made.');
  const kept = entries.filter((e) => !(typeof e.appid === 'number' && unsignedAppId(e.appid) === game.appId));
  if (action === 'restore') kept.push(matches[0] ?? game.shortcut);
  return encodeBinaryVdf('shortcuts', Object.fromEntries(kept.map((e, i) => [String(i), e])));
}

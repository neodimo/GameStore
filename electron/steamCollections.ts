import type { SteamFileTransport } from './steamDeploy';
import type { RetroPlatform } from './retroArchCores';

export const platformCollection = (platform: RetroPlatform): string =>
  ({ PS1: 'PS1', N64: 'N64', SAT: 'Saturn' })[platform];

type CloudEntry = [string, Record<string, unknown>];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Merge one membership; unrelated cloud records and user collections survive. */
export function mergeCollection(data: Buffer, name: string, appId: number, now: Date): Buffer {
  const entries: unknown = JSON.parse(data.toString('utf8'));
  if (!Array.isArray(entries) || !entries.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && object(entry[1])))
    throw new Error('Unrecognized Steam collection storage; no collection changes were made.');
  const rows = entries as CloudEntry[];
  let selected: CloudEntry | undefined;
  let collection: Record<string, unknown> | undefined;
  for (const row of rows) {
    if (!row[0].startsWith('user-collections.') || row[1].is_deleted) continue;
    if (typeof row[1].value !== 'string') throw new Error('Invalid Steam collection value.');
    const parsed: unknown = JSON.parse(row[1].value);
    if (!object(parsed)) throw new Error('Invalid Steam collection object.');
    if (typeof parsed.name === 'string' && parsed.name.toLowerCase() === name.toLowerCase()) {
      if (selected) throw new Error(`Multiple Steam collections named ${name}; rename duplicates in Steam first.`);
      selected = row; collection = parsed;
    }
  }
  if (!selected) {
    const id = `gamestore-${name.toLowerCase()}`;
    if (rows.some((row) => row[0] === `user-collections.${id}`))
      throw new Error(`The managed ${name} collection was renamed or deleted. Restore it in Steam before deploying.`);
    selected = [`user-collections.${id}`, {}];
    collection = { id, name, added: [], removed: [] };
    rows.push(selected);
  }
  const current = collection!;
  const added = current.added ?? [];
  const removed = current.removed ?? [];
  if (!Array.isArray(added) || !Array.isArray(removed) || ![...added, ...removed].every((id) => Number.isInteger(id)))
    throw new Error('Invalid Steam collection membership; no collection changes were made.');
  current.added = [...new Set([...added, appId])];
  current.removed = removed.filter((id) => id !== appId);
  const timestamp = Math.floor(now.getTime() / 1000);
  selected[1] = { ...selected[1], key: selected[0], timestamp, version: String(timestamp),
    value: JSON.stringify(current), conflictResolutionMethod: 'custom', strMethodId: 'union-collections' };
  return Buffer.from(JSON.stringify(rows));
}

/** Read and validate before deploying any files; never treat corrupt data as empty. */
export async function prepareCollection(directory: string, separator: string, name: string, appId: number, transport: SteamFileTransport, now: Date) {
  const namespaces = await transport.readFile(`${directory}${separator}cloud-storage-namespaces.json`);
  let namespace = 1;
  if (namespaces) {
    const parsed: unknown = JSON.parse(namespaces.toString('utf8'));
    if (!Array.isArray(parsed) || !parsed.length || !parsed.every((row) => Array.isArray(row) && Number.isInteger(row[0]) && row[0] > 0 && /^\d+$/.test(String(row[1]))))
      throw new Error('Unrecognized Steam cloud namespace index.');
    const active = [...parsed].sort((a, b) => Number(b[1]) - Number(a[1]));
    if (active.length > 1 && Number(active[0][1]) === Number(active[1][1]) && Number(active[0][1]) > 0)
      throw new Error('Ambiguous Steam cloud namespace; open and close Steam before retrying.');
    if (Number(active[0][1]) > 0) namespace = active[0][0];
  }
  const file = `${directory}${separator}cloud-storage-namespace-${namespace}.json`;
  const original = await transport.readFile(file);
  if (!original) throw new Error('Steam collection storage is not initialized. Create a collection in Steam, close Steam completely, then retry.');
  const updated = mergeCollection(original, name, appId, now);
  return {
    file,
    async commit() {
      const latest = await transport.readFile(file);
      if (!latest?.equals(original)) throw new Error('Steam collection storage changed during deployment. Close Steam and retry.');
      const backup = `${file}.gamestore-${now.toISOString().replace(/[:.]/g, '-')}.bak`;
      await transport.writeFile(backup, original);
      await transport.writeFile(file, updated);
      return backup;
    },
  };
}

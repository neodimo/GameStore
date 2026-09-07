import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, HardDrive } from 'lucide-react';

export function ManagedSteamSection({ onOpenSettings, onOpenPorts }: { onOpenSettings(): void; onOpenPorts(): void }) {
  const [inventory, setInventory] = useState<ManagedSteamInventory | null>(null);
  const [accounts, setAccounts] = useState<SteamStatus['accounts']>([]);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [confirm, setConfirm] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!window.gameStore) return;
    setBusy(true); setConfirm(null); setInventory(null);
    try {
      const status = await window.gameStore.getSteamStatus();
      setAccounts(status.accounts);
      if (status.blockedReason) throw new Error(status.blockedReason);
      if (status.accounts.length > 1 && !accountId) {
        setNote('Choose a Steam profile to view its managed games.'); return;
      }
      setInventory(await window.gameStore.getManagedSteamGames(accountId || undefined));
      setNote('');
    } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [accountId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (game: ManagedSteamGame, action: 'adopt' | 'remove' | 'restore') => {
    if (!inventory || !window.gameStore) return;
    setBusy(true); setConfirm(null);
    try {
      const result = await window.gameStore.manageSteamGame({ appId: game.appId, accountId: inventory.accountId, targetKey: inventory.targetKey, action });
      await load(); setNote(result.message);
    } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const visible = (games: ManagedSteamGame[]) => games.filter((g) =>
    (kind === 'all' || g.kind === kind) && `${g.title} ${g.platform} ${g.coreId ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const row = (game: ManagedSteamGame, legacy = false) => <article className="managed-game" key={game.appId}>
    <div><h3>{game.title}</h3><p>{game.kind === 'emulated' ? 'Emulated' : game.kind === 'recomp' ? 'Recompilation' : game.kind === 'decomp' ? 'Decompilation' : 'Native port'} · {game.platform} · {game.collection} collection</p></div>
    <span className="managed-status">{legacy ? 'Found · not tracked yet' : game.status === 'in-steam' ? 'In Steam' : game.status === 'removed' ? 'Not in Steam · files retained' : game.status === 'partial' ? 'Needs attention · incomplete operation' : 'Entry conflict'}</span>
    <dl>
      <dt>{game.kind === 'emulated' ? 'Emulator core' : 'Installed release'}</dt><dd>{game.coreId || game.version || 'Unknown (older installation)'}</dd>
      <dt>Destination path</dt><dd>{game.location}</dd>
      {!legacy && <><dt>Last managed</dt><dd>{new Date(game.updatedAt).toLocaleString()}</dd></>}
    </dl>
    <div className="managed-actions">
      {legacy ? <button disabled={busy} onClick={() => void act(game, 'adopt')}>Track this game</button>
        : game.status === 'conflict' ? <span>Steam entry changed outside GameStore. Resolve the conflict before editing.</span>
        : confirm === game.appId ? <><span>Close Steam on {inventory?.targetLabel} and remove this entry? Files and saves stay.</span><button disabled={busy} onClick={() => void act(game, 'remove')}>Confirm removal</button><button disabled={busy} onClick={() => setConfirm(null)}>Cancel</button></>
        : <>{game.status === 'in-steam' || game.status === 'partial' ? <button disabled={busy} onClick={() => setConfirm(game.appId)}>Remove from Steam</button> : null}
          {game.status !== 'in-steam' ? <button disabled={busy} onClick={() => void act(game, 'restore')}>Restore Steam entry</button> : null}</>}
    </div>
  </article>;
  return <section className="managed-steam">
    <div className="managed-header"><div><h1><HardDrive /> Managed PC games</h1><p>{inventory ? `${inventory.targetLabel} · Steam profile ${inventory.accountId}` : 'Selected PC / Steam target'}</p></div>
      <button disabled={busy} onClick={() => void load()}><RefreshCw /> {busy ? 'Working…' : 'Refresh'}</button><button disabled={busy} onClick={onOpenSettings}>PC settings</button></div>
    <p>Track emulated games and native ports on this PC. Removing or restoring an entry closes Steam there. Game files and saves are kept. Restore reconnects the Steam entry; it does not repair missing files.</p>
    {accounts.length > 1 && <label>Steam profile <select disabled={busy} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Choose profile</option>{accounts.map((a) => <option key={`${a.steamRoot}/${a.accountId}`} value={a.accountId}>{a.accountId}</option>)}</select></label>}
    <div className="managed-filters"><input aria-label="Search managed games" placeholder="Search managed games…" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="Game type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All game types</option><option value="emulated">Emulated</option><option value="recomp">Recompilations</option><option value="decomp">Decompilations</option><option value="port">Native ports</option></select><button onClick={onOpenPorts}>Browse ports</button></div>
    {note && <p role="status">{note}</p>}
    {inventory && <><h2>Tracked games ({inventory.games.length})</h2>{visible(inventory.games).map((g) => row(g))}{!inventory.games.length && <p>New deployments are tracked automatically. Older entries found below can be imported.</p>}
      {!!inventory.legacy.length && <><h2>Existing GameStore entries ({inventory.legacy.length})</h2><p>Detected from GameStore install paths. Confirm each entry to track it. Original install dates and release versions may be unknown.</p>{visible(inventory.legacy).map((g) => row(g, true))}</>}
      <small>“In Steam” verifies the saved shortcut, not game-file integrity or a successful launch. Reinstall or update ports through Ports; emulator games through Cart.</small></>}
  </section>;
}

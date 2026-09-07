import {
  AlertTriangle,
  Box,
  ExternalLink,
  HardDriveUpload,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  portsCatalog,
  portsByPlatform,
  isInstallable,
  PORT_PLATFORMS,
  PORT_PLATFORM_LABELS,
  TECHNIQUE_LABELS,
  type PortEntry,
  type PortPlatform,
} from "./portsCatalog";

/**
 * Ports section — PC-native releases of retro games.
 *
 * v0.27.x shipped the catalog browser against ten hand-picked entries. This
 * revision generates the catalog from portsdr.com's full index (188 projects)
 * and replaces the old "open a link and do it yourself" cards with the same
 * acquire → deploy pipeline the rest of GameStore uses: pick or fetch the
 * base game once, then one button downloads the release, unpacks it, ships it
 * to the target PC, and registers a Steam shortcut that launches it directly.
 */
export function PortsSection({ onClose }: { onClose: () => void }) {
  const [platform, setPlatform] = useState<PortPlatform | "All">("All");
  const [target, setTarget] = useState<PcTargetSettings | null>(null);
  const [steam, setSteam] = useState<SteamStatus | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!window.gameStore) return;
    const configured = await window.gameStore.getPcTarget();
    setTarget(configured);
    if (!configured?.os) return;
    setState("loading"); setNote("");
    try {
      setSteam(await window.gameStore.getSteamStatus());
      setState("idle");
    } catch (error) {
      setState("error"); setNote(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    if (platform === "All") return portsCatalog;
    return portsByPlatform[platform] ?? [];
  }, [platform]);

  const targetOs = target?.os;
  const where = target ? (target.kind === "local" ? "this computer" : target.name || target.host) : "";
  const accountId = steam?.accounts.length === 1 ? steam.accounts[0].accountId : undefined;
  const deployBlocked =
    !target ? "Configure a PC target in Settings → PC / Steam first."
    : !target.os ? "Detect this machine's OS in Settings first."
    : state === "loading" ? "Checking Steam on the target…"
    : steam?.blockedReason ? steam.blockedReason
    : steam && !steam.installed ? "No Steam profile found on this machine."
    : steam && steam.accounts.length > 1 ? "That machine has more than one Steam profile; choose one in Settings before installing ports."
    : "";

  return (
    <section className="ports-section">
      <header className="ports-section-head">
        <Box />
        <div>
          <h2>Ports</h2>
          <p>
            PC-native releases of retro games — decomps, recomps, and native
            ports, sourced from portsdr.com. Download the release, supply your
            own dump of the original game where one is needed, and GameStore
            ships both to {where || "your PC target"} and registers a Steam
            shortcut.
          </p>
        </div>
        <button className="ports-close" onClick={onClose}>Back to Discover</button>
      </header>

      <div className="ports-target-head">
        {deployBlocked
          ? <p className="steam-blocked"><ShieldAlert /> {deployBlocked}</p>
          : <p className="steam-blocked">Installing sends this port's release and your game data to {where}, closes Steam if it is running, and adds a shortcut in the Ports collection.</p>}
        <button className="ports-recheck" disabled={state === "loading"} onClick={() => void load()}>
          <RefreshCw className={state === "loading" ? "spin" : ""} /> Re-check target
        </button>
      </div>

      <div className="ports-platforms">
        <button
          className={platform === "All" ? "active" : ""}
          onClick={() => setPlatform("All")}
        >
          All
        </button>
        {PORT_PLATFORMS.filter((id) => portsByPlatform[id]?.length).map((id) => (
          <button
            key={id}
            className={platform === id ? "active" : ""}
            onClick={() => setPlatform(id)}
          >
            {PORT_PLATFORM_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="ports-grid">
        {visible.length === 0 ? (
          <div className="ports-empty">
            <p>No port entries for {platform === "All" ? "this filter" : PORT_PLATFORM_LABELS[platform]}.</p>
          </div>
        ) : (
          visible.map((entry) => (
            <PortCard
              key={entry.id}
              entry={entry}
              targetOs={targetOs}
              installDisabledReason={deployBlocked}
              accountId={accountId}
            />
          ))
        )}
      </div>
    </section>
  );
}

const targetLabelFor = (os?: PcOs) => (os === "windows" ? "Windows" : os === "mac" ? "macOS" : "Linux");

function PortCard({
  entry,
  targetOs,
  installDisabledReason,
  accountId,
}: {
  entry: PortEntry;
  targetOs?: PcOs;
  installDisabledReason: string;
  accountId?: string;
}) {
  const [coverSrc, setCoverSrc] = useState<string | null>(entry.coverUrl ?? null);
  const [gameDataFiles, setGameDataFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState<"idle" | "acquiring" | "installing" | "done" | "error">("idle");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!entry.coverUrl) return;
    let cancelled = false;
    window.gameStore
      ?.cacheCover(entry.coverUrl)
      .then((local) => { if (!cancelled) setCoverSrc(local ?? entry.coverUrl ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entry.coverUrl]);

  const openExternal = (url: string) => window.gameStore?.openExternal(url);
  const installable = isInstallable(entry);
  const targetLabel = targetOs ? targetLabelFor(targetOs) : undefined;
  const supportsThisTarget = !targetLabel || entry.deployTargets.includes(targetLabel);
  const requestEntry: PortRequestEntry = {
    id: entry.id,
    title: entry.title,
    projectUrl: entry.projectUrl,
    needsOriginalAssets: entry.needsOriginalAssets,
    distributionKind: entry.distributionKind,
    deployTargets: entry.deployTargets,
    executableHint: entry.executableHint,
    downloadUrl: entry.downloadUrl,
    requiredRomRevision: entry.requiredRomRevision,
    sourcePlatform: entry.sourcePlatform,
    technique: entry.technique,
  };

  const install = async () => {
    setBusy("acquiring");
    setNote(`Searching your torrent collection for the ${PORT_PLATFORM_LABELS[entry.sourcePlatform]} release…`);
    try {
      const found = await window.gameStore!.searchCollections(
        entry.title,
        "USA",
        entry.sourcePlatform,
      );
      if (!found.length) {
        setBusy("error");
        setNote(
          `No torrent collection is indexed for ${PORT_PLATFORM_LABELS[entry.sourcePlatform]}. ` +
          `Add or re-index one in Settings → Collections, then try again.`,
        );
        return;
      }
      const pick = found.length === 1 ? found[0] : await pickCandidate(found);
      if (!pick) { setBusy("idle"); setNote(""); return; }
      setBusy("installing");
      setNote(`Downloading ${pick.path.split("/").pop() ?? pick.path}…`);
      await window.gameStore!.downloadCollectionSelection(
        pick.sourceUrl,
        [pick.path],
        entry.title,
        entry.sourcePlatform,
      );
      setBusy("done");
      setNote(
        `In your cart. ${found.length > 1 ? `Picked ${pick.path.split("/").pop()} from ${found.length} candidates. ` : ""}` +
        `Open the cart to send it to ${targetLabel ?? "the target"}.`,
      );
    } catch (error) {
      setBusy("error");
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  // Promise-based selector so the install handler can `await` a user choice
  // without locking the rest of the UI. Resolves with `null` on cancel.
  const pickCandidate = (candidates: { path: string }[]): Promise<{ path: string } | null> =>
    new Promise((resolve) => {
      const choices = candidates.map((c) => c.path.split("/").pop() ?? c.path);
      const answer = window.prompt(
        `Multiple releases of ${entry.title} were found. Type the one to download:\n\n${choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
        choices[0],
      );
      if (answer == null) return resolve(null);
      const match = candidates.find((c) => (c.path.split("/").pop() ?? c.path) === answer)
        ?? candidates.find((c) => c.path.endsWith(answer))
        ?? candidates[0];
      resolve(match);
    });

  return (
    <article className="port-card">
      <div className="port-card-art">
        {coverSrc ? (
          <img src={coverSrc} alt={`${entry.title} cover`} loading="lazy" />
        ) : (
          <div className="port-card-art-placeholder"><Box /></div>
        )}
      </div>
      <div className="port-card-body">
        <header className="port-card-head">
          <h3>{entry.title}</h3>
          <span className="port-card-source">{PORT_PLATFORM_LABELS[entry.sourcePlatform]}</span>
        </header>
        <p className="port-card-project">{entry.project}</p>
        <p className="port-card-description">{entry.description}</p>

        <p className="port-card-badges">
          <span className="port-card-badge">{TECHNIQUE_LABELS[entry.technique]}</span>
          {entry.preRelease && <span className="port-card-badge port-card-badge-warn">Pre-release</span>}
          {entry.aiAssisted && <span className="port-card-badge"><Sparkles size={12} /> AI-assisted</span>}
        </p>

        <div className="port-card-actions">
          <button className="port-card-link" onClick={() => openExternal(entry.projectUrl)}>
            <ExternalLink /> Project
          </button>
          {entry.steamAppId && (
            <button className="port-card-link" onClick={() => openExternal(`https://store.steampowered.com/app/${entry.steamAppId}`)}>
              <ExternalLink /> Steam page
            </button>
          )}
        </div>

        {!installable && (
          <p className="port-card-curation">
            No published binary GameStore can install{entry.deployTargets.length === 0 && entry.portTargets.length ? ` (ships for ${entry.portTargets.join(", ")} only)` : ""} — use the project link to build from source.
          </p>
        )}
        {installable && !supportsThisTarget && (
          <p className="port-card-curation">
            No {targetLabel} build published — this project ships for {entry.deployTargets.join(", ") || "no target GameStore deploys to"}.
          </p>
        )}

        {installable && supportsThisTarget && (
          <div className="port-card-install">
            <button
              className="port-card-cart"
              disabled={busy !== "idle" || Boolean(installDisabledReason)}
              title={installDisabledReason || undefined}
              onClick={() => void install()}
            >
              <HardDriveUpload /> {busy === "acquiring" ? "Searching…" : busy === "installing" ? "Downloading…" : "Download release"}
            </button>
          </div>
        )}
        {note && (
          <p className={`port-card-note ${busy}`}>
            {busy === "error" && <AlertTriangle size={14} />} {note}
          </p>
        )}
      </div>
    </article>
  );
}

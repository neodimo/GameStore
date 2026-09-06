import { Box, ExternalLink, ShieldAlert, ShoppingCart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  portsCatalog,
  portsByPlatform,
  PORT_PLATFORMS,
  PORT_PLATFORM_LABELS,
  type PortEntry,
  type PortPlatform,
} from "./portsCatalog";

/**
 * Ports section — PC-native releases of retro games.
 *
 * v0.27.0 ships the catalog browser. Download deployment is wired through the
 * existing Minerva / Real-Debrid pipeline; entries without a curated
 * `downloadUrl` show as "Awaiting curation" rather than fabricating one. Send
 * to Steam reuses the vertical-art + collection-assignment path from v0.26.3.
 */
export function PortsSection({ onClose }: { onClose: () => void }) {
  const [platform, setPlatform] = useState<PortPlatform | "All">("All");

  const visible = useMemo(() => {
    if (platform === "All") return portsCatalog;
    return portsByPlatform[platform] ?? [];
  }, [platform]);

  return (
    <section className="ports-section">
      <header className="ports-section-head">
        <Box />
        <div>
          <h2>Ports</h2>
          <p>
            PC-native releases of retro games — decomps, recomps, and
            standalone community ports. Same download and Steam-deploy pipeline
            as everything else in GameStore.
          </p>
        </div>
        <button className="ports-close" onClick={onClose}>Back to Discover</button>
      </header>

      <div className="ports-platforms">
        <button
          className={platform === "All" ? "active" : ""}
          onClick={() => setPlatform("All")}
        >
          All
        </button>
        {PORT_PLATFORMS.map((id) => (
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
            <p>No port entries yet for {platform === "All" ? "this filter" : PORT_PLATFORM_LABELS[platform]}.</p>
            <p className="ports-empty-hint">
              Entries are curated from publicly-released decomp and recomp
              projects. New platforms get filled in as projects ship.
            </p>
          </div>
        ) : (
          visible.map((entry) => <PortCard key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}

function PortCard({ entry }: { entry: PortEntry }) {
  // Lazy-resolve the cached cover. Renderer-side, so the same cache the rest
  // of the catalog uses; falls back to remote URL if not yet cached.
  const [coverSrc, setCoverSrc] = useState<string | null>(entry.coverUrl ?? null);
  useEffect(() => {
    if (!entry.coverUrl) return;
    let cancelled = false;
    window.gameStore
      ?.cacheCover(entry.coverUrl)
      .then((local) => {
        if (!cancelled) setCoverSrc((local as string | null) ?? entry.coverUrl ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.coverUrl]);

  const openExternal = (url: string) => window.gameStore?.openExternal(url);

  return (
    <article className="port-card">
      <div className="port-card-art">
        {coverSrc ? (
          <img src={coverSrc} alt={`${entry.title} cover`} loading="lazy" />
        ) : (
          <div className="port-card-art-placeholder">
            <Box />
          </div>
        )}
      </div>
      <div className="port-card-body">
        <header className="port-card-head">
          <h3>{entry.title}</h3>
          <span className="port-card-source">{PORT_PLATFORM_LABELS[entry.sourcePlatform]}</span>
        </header>
        <p className="port-card-project">{entry.project}</p>
        <p className="port-card-description">{entry.description}</p>
        {entry.needsOriginalAssets && (
          <p className="port-card-assets">
            <ShieldAlert />
            Requires your own legally-acquired copy of the original game.
          </p>
        )}
        <div className="port-card-actions">
          <button
            className="port-card-link"
            onClick={() => openExternal(entry.projectUrl)}
          >
            <ExternalLink />
            Project
          </button>
          {entry.steamAppId && (
            <button
              className="port-card-link"
              onClick={() => openExternal(`https://store.steampowered.com/app/${entry.steamAppId}`)}
            >
              <ExternalLink />
              Steam
            </button>
          )}
          {entry.downloadUrl ? (
            <button
              className="port-card-cart"
              onClick={() => openExternal(entry.downloadUrl!)}
              title="Open curated download link (Minerva / Real-Debrid) in your browser. A future release will route this through the in-app download manager."
            >
              <ShoppingCart />
              Open Download
            </button>
          ) : (
            <span className="port-card-curation">Awaiting curation</span>
          )}
        </div>
      </div>
    </article>
  );
}

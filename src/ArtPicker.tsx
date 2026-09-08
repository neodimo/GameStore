import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import type { Game } from "./catalog";
import {
  artFolders,
  BROWSE_FLOOR,
  normalizeTitle,
  parseArtFilename,
  rankArtCandidates,
  titleSimilarity,
  type ArtFolder,
} from "./artMatch";
import { useArtwork } from "./artwork";
import { platformOf } from "./platforms";

type Candidate = {
  url: string;
  label: string;
  detail: string;
  source: string;
  score?: number;
};
type Tab = ArtFolder | "TheGamesDB" | "IGDB";
const TABS: Tab[] = [
  "Named_Boxarts",
  "Named_Titles",
  "Named_Snaps",
  "TheGamesDB",
  "IGDB",
];
const tabLabel = (tab: Tab) =>
  tab === "TheGamesDB" || tab === "IGDB" ? tab : artFolders[tab];

/**
 * Deep artwork search for one game. Every Libretro thumbnail folder is ranked
 * against an editable query so regional printings, title screens and
 * screenshots are all available when the automatic match is not the cover
 * Omid wants.
 */
export function ArtPicker({
  game,
  onClose,
}: {
  game: Game;
  onClose: () => void;
}) {
  const artwork = useArtwork();
  const current = artwork.artFor(game);
  // Every folder browsed here belongs to this game's own console. Searching a
  // Nintendo 64 title against the PlayStation pack is what the shared index
  // used to do, and it is why non-PlayStation art never resolved.
  const platform = platformOf(game.platform);
  const boxarts = artwork.indexFor(game.platform).files;
  const [tab, setTab] = useState<Tab>("Named_Boxarts");
  const [query, setQuery] = useState(game.title);
  const [indexes, setIndexes] = useState<Record<string, string[]>>({
    Named_Boxarts: boxarts,
  });
  const [remote, setRemote] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIndexes({ Named_Boxarts: boxarts });
  }, [boxarts]);
  useEffect(() => searchRef.current?.focus(), []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [onClose]);

  useEffect(() => {
    if (tab === "TheGamesDB" || tab === "IGDB" || indexes[tab]?.length) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    window.gameStore
      ?.getArtIndex(platform.thumbnailSystem, tab)
      .then((loaded) => {
        if (!cancelled)
          setIndexes((prev) => ({ ...prev, [tab]: loaded.files }));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [tab, indexes, platform.thumbnailSystem]);

  const searchTheGamesDb = async () => {
    setBusy(true);
    setError("");
    try {
      if (!window.gameStore)
        throw new Error("Provider lookup runs in the desktop app.");
      const found = await window.gameStore.findTheGamesDbArt(query, game.platform);
      setRemote(
        found
          .map((c) => ({
            url: c.url,
            label: c.title,
            detail: "Front cover",
            source: c.source,
            score: titleSimilarity(query, c.title),
          }))
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRemote([]);
    } finally {
      setBusy(false);
    }
  };
  const searchIgdb = async () => {
    setBusy(true);
    setError("");
    try {
      if (!window.gameStore) throw new Error("Provider lookup runs in the desktop app.");
      const found = await window.gameStore.findIgdbMedia(query, game.platform);
      setRemote(found.filter((c) => c.cover).map((c) => ({
        url: c.cover!, label: c.title, detail: "Platform-filtered cover", source: "IGDB", score: titleSimilarity(query, c.title),
      })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRemote([]);
    } finally { setBusy(false); }
  };

  const candidates = useMemo<Candidate[]>(() => {
    if (tab === "TheGamesDB" || tab === "IGDB") return remote;
    const files = indexes[tab] ?? [];
    const matches = rankArtCandidates(
      query,
      game.region,
      files,
      { system: platform.thumbnailSystem, folder: tab },
      36,
      BROWSE_FLOOR,
    );
    const scoped = platform.id === "X360"
      ? matches.filter((m) => normalizeTitle(parseArtFilename(m.file).core) === normalizeTitle(query))
      : matches;
    return scoped.map((m) => ({
      url: m.url,
      label: m.label,
      detail: m.tags.join(" · ") || "No release tags",
      source: m.confidence,
      score: m.score,
    }));
  }, [tab, remote, indexes, query, game.region, platform.id, platform.thumbnailSystem]);

  const apply = (candidate: Candidate) => {
    artwork.setOverride(game, {
      url: candidate.url,
      label: candidate.detail,
      source: candidate.source === "TheGamesDB" || candidate.source === "IGDB" ? candidate.source : tabLabel(tab),
    });
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="art-picker-modal">
        <header>
          <div className="art-current">
            {current.url && <img src={current.url} alt="Current cover" />}
            <div>
              <p className="eyebrow">ALTERNATE ARTWORK</p>
              <h2>{game.title}</h2>
              <small>
                Now using: {current.source}
                {current.variant ? ` · ${current.variant}` : ""}
              </small>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="art-search">
          <Search />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (tab === "TheGamesDB" || tab === "IGDB"))
                void (tab === "IGDB" ? searchIgdb() : searchTheGamesDb());
            }}
            placeholder="Search any release title"
          />
          {tab === "TheGamesDB" || tab === "IGDB" ? (
            <button onClick={() => void (tab === "IGDB" ? searchIgdb() : searchTheGamesDb())}>Search</button>
          ) : (
            <button onClick={() => void artwork.refreshIndex()}>
              <RefreshCw /> Refresh index
            </button>
          )}
        </div>
        <div className="art-tabs">
          {TABS.map((option) => (
            <button
              key={option}
              className={tab === option ? "active" : ""}
              onClick={() => setTab(option)}
            >
              {tabLabel(option)}
            </button>
          ))}
          <span className="spacer" />
          {artwork.hasOverride(game) && (
            <button
              className="reset-art"
              onClick={() => {
                artwork.clearOverride(game);
                onClose();
              }}
            >
              <RotateCcw /> Reset to automatic
            </button>
          )}
        </div>
        {busy && (
          <p className="art-status">
            <LoaderCircle className="spin" /> Loading candidates…
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {!busy && !error && !candidates.length && (
          <p className="art-status">
            {tab === "TheGamesDB" || tab === "IGDB"
              ? `Press Search to query ${tab} with the title above.`
              : "No release matched that title. Try a shorter or romanized query."}
          </p>
        )}
        <div className="candidate-grid">
          {candidates.map((candidate) => (
            <button key={candidate.url} onClick={() => apply(candidate)}>
              <img src={candidate.url} alt={candidate.label} loading="lazy" />
              <b>{candidate.label}</b>
              <span>{candidate.detail}</span>
              {candidate.score !== undefined && (
                <small>match {candidate.score.toFixed(2)}</small>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

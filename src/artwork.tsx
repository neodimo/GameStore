import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Game } from "./catalog";
import {
  exactArtMatch,
  resolveArt,
  type ArtFolder,
  type ArtMatch,
  type Confidence,
} from "./artMatch";

export type ResolvedArt = {
  url?: string;
  source: string;
  confidence?: Confidence;
  variant?: string;
  manual: boolean;
};
type Override = { url: string; label: string; source: string };
export type IndexState = {
  files: string[];
  fetchedAt: number;
  status: "idle" | "loading" | "ready" | "error";
  message?: string;
};

const OVERRIDE_PREFIX = "gamestore:art:";
const OVERRIDE_META = "gamestore:art-meta";

/**
 * Budget for one slice of fuzzy matching. Comfortably inside a 60fps frame, so
 * background resolution stays invisible even mid-scroll.
 */
const SLICE_MS = 8;
/** Idle time when the browser offers it, next task otherwise. */
const schedule = (run: () => void) => {
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(() => run(), { timeout: 250 });
  else setTimeout(run, 0);
};

const readOverrides = (): Record<string, Override> => {
  const meta = (() => {
    try {
      return JSON.parse(localStorage.getItem(OVERRIDE_META) || "{}") as Record<
        string,
        Override
      >;
    } catch {
      return {};
    }
  })();
  // Overrides saved before artwork metadata existed are plain URL entries.
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(OVERRIDE_PREFIX)) continue;
    const id = key.slice(OVERRIDE_PREFIX.length);
    const url = localStorage.getItem(key);
    if (url && !meta[id]) meta[id] = { url, label: "Manual choice", source: "Manual" };
  }
  return meta;
};

type ArtworkApi = {
  index: IndexState;
  /** True while the fuzzy fallback is still filling in unseeded titles. */
  resolving: boolean;
  artFor(game: Game): ResolvedArt;
  autoMatch(game: Game): ArtMatch | null;
  setOverride(game: Game, choice: Override): void;
  clearOverride(game: Game): void;
  hasOverride(game: Game): boolean;
  refreshIndex(): Promise<void>;
  unmatched: number;
};
const ArtworkContext = createContext<ArtworkApi | null>(null);

export const useArtwork = () => {
  const api = useContext(ArtworkContext);
  if (!api) throw new Error("useArtwork requires ArtworkProvider");
  return api;
};

/**
 * Owns automatic artwork resolution for the whole catalog. The Libretro index
 * is fetched once through the desktop bridge, then every game is matched
 * locally so covers no longer depend on hand-written filenames.
 */
export function ArtworkProvider({
  games,
  folder = "Named_Boxarts",
  children,
}: {
  games: Game[];
  folder?: ArtFolder;
  children: ReactNode;
}) {
  const [index, setIndex] = useState<IndexState>({
    files: [],
    fetchedAt: 0,
    status: "idle",
  });
  const [overrides, setOverrides] = useState<Record<string, Override>>(
    readOverrides,
  );

  const load = useCallback(async (force: boolean) => {
    if (!window.gameStore) {
      setIndex({
        files: [],
        fetchedAt: 0,
        status: "error",
        message: "Automatic artwork search runs in the desktop app.",
      });
      return;
    }
    setIndex((prev) => ({ ...prev, status: "loading" }));
    try {
      const loaded = await window.gameStore.getArtIndex(folder, force);
      setIndex({
        files: loaded.files,
        fetchedAt: loaded.fetchedAt,
        status: "ready",
      });
    } catch (error) {
      setIndex({
        files: [],
        fetchedAt: 0,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [folder]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const [auto, setAuto] = useState<Record<string, ArtMatch | null>>({});
  const [resolving, setResolving] = useState(false);

  /**
   * Resolution runs in two phases so the catalog paints immediately. Titles
   * carrying a seeded No-Intro name resolve by map lookup in one synchronous
   * pass; the rest are scored in small slices handed back to the event loop, so
   * a long tail of fuzzy matching can never freeze scrolling or input.
   */
  useEffect(() => {
    if (!index.files.length) {
      setAuto({});
      setResolving(false);
      return;
    }
    const seeded: Record<string, ArtMatch | null> = {};
    const pending: Game[] = [];
    for (const game of games) {
      // The live index currently belongs to the PlayStation thumbnail pack.
      // N64 records carry their own Nintendo 64 seed URL until its parallel
      // index is introduced, so a title collision can never pick PSX art.
      if (game.platform !== "PS1") continue;
      const hit = exactArtMatch(game.coverName, index.files, folder);
      if (hit) seeded[game.id] = hit;
      else pending.push(game);
    }
    setAuto(seeded);
    if (!pending.length) {
      setResolving(false);
      return;
    }

    let cancelled = false;
    let cursor = 0;
    setResolving(true);
    const step = () => {
      if (cancelled) return;
      const deadline = performance.now() + SLICE_MS;
      const batch: Record<string, ArtMatch | null> = {};
      while (cursor < pending.length && performance.now() < deadline) {
        const game = pending[cursor];
        cursor += 1;
        batch[game.id] = resolveArt(
          game.title,
          game.region,
          index.files,
          folder,
        );
      }
      setAuto((prev) => ({ ...prev, ...batch }));
      if (cursor < pending.length) schedule(step);
      else setResolving(false);
    };
    schedule(step);
    return () => {
      cancelled = true;
    };
  }, [games, index.files, folder]);

  const persist = useCallback((next: Record<string, Override>) => {
    localStorage.setItem(OVERRIDE_META, JSON.stringify(next));
    setOverrides(next);
  }, []);

  // Memoized so a card only re-renders when artwork state actually changes,
  // rather than on every render of the provider.
  const api: ArtworkApi = useMemo(() => ({
    index,
    resolving,
    autoMatch: (game) => auto[game.id] ?? null,
    artFor: (game) => {
      const manual = overrides[game.id];
      if (manual)
        return {
          url: manual.url,
          source: manual.source,
          variant: manual.label,
          manual: true,
        };
      if (game.platform !== "PS1" && game.cover)
        return { url: game.cover, source: "Catalog seed", manual: false };
      const match = auto[game.id];
      if (match)
        return {
          url: match.url,
          source: match.source,
          confidence: match.confidence,
          variant: match.tags.join(" · ") || match.label,
          manual: false,
        };
      // Catalog seeds stay as the offline fallback until the index arrives.
      return game.cover
        ? { url: game.cover, source: "Catalog seed", manual: false }
        : { source: "No match", manual: false };
    },
    setOverride: (game, choice) =>
      persist({ ...overrides, [game.id]: choice }),
    clearOverride: (game) => {
      const next = { ...overrides };
      delete next[game.id];
      localStorage.removeItem(`${OVERRIDE_PREFIX}${game.id}`);
      persist(next);
    },
    hasOverride: (game) => !!overrides[game.id],
    refreshIndex: () => load(true),
    unmatched: games.filter((g) => g.platform === "PS1" && !overrides[g.id] && !auto[g.id]).length,
  }), [index, resolving, auto, overrides, games, persist, load]);
  return (
    <ArtworkContext.Provider value={api}>{children}</ArtworkContext.Provider>
  );
}

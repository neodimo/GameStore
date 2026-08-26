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
import { PLATFORMS, platformOf, type PlatformId } from "./platforms";

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
/**
 * One Libretro index per console. They are separate lists on purpose: sharing
 * a single one would let a title that exists on two systems resolve against the
 * wrong pack, which is the collision the previous PlayStation-only build
 * avoided by refusing to resolve anything else at all.
 */
export type IndexStates = Record<PlatformId, IndexState>;

const IDLE: IndexState = { files: [], fetchedAt: 0, status: "idle" };
const emptyIndexes = (): IndexStates =>
  Object.fromEntries(
    PLATFORMS.map((platform) => [platform.id, IDLE]),
  ) as IndexStates;

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
  /** Per-console index state; a console with no catalog games stays idle. */
  indexes: IndexStates;
  /** The index a given game resolves against. */
  indexFor(platform: string | undefined): IndexState;
  /** True while the fuzzy fallback is still filling in unseeded titles. */
  resolving: boolean;
  artFor(game: Game): ResolvedArt;
  autoMatch(game: Game): ArtMatch | null;
  setOverride(game: Game, choice: Override): void;
  clearOverride(game: Game): void;
  hasOverride(game: Game): boolean;
  refreshIndex(): Promise<void>;
  /** Catalog games with neither an automatic match nor a manual override. */
  unmatched: number;
  /** Catalog games that could carry a match, for reporting coverage. */
  resolvable: number;
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
  const [indexes, setIndexes] = useState<IndexStates>(emptyIndexes);
  const [overrides, setOverrides] = useState<Record<string, Override>>(
    readOverrides,
  );

  /**
   * Only consoles the catalog actually carries are fetched, so a platform with
   * no games costs no request. Each index resolves independently: one console's
   * thumbnail pack being unreachable must not blank the others' artwork.
   */
  const wanted = useMemo(() => {
    const present = new Set(games.map((game) => platformOf(game.platform).id));
    return PLATFORMS.filter((platform) => present.has(platform.id));
  }, [games]);

  const load = useCallback(
    async (force: boolean) => {
      if (!window.gameStore) {
        setIndexes((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([id, state]) => [
              id,
              {
                ...state,
                status: "error" as const,
                message: "Automatic artwork search runs in the desktop app.",
              },
            ]),
          ) as IndexStates,
        );
        return;
      }
      await Promise.all(
        wanted.map(async (platform) => {
          setIndexes((prev) => ({
            ...prev,
            [platform.id]: { ...prev[platform.id], status: "loading" },
          }));
          try {
            const loaded = await window.gameStore!.getArtIndex(
              platform.thumbnailSystem,
              folder,
              force,
            );
            setIndexes((prev) => ({
              ...prev,
              [platform.id]: {
                files: loaded.files,
                fetchedAt: loaded.fetchedAt,
                status: "ready",
              },
            }));
          } catch (error) {
            setIndexes((prev) => ({
              ...prev,
              [platform.id]: {
                files: [],
                fetchedAt: 0,
                status: "error",
                message:
                  error instanceof Error ? error.message : String(error),
              },
            }));
          }
        }),
      );
    },
    [folder, wanted],
  );

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
    const seeded: Record<string, ArtMatch | null> = {};
    const pending: { game: Game; files: string[]; system: string }[] = [];
    for (const game of games) {
      const platform = platformOf(game.platform);
      const files = indexes[platform.id]?.files ?? [];
      // A console whose index has not arrived yet keeps its catalog seed URL
      // rather than being scored against another console's filenames.
      if (!files.length) continue;
      const source = { system: platform.thumbnailSystem, folder };
      const hit = exactArtMatch(game.coverName, files, source);
      if (hit) seeded[game.id] = hit;
      else pending.push({ game, files, system: platform.thumbnailSystem });
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
        const { game, files, system } = pending[cursor];
        cursor += 1;
        batch[game.id] = resolveArt(game.title, game.region, files, {
          system,
          folder,
        });
      }
      setAuto((prev) => ({ ...prev, ...batch }));
      if (cursor < pending.length) schedule(step);
      else setResolving(false);
    };
    schedule(step);
    return () => {
      cancelled = true;
    };
  }, [games, indexes, folder]);

  const persist = useCallback((next: Record<string, Override>) => {
    localStorage.setItem(OVERRIDE_META, JSON.stringify(next));
    setOverrides(next);
  }, []);

  // Memoized so a card only re-renders when artwork state actually changes,
  // rather than on every render of the provider.
  const api: ArtworkApi = useMemo(() => ({
    indexes,
    indexFor: (platform) => indexes[platformOf(platform).id] ?? IDLE,
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
    // Coverage is reported across every console the catalog carries, because
    // "1,371/1,379 PS1 covers matched" stopped describing the library the
    // moment a second platform existed.
    unmatched: games.filter((g) => !overrides[g.id] && !auto[g.id]).length,
    resolvable: games.length,
  }), [indexes, resolving, auto, overrides, games, persist, load]);
  return (
    <ArtworkContext.Provider value={api}>{children}</ArtworkContext.Provider>
  );
}

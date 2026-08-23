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

  const auto = useMemo(() => {
    const map: Record<string, ArtMatch | null> = {};
    if (index.files.length)
      for (const game of games)
        map[game.id] = resolveArt(game.title, game.region, index.files, folder);
    return map;
  }, [games, index.files, folder]);

  const persist = (next: Record<string, Override>) => {
    localStorage.setItem(OVERRIDE_META, JSON.stringify(next));
    setOverrides(next);
  };

  const api: ArtworkApi = {
    index,
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
    unmatched: games.filter((g) => !overrides[g.id] && !auto[g.id]).length,
  };
  return (
    <ArtworkContext.Provider value={api}>{children}</ArtworkContext.Provider>
  );
}

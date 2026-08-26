import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Compass,
  Download,
  Database,
  ExternalLink,
  Film,
  Gamepad2,
  Grid2X2,
  HardDrive,
  HardDriveUpload,
  Heart,
  Image,
  Library,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  Settings,
  Settings2,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { createCuratedShelves, facetOrder, games, metaLine, Game } from "./catalog";
import { translationFor } from "./translationManifest";
import { ArtworkProvider, useArtwork } from "./artwork";
import {
  PLATFORMS,
  deviceFolderFor,
  deviceFolderLabel,
  platformLabel,
  platformOf,
  type PlatformId,
} from "./platforms";
import { ArtPicker } from "./ArtPicker";
import { MediaGallery } from "./MediaGallery";
import { restartMediaAudit } from "./mediaLibrary";

type Sort = "curated" | "title" | "year-new" | "year-old";
type PlatformFilter = "All" | Game["platform"];
const open = (url: string) =>
  window.gameStore?.openExternal(url) ?? window.open(url, "_blank", "noopener");
const formatBytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
const loadFavs = () => {
  try {
    return new Set<string>(
      JSON.parse(localStorage.getItem("gamestore:favorites") || "[]"),
    );
  } catch {
    return new Set<string>();
  }
};
const loadHiddenGenres = () => {
  try { return new Set<string>(JSON.parse(localStorage.getItem("gamestore:hidden-genres") || "[]")); }
  catch { return new Set<string>(); }
};
export function App() {
  return (
    <ArtworkProvider games={games}>
      <Catalog />
    </ArtworkProvider>
  );
}

function Catalog() {
  const [curatedShelves] = useState(() => createCuratedShelves());
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("All regions");
  const [genre, setGenre] = useState("All genres");
  const [hiddenGenres, setHiddenGenres] = useState<Set<string>>(loadHiddenGenres);
  const [genreMenu, setGenreMenu] = useState(false);
  const [platform, setPlatform] = useState<PlatformFilter>("All");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("gamestore:sidebar-collapsed") === "true");
  const [deviceManager, setDeviceManager] = useState(false);
  const [facet, setFacet] = useState("All flavors");
  const [translation, setTranslation] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("curated");
  const [selected, setSelected] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavs);
  const [settings, setSettings] = useState(false);
  const [artPicker, setArtPicker] = useState<Game | null>(null);
  const [menu, setMenu] = useState<{ game: Game; x: number; y: number } | null>(
    null,
  );
  const [fpgaGameIds, setFpgaGameIds] = useState<Set<string>>(new Set());
  // Which games already have a patched copy on disk. Read from the provenance
  // records the patcher writes, so the badge reflects work that actually
  // happened rather than merely that a translation exists for the title.
  const [patched, setPatched] = useState<Map<string, TranslationProvenance>>(new Map());
  const detailsRef = useRef<HTMLDivElement>(null);
  const visiblePlatformGames = useMemo(() => games.filter((game) => platform === "All" || game.platform === platform), [platform]);
  const genres = useMemo(() => Array.from(new Set(visiblePlatformGames.flatMap((g) => g.genres))).sort(), [visiblePlatformGames]);
  const filtered = useMemo(
    () =>
      visiblePlatformGames
        .filter((g) => {
          const text =
            `${g.title} ${g.description} ${g.genres.join(" ")} ${g.facets.join(" ")}`.toLowerCase();
          return (
            (!query || text.includes(query.toLowerCase())) &&
            (region === "All regions" || g.region === region) &&
            (genre === "All genres" || g.genres.includes(genre)) &&
            !g.genres.some((item) => hiddenGenres.has(item)) &&
            (facet === "All flavors" || g.facets.includes(facet)) &&
            (!translation || !!g.translation) &&
            (!favoriteOnly || favorites.has(g.id))
          );
        })
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title)
            : sort === "year-new"
              ? b.year - a.year
              : sort === "year-old"
                ? a.year - b.year
                : 0,
        ),
    [visiblePlatformGames, query, region, genre, hiddenGenres, facet, translation, favoriteOnly, favorites, sort],
  );
  const groups = useMemo(() => {
    const rows: Game[][] = [];
    for (let i = 0; i < filtered.length; i += 6)
      rows.push(filtered.slice(i, i + 6));
    return rows;
  }, [filtered]);
  const toggleFav = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("gamestore:favorites", JSON.stringify([...next]));
      return next;
    });
  useEffect(() => {
    if (!selected) return;
    // `scrollIntoView()` measures a sticky header as ordinary flow content in
    // Chromium. On a tall detail pane that leaves the title and the top of the
    // cover beneath the global search bar. Measure the live header instead so
    // the expanded pane always starts in the visible workspace.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const detail = detailsRef.current;
        const header = document.querySelector("header");
        if (!detail) return;
        const headerHeight = header?.getBoundingClientRect().height ?? 0;
        window.scrollTo({
          top: Math.max(
            0,
            window.scrollY + detail.getBoundingClientRect().top - headerHeight - 18,
          ),
          behavior: "smooth",
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setSettings(false);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const catalog = games.map(({ id, title, coverName, platform }) => ({ id, title, coverName, platform: deviceFolderFor(platform) }));
    const loadInventory = () => window.gameStore?.getFpgaInventory(catalog).then((result) => {
      if (result?.status === "ready") setFpgaGameIds(new Set(result.gameIds));
    });
    void loadInventory();
    return window.gameStore?.onFpgaInventoryChanged(() => void loadInventory());
  }, []);
  useEffect(() => {
    const loadPatched = () =>
      window.gameStore
        ?.listTranslations()
        .then((applied) => setPatched(new Map(applied.map((entry) => [entry.gameId, entry]))));
    void loadPatched();
    return window.gameStore?.onLibraryChanged(() => void loadPatched());
  }, []);
  const reset = () => {
    setQuery("");
    setRegion("All regions");
    setGenre("All genres");
    setFacet("All flavors");
    setTranslation(false);
    setFavoriteOnly(false);
    setDeviceManager(false);
  };
  const browsing =
    !!query ||
    region !== "All regions" ||
    genre !== "All genres" ||
    facet !== "All flavors" ||
    translation ||
    favoriteOnly || hiddenGenres.size > 0 || platform !== "All";
  const toggleGenre = (value: string) => setHiddenGenres((previous) => {
    const next = new Set(previous);
    next.has(value) ? next.delete(value) : next.add(value);
    localStorage.setItem("gamestore:hidden-genres", JSON.stringify([...next]));
    return next;
  });
  return (
    <div className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside>
        <div className="brand">
          <div className="logo">
            <Gamepad2 />
          </div>
          <b>
            GAME<span>STORE</span>
          </b>
          <button className="sidebar-toggle" title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setSidebarCollapsed((current) => {
            localStorage.setItem("gamestore:sidebar-collapsed", String(!current));
            return !current;
          })}>{sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
        </div>
        <nav>
          <button className={!favoriteOnly && !deviceManager ? "active" : ""} onClick={reset} title="Discover">
            <Compass />
            Discover
          </button>
          <button onClick={() => { setDeviceManager(false); setPlatform("All"); }} title="Platforms">
            <Gamepad2 />
            Platforms
          </button>
          <button onClick={() => { setFavoriteOnly(false); setFacet("Surreal"); }}>
            <Sparkles />
            Weird Picks
          </button>
          <button onClick={() => { setFavoriteOnly(false); setTranslation(true); }}>
            <Library />
            Translations
          </button>
          <button
            className={favoriteOnly ? "active" : ""}
            onClick={() => setFavoriteOnly(true)}
          >
            <Heart />
            Favorites
          </button>
          <button className={deviceManager ? "active" : ""} onClick={() => setDeviceManager(true)} title="Manage MiSTer">
            <HardDrive />
            Manage MiSTer
          </button>
        </nav>
        <button className="settings-link" onClick={() => setSettings(true)} title="Settings">
          <Settings />
          Settings
        </button>
      </aside>
      <div className="workspace">
        <header>
          <div className="global-search">
            <Search />
            <input
              aria-label="Search games"
              placeholder="Search games, genres, moods…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button onClick={() => setQuery("")}>
                <X />
              </button>
            )}
          </div>
          <UpdaterButton />
          <LibraryCart />
        </header>
        <main>
          {deviceManager ? <MiSTerManager onOpenSettings={() => setSettings(true)} /> : <>
          <div className="platforms">
            <button className={platform === "All" ? "active" : ""} onClick={() => setPlatform("All")}>All</button>
            {PLATFORMS.map((definition) => <button key={definition.id} className={platform === definition.id ? "active" : ""} onClick={() => setPlatform(definition.id)}>{definition.shortLabel}</button>)}
            <button disabled>PS2</button>
            <button disabled>Dreamcast</button>
            <button disabled>GameCube</button>
            <button disabled>PSP</button>
            <span>PS1 preview catalog</span>
          </div>
          <div className="filters">
            <Settings2 />
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option>All regions</option>
              <option>USA</option>
              <option>Europe</option>
              <option>Japan</option>
            </select>
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option>All genres</option>
              {genres.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <div className="genre-exclusions">
              <button className={hiddenGenres.size ? "genre-button active" : "genre-button"} onClick={() => setGenreMenu((value) => !value)} aria-expanded={genreMenu}>
                {hiddenGenres.size ? `Hide ${hiddenGenres.size} genre${hiddenGenres.size === 1 ? "" : "s"}` : "Genres"} <ChevronDown />
              </button>
              {genreMenu && <div className="genre-popover">
                <div><b>Visible genres</b><button onClick={() => { setHiddenGenres(new Set()); localStorage.removeItem("gamestore:hidden-genres"); }}>Show all</button></div>
                {genres.map((item) => <label key={item}><input type="checkbox" checked={!hiddenGenres.has(item)} onChange={() => toggleGenre(item)} /> {item}</label>)}
              </div>}
            </div>
            <select value={facet} onChange={(e) => setFacet(e.target.value)}>
              <option>All flavors</option>
              {facetOrder.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <label className="check">
              <input
                type="checkbox"
                checked={translation}
                onChange={(e) => setTranslation(e.target.checked)}
              />{" "}
              English patch
            </label>
            <span className="spacer" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="curated">Sort: Recommended</option>
              <option value="title">Sort: Title</option>
              <option value="year-new">Sort: Newest</option>
              <option value="year-old">Sort: Oldest</option>
            </select>
          </div>
          {!browsing && <div className="curated-shelves">
            {curatedShelves.map((shelf) => (
              <section className="feature" key={shelf.title}>
                <div>
                  <p>CURATOR'S SHELF</p>
                  <h1>{shelf.title}</h1>
                  <span>{shelf.subtitle}</span>
                </div>
                <div className="feature-cards">
                  {shelf.ids
                    .map((id) => games.find((game) => game.id === id))
                    .filter((game): game is Game => !!game)
                    .map((game) => (
                      <MiniCover key={game.id} game={game} onClick={() => {
                        setSelected(game.id);
                        setFacet("All flavors");
                      }} />
                    ))}
                </div>
              </section>
            ))}
          </div>}
          <div className="catalog-head">
            <div>
              <h2>
                {favoriteOnly
                  ? `${filtered.length} favorite ${filtered.length === 1 ? "game" : "games"}`
                  : `${filtered.length} ${platform === "All" ? "catalog" : platformLabel(platform)} ${filtered.length === 1 ? "game" : "games"}`}
              </h2>
              <p>
                USA first · PAL fallback · Japan exclusives only with a reviewed English patch
              </p>
            </div>
            <Grid2X2 />
          </div>
          <div className="grid-wrap">
            {groups.map((row, ri) => (
              <div className="row" key={`${ri}-${row[0]?.id}`}>
                <div className="cards">
                  {row.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      selected={selected === game.id}
                      favorite={favorites.has(game.id)}
                      onFpga={fpgaGameIds.has(game.id)}
                      patched={patched.get(game.id)}
                      onFav={() => toggleFav(game.id)}
                      onOpen={() =>
                        setSelected(selected === game.id ? null : game.id)
                      }
                      onContextMenu={(x, y) => setMenu({ game, x, y })}
                    />
                  ))}
                </div>
                {row.some((g) => g.id === selected) && (
                  <Detail
                    ref={detailsRef}
                    game={row.find((g) => g.id === selected)!}
                    favorite={favorites.has(selected!)}
                    onFav={() => toggleFav(selected!)}
                    onClose={() => setSelected(null)}
                    onFindArt={() =>
                      setArtPicker(row.find((g) => g.id === selected)!)
                    }
                  />
                )}
              </div>
            ))}
            {!filtered.length && (
              <div className="empty">
                {favoriteOnly ? <Heart /> : <Sparkles />}
                <h2>
                  {favoriteOnly ? "No favorite games yet." : "Nothing in this corner."}
                </h2>
                <p>
                  {favoriteOnly
                    ? "Use the heart on any game to build your shelf."
                    : "Try a broader search or reset the active filters."}
                </p>
                <button onClick={reset}>
                  {favoriteOnly ? "Explore the catalog" : "Clear filters"}
                </button>
              </div>
            )}
          </div>
          </>}
        </main>
        <footer>
          <b>GameStore 0.18.0</b>
          <ArtworkStatus />
        </footer>
      </div>
      {settings && (
        <ProviderSettings
          favorites={favorites}
          onClose={() => setSettings(false)}
        />
      )}
      {artPicker && (
        <ArtPicker game={artPicker} onClose={() => setArtPicker(null)} />
      )}
      {menu && (
        <GameMenu
          game={menu.game}
          x={menu.x}
          y={menu.y}
          favorite={favorites.has(menu.game.id)}
          onClose={() => setMenu(null)}
          onOpen={() => setSelected(menu.game.id)}
          onFav={() => toggleFav(menu.game.id)}
          onFindArt={() => setArtPicker(menu.game)}
        />
      )}
    </div>
  );
}

/** Footer readout of how much of the catalog resolved automatically. */
function ArtworkStatus() {
  const { indexes, unmatched, resolvable, resolving, refreshIndex } =
    useArtwork();
  const states = PLATFORMS.map((platform) => indexes[platform.id]).filter(
    (state) => state.status !== "idle",
  );
  const scans = states.reduce((total, state) => total + state.files.length, 0);
  if (states.length && states.every((state) => state.status === "loading"))
    return (
      <span>
        <LoaderCircle className="spin" /> Matching box art…
      </span>
    );
  // One console's pack being unreachable is reported without hiding the
  // consoles that did resolve, which a single shared index could not express.
  const failed = PLATFORMS.filter(
    (platform) => indexes[platform.id].status === "error",
  );
  if (failed.length === states.length && failed.length)
    return (
      <span className="warn">
        Artwork index unavailable · {indexes[failed[0].id].message}
      </span>
    );
  // Seeded covers land at once; the fuzzy tail fills in behind this readout.
  if (resolving)
    return (
      <span>
        <LoaderCircle className="spin" /> {resolvable - unmatched}/{resolvable}{" "}
        covers matched · still searching the rest
      </span>
    );
  return (
    <span>
      {resolvable - unmatched}/{resolvable} covers matched from{" "}
      {scans.toLocaleString()} Libretro scans · right-click a game for
      alternates
      {failed.length > 0 && (
        <span className="warn">
          {" "}
          · {failed.map((platform) => platform.shortLabel).join(", ")} artwork
          unavailable
        </span>
      )}
      <button className="link" onClick={() => void refreshIndex()}>
        <RefreshCw /> Refresh
      </button>
    </span>
  );
}

/** Right-click menu: the entry point Omid asked for on every card. */
function GameMenu({
  game,
  x,
  y,
  favorite,
  onClose,
  onOpen,
  onFav,
  onFindArt,
}: {
  game: Game;
  x: number;
  y: number;
  favorite: boolean;
  onClose: () => void;
  onOpen: () => void;
  onFav: () => void;
  onFindArt: () => void;
}) {
  const artwork = useArtwork();
  const match = artwork.autoMatch(game);
  const manual = artwork.hasOverride(game);
  useEffect(() => {
    const dismiss = () => onClose();
    addEventListener("mousedown", dismiss);
    addEventListener("resize", dismiss);
    addEventListener("scroll", dismiss, true);
    return () => {
      removeEventListener("mousedown", dismiss);
      removeEventListener("resize", dismiss);
      removeEventListener("scroll", dismiss, true);
    };
  }, [onClose]);
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  return (
    <div
      className="context-menu"
      style={{
        left: Math.min(x, innerWidth - 280),
        top: Math.min(y, innerHeight - 210),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <p>{game.title}</p>
      <button onClick={run(onOpen)}>
        <ChevronDown /> Open details
      </button>
      <button onClick={run(onFindArt)}>
        <Image /> Search alternate box art…
      </button>
      <button
        disabled={!manual}
        onClick={run(() => artwork.clearOverride(game))}
      >
        <RotateCcw /> Reset to automatic match
      </button>
      <button onClick={run(onFav)}>
        <Heart fill={favorite ? "currentColor" : "none"} />
        {favorite ? "Remove favorite" : "Add favorite"}
      </button>
      <small>
        {manual
          ? "Using your chosen artwork"
          : match
            ? `Auto match · ${match.confidence} confidence · ${match.label}`
            : "No confident automatic match yet"}
      </small>
    </div>
  );
}

/**
 * Latches true once the element first comes near the viewport. Cover resolution
 * has to be gated on this: the catalog mounts every card at once, so resolving
 * on mount would pull the whole library on first launch instead of the handful
 * of covers actually being looked at. The margin resolves a screen or two ahead
 * so covers are already there by the time a scroll reaches them.
 */
function useNearViewport<T extends Element>(rootMargin = "800px") {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, rootMargin]);
  return [ref, near] as const;
}

/**
 * Resolves a cover to its locally downscaled copy, caching it on first sight.
 * A cache failure falls back to the remote original, so this can cost bandwidth
 * but never costs a visible cover. The detail view opts out and keeps the
 * full-resolution original, which is the one place the extra pixels show.
 */
function useCachedCover(url: string | undefined, full: boolean, active: boolean) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  // One effect owns every transition, including clearing a stale cover. Split
  // across two, the reset runs after the resolve on mount and blanks the result.
  useEffect(() => {
    if (!url || !active) {
      setSrc(undefined);
      return;
    }
    if (full || !window.gameStore) {
      setSrc(url);
      return;
    }
    let live = true;
    void window.gameStore
      .cacheCover(url)
      .then((cached) => {
        if (live) setSrc(cached ?? url);
      })
      .catch(() => {
        if (live) setSrc(url);
      });
    return () => {
      live = false;
    };
  }, [url, full, active]);
  return src;
}

function CoverImage({ game, full = false }: { game: Game; full?: boolean }) {
  const [bad, setBad] = useState(false);
  const [ratio, setRatio] = useState("1 / 1");
  const { url } = useArtwork().artFor(game);
  const [frameRef, near] = useNearViewport<HTMLDivElement>();
  const src = useCachedCover(url, full, full || near);
  useEffect(() => setBad(false), [src]);
  // A cover still being resolved shows an empty frame rather than the
  // no-match message, which would otherwise flash on every card while scrolling.
  const pending = !!url && !src && !bad;
  return (
    <div className="art-frame" ref={frameRef} style={{ aspectRatio: ratio }}>
      {src && !bad ? (
        <img
          key={src}
          src={src}
          alt={`${game.title} release cover`}
          loading="lazy"
          decoding="async"
          onLoad={(e) =>
            setRatio(
              `${e.currentTarget.naturalWidth} / ${e.currentTarget.naturalHeight}`,
            )
          }
          onError={() => setBad(true)}
        />
      ) : pending ? null : (
        <div className="cover-fallback">
          <Gamepad2 />
          <b>{game.title}</b>
          <small>{bad ? "ART FAILED TO LOAD" : "NO CONFIDENT MATCH"}</small>
        </div>
      )}
    </div>
  );
}
/**
 * Applying a fan translation, end to end, inside the app.
 *
 * The two halves are deliberately asymmetric. Finding the patch stays a manual
 * step with a real link, because ROMhacking.net closed and the communities that
 * replaced it publish no API and ask not to be crawled. Everything after the
 * download is automatic: identify the disc, prove it is the one the patch was
 * built for, write a separate copy, and record what happened.
 *
 * The panel leads with which disc is expected rather than with a button. A
 * translation patch applied to a near-miss dump produces a broken game and no
 * error, so the release the patch wants is the most useful thing on screen.
 */
function TranslationPanel({ game }: { game: Game }) {
  const entry = translationFor(game.id);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceFromLibrary, setSourceFromLibrary] = useState(false);
  const [patchPath, setPatchPath] = useState<string | null>(null);
  const [patchDownloaded, setPatchDownloaded] = useState(false);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<TranslationProvenance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const desktop = Boolean(window.gameStore?.applyTranslation);
  const target = entry?.target ?? undefined;
  const fileName = (value: string) => value.split(/[\\/]/).pop() ?? value;

  // Without this the panel forgot: a game patched last week reopened offering
  // to patch it again, with nothing on screen saying it was already done.
  useEffect(() => {
    if (!desktop) return;
    void window.gameStore!
      .listTranslations()
      .then((list) => setApplied(list.find((record) => record.gameId === game.id) ?? null));
  }, [desktop, game.id]);

  useEffect(() => {
    if (!desktop) return;
    void window.gameStore!.findTranslationSource(game.title).then((source) => {
      if (source) {
        setSourcePath(source);
        setSourceFromLibrary(true);
      }
    });
    const stopReady = window.gameStore!.onTranslationPatchReady((payload) => {
      if (payload.gameId === game.id) {
        setPatchPath(payload.path);
        setPatchDownloaded(true);
        setError(null);
      }
    });
    const stopError = window.gameStore!.onTranslationPatchError((payload) => {
      if (payload.gameId === game.id) setError(payload.message);
    });
    return () => { stopReady(); stopError(); };
  }, [desktop, game.id, game.title]);

  const pick = async (kind: "image" | "patch") => {
    const picked = await window.gameStore?.pickTranslationFile(kind, game.title);
    if (!picked) return;
    setError(null);
    if (kind === "image") {
      setSourcePath(picked);
      setSourceFromLibrary(false);
    } else {
      setPatchPath(picked);
      setPatchDownloaded(false);
    }
  };

  const apply = async () => {
    if (!sourcePath || !patchPath || !target) return;
    setBusy(true);
    setError(null);
    try {
      setApplied(await window.gameStore!.applyTranslation({
        gameId: game.id,
        title: game.title,
        sourcePath,
        patchPath,
        // The translated copy keeps the original release filename so the
        // artwork scraper and the MiSTer export both still recognise it.
        outputName: target.track,
        target,
        expectedPatchSha256: entry?.record.patch.sha256,
        expectedOutputSha1: entry?.record.patch.outputSha1,
        team: entry?.record.team,
        allowUnverifiedSource: override,
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '.*?': /, "") : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="translation-panel">
      <h4>English translation</h4>
      <p className="translation-team">
        {game.translation!.team} · {game.translation!.status}
      </p>
      {entry ? (
        <p className="translation-target">
          Applies to <b>{entry.record.target.release}</b> ({entry.record.target.serial})
          {target ? ` · ${target.size.toLocaleString()} bytes · SHA-1 ${target.sha1.slice(0, 12)}…` : ""}
        </p>
      ) : (
        <p className="translation-target unverified">
          No verified release is recorded for this patch yet, so the disc image cannot be checked.
        </p>
      )}
      {entry && !entry.record.target.targetVerified && (
        <p className="translation-warning">
          Which release this patch expects has not been confirmed. GameStore will still refuse any
          image that is not the one named above.
        </p>
      )}
      {entry?.record.notes && <p className="translation-note">{entry.record.notes}</p>}
      <p className="translation-note">
        romhack.ing may show a short slider after <b>Get downloads</b>. Complete it there; when the real
        file begins, GameStore saves, extracts, selects, and closes this window automatically.
      </p>
      <button className="patch-button" onClick={() => {
        const url = entry?.record.page ?? game.translation!.url;
        if (desktop && entry) {
          void window.gameStore!.browseTranslationPatch({
            gameId: game.id,
            title: game.title,
            url,
            expectedFile: entry.record.patch.file,
            container: entry.record.patch.container,
          }).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
        } else open(url);
      }}>
        Browse and download patch <ExternalLink />
      </button>
      {desktop ? (
        <>
          <div className="translation-files">
            <button onClick={() => void pick("image")}>
              {sourcePath ? `${fileName(sourcePath)}${sourceFromLibrary ? " · from your GameStore library" : ""}` : "Original disc not in your GameStore cart…"}
            </button>
            <button onClick={() => void pick("patch")}>
              {patchPath ? `${fileName(patchPath)}${patchDownloaded ? " · downloaded by GameStore" : ""}` : "Download a patch above, or choose one…"}
            </button>
          </div>
          {error && (
            <>
              <p className="translation-error">{error}</p>
              {/^A (PPF|IPS) patch carries no checksum/.test(error) && (
                <label className="translation-override">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Apply anyway and record that this image was never verified
                </label>
              )}
            </>
          )}
          {applied ? (
            <div className="translation-done">
              <p>
                <b>Patched and ready.</b> {applied.output.file} · {new Date(applied.appliedAt).toLocaleDateString()}
                {applied.team ? ` · ${applied.team}` : ""}
              </p>
              <p className="translation-provenance">
                {applied.unverifiedSourceAccepted
                  ? "The source image could not be verified and you chose to apply anyway."
                  : `Source verified by ${applied.verification}.`}{" "}
                Your original image is untouched, and the copy is queued in the MiSTer cart.
              </p>
              <button className="patch-button" onClick={() => void apply()} disabled={!sourcePath || !patchPath || busy}>
                {busy ? "Applying…" : "Patch again"}
              </button>
            </div>
          ) : (
            <button
              className="patch-button primary"
              disabled={!sourcePath || !patchPath || !target || busy}
              onClick={() => void apply()}
            >
              {busy ? "Applying…" : "Apply patch to a copy"}
            </button>
          )}
        </>
      ) : (
        <p className="translation-note">Patching runs in the desktop app.</p>
      )}
    </section>
  );
}
function MiniCover({ game, onClick }: { game: Game; onClick: () => void }) {
  return (
    <button className="mini-cover" onClick={onClick}>
      <CoverImage game={game} />
      <span>{game.title}</span>
    </button>
  );
}
function GameCard({
  game,
  selected,
  favorite,
  onFpga,
  patched,
  onFav,
  onOpen,
  onContextMenu,
}: {
  game: Game;
  selected: boolean;
  favorite: boolean;
  onFpga: boolean;
  patched?: TranslationProvenance;
  onFav: () => void;
  onOpen: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const art = useArtwork().artFor(game);
  return (
    <article
      className={`card ${selected ? "selected" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      title={
        art.manual
          ? "Your chosen artwork · right-click to change"
          : "Right-click for alternate box art"
      }
    >
      <button className="cover" onClick={onOpen} aria-expanded={selected}>
        <CoverImage game={game} />
        <span className="region">
          {game.region === "Europe"
            ? "PAL"
            : game.region === "USA"
              ? "US"
              : "JP"}
        </span>
        {/*
          * Two different facts that used to look identical: a translation
          * existing for this title, and one having actually been applied to a
          * copy on disk. The applied state wins and reads as done.
          */}
        {patched ? (
          <span
            className="translated done"
            title={`Patched ${new Date(patched.appliedAt).toLocaleDateString()}${patched.team ? ` · ${patched.team}` : ""}`}
          >
            PATCHED
          </span>
        ) : (
          game.translation && <span className="translated">EN PATCH</span>
        )}
        {onFpga && (
          <span className="fpga-library" title="Already found in your connected MiSTer / SuperStation library" aria-label="Already in connected MiSTer or SuperStation library">
            <HardDrive />
          </span>
        )}
        {art.confidence === "low" && (
          <span className="art-flag">CHECK ART</span>
        )}
        <i>
          <ChevronDown />
        </i>
      </button>
      <div className="card-title">
        <div>
          <h3>{game.title}</h3>
          <p>{metaLine(game)}</p>
        </div>
        <button
          aria-label={favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          className={favorite ? "fav active" : "fav"}
          onClick={onFav}
        >
          <Heart fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
    </article>
  );
}

const Detail = forwardRef<
  HTMLDivElement,
  {
    game: Game;
    favorite: boolean;
    onFav: () => void;
    onClose: () => void;
    onFindArt: () => void;
  }
>(({ game, favorite, onFav, onClose, onFindArt }, ref) => {
  const artwork = useArtwork();
  const art = artwork.artFor(game);
  const [transfer, setTransfer] = useState<{
    state: "idle" | "copying" | "done" | "error";
    percent?: number;
    message?: string;
  }>({ state: "idle" });
  useEffect(
    () =>
      window.gameStore?.onFpgaProgress((p) =>
        setTransfer({
          state: "copying",
          percent: p.percent,
          message: `${p.file} · ${p.percent}%`,
        }),
      ),
    [],
  );
  const sendToFpga = async () => {
    setTransfer({
      state: "copying",
      percent: 0,
      message: "Choose the CHD or complete BIN/CUE set…",
    });
    try {
      if (!window.gameStore)
        throw new Error("Network transfer is available in the desktop app.");
      const result = await window.gameStore.transferToFpga(game.title);
      if (result.canceled) setTransfer({ state: "idle" });
      else
        setTransfer({
          state: "done",
          percent: 100,
          message: `Copied ${result.files} file${result.files === 1 ? "" : "s"} to ${result.remoteDir}`,
        });
    } catch (e) {
      setTransfer({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };
  return (
    <div className="detail" ref={ref}>
      <div className="detail-top">
        <div>
          <p className="eyebrow">
            {[game.region, "PLAYSTATION", game.year || null].filter(Boolean).join(" · ")}
          </p>
          <h2>{game.title}</h2>
          <div className="tags">
            {[...game.genres, ...game.facets].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
        </div>
        <div className="detail-actions">
          <button className={favorite ? "active" : ""} onClick={onFav}>
            <Heart fill={favorite ? "currentColor" : "none"} />
            {favorite ? "Saved" : "Favorite"}
          </button>
          <button
            disabled={transfer.state === "copying"}
            onClick={sendToFpga}
            title="Pick local files and copy them to the device now"
          >
            <HardDriveUpload />
            {transfer.state === "copying"
              ? `Sending ${transfer.percent ?? 0}%`
              : "Send files"}
          </button>
          <button onClick={onClose}>
            <X />
            Close
          </button>
        </div>
      </div>
      {transfer.state !== "idle" && (
        <div className={`transfer-status ${transfer.state}`}>
          <i>
            <b style={{ width: `${transfer.percent ?? 0}%` }} />
          </i>
          <span>{transfer.message}</span>
        </div>
      )}
      {/*
        The right rail used to carry the description, the metadata list, every
        acquisition control and every outbound link stacked in one narrow
        column beside the media. Reading a game meant reading a gutter. The
        cover column now owns the game's identity — art, then its description
        and facts directly beneath it — and the media column owns everything
        that moves.
      */}
      <div className="detail-body">
        <aside className="detail-side">
          <div className="detail-art">
            {/* The one place the full-resolution original is worth its weight. */}
            <CoverImage game={game} full />
          </div>
          {game.description ? (
            <>
              <p className="description">{game.description}</p>
              {game.descriptionSource && (
                <button className="description-source" onClick={() => open(game.descriptionSource!.url)}>
                  <ExternalLink /> {game.descriptionSource.label}
                </button>
              )}
            </>
          ) : (
            <p className="description unavailable">No source-backed description is available yet.</p>
          )}
          <dl>
            <div>
              <dt>Developer</dt>
              <dd>{game.developer}</dd>
            </div>
            {game.publisher && (
              <div>
                <dt>Publisher</dt>
                <dd>{game.publisher}</dd>
              </div>
            )}
            <div>
              <dt>Players</dt>
              <dd>{game.players}</dd>
            </div>
            {game.rating && (
              <div>
                <dt>Rating</dt>
                <dd>
                  {game.rating.score.toFixed(1)} / 5
                  {game.rating.count ? ` · ${game.rating.count} votes` : ""}
                </dd>
              </div>
            )}
            {game.esrb && (
              <div>
                <dt>ESRB</dt>
                <dd>{game.esrb}</dd>
              </div>
            )}
            <div>
              <dt>Language</dt>
              <dd>
                {game.translation ? "English fan patch" : "Official English"}
              </dd>
            </div>
            <div>
              <dt>Release</dt>
              <dd>{[game.region, game.year || null].filter(Boolean).join(" · ")}</dd>
            </div>
          </dl>
          {game.translation && <TranslationPanel game={game} />}
          <details className="side-more">
            <summary>Artwork and sources</summary>
            <button onClick={onFindArt}>
              <Image /> Search alternate box art
            </button>
            {artwork.hasOverride(game) && (
              <button
                className="ghost"
                onClick={() => artwork.clearOverride(game)}
              >
                <RotateCcw /> Reset to automatic
              </button>
            )}
            <small>
              {art.source}
              {art.confidence ? ` · ${art.confidence} confidence` : ""}
              {art.variant ? ` · ${art.variant}` : ""}
            </small>
            <div className="links content-links">
              {game.links.map((l) => (
                <button key={l.url} onClick={() => open(l.url)}>
                  <i className={l.state} />
                  {l.label}
                  <span>{l.state}</span>
                  <ExternalLink />
                </button>
              ))}
            </div>
          </details>
        </aside>
        <section className="detail-media">
          <Acquisition game={game} />
          <MediaGallery game={game} />
        </section>
      </div>
    </div>
  );
});

function Acquisition({ game }: { game: Game }) {
  const [openPanel, setOpenPanel] = useState(false);
  const [provider, setProvider] = useState<"realdebrid" | "torbox">("realdebrid");
  const [link, setLink] = useState("");
  const [state, setState] = useState<{ status: "idle" | "downloading" | "done" | "error"; percent?: number; message?: string; stage?: "preparing" | "downloading" }>({ status: "idle" });
  const [sending, setSending] = useState(false);
  const [candidates, setCandidates] = useState<CollectionCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(
    () =>
      window.gameStore?.onGameDownloadProgress((progress) => {
        if (progress.gameTitle === game.title)
          setState({
            status: "downloading",
            percent: progress.percent,
            stage: progress.stage,
            message: progress.message || `${progress.filename} · ${formatBytes(progress.bytes)}${progress.total ? ` / ${formatBytes(progress.total)}` : ""}`,
          });
      }),
    [game.title],
  );
  const download = async () => {
    if (!link.trim() || !window.gameStore) return;
    setState({ status: "downloading", percent: 0, message: "Resolving provider link…" });
    try {
      const result = await window.gameStore.downloadGame(provider, link.trim(), game.title, game.platform);
      setState({ status: "done", percent: 100, message: `Ready and added to the MiSTer cart · ${result.directory}` });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  /**
   * Add to Cart is one action. The collection is already indexed — indexing
   * happens once, when the source is saved in Settings — so this reads a stored
   * manifest and offers the releases of *this* game that are actually worth
   * choosing between: its own region, a World release, or an English
   * translation of an import. Everything else in the collection stays out of
   * the way. When exactly one release qualifies there is nothing to choose, so
   * it is taken directly.
   */
  const addToCart = async () => {
    setSearching(true);
    setState({ status: "idle" });
    setCandidates([]);
    try {
      const found = await window.gameStore!.searchCollections(game.title, game.region, game.platform);
      if (!found.length)
        setState({
          status: "error",
          message:
            "No release of this game was found in your indexed collections. Add or re-index a source in Settings.",
        });
      else if (found.length === 1) await take(found[0]);
      else setCandidates(found);
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSearching(false);
    }
  };
  const take = async (candidate: CollectionCandidate) => {
    setCandidates([]);
    setState({ status: "downloading", stage: "preparing", percent: 0, message: `Preparing ${candidate.path.split("/").pop()}…` });
    try {
      const result = await window.gameStore!.downloadCollectionSelection(
        candidate.sourceUrl,
        [candidate.path],
        game.title,
        game.platform,
      );
      setState({
        status: "done",
        percent: 100,
        message: `In your MiSTer cart · ${result.directory}`,
      });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  const busy = searching || state.status === "downloading";
  return (
    <section className="acquisition">
      <div className="acquisition-bar">
        <button className="add-to-cart" disabled={busy} onClick={addToCart}>
          <ShoppingCart />
          {searching
            ? "Finding releases…"
            : state.status === "downloading"
              ? state.stage === "preparing"
                ? "Preparing download…"
                : `Downloading ${state.percent ?? 0}%`
              : state.status === "done"
                ? "In cart · add again"
                : "Add to cart"}
        </button>
        <button className="ghost" onClick={() => setOpenPanel(!openPanel)}>
          <Download /> {openPanel ? "Hide direct link" : "Paste a link"}
        </button>
        <button
          className="ghost"
          onClick={() => open(`https://retrogametalk.com/repo/?s=${encodeURIComponent(game.title)}`)}
        >
          <Search /> Search the web <ExternalLink />
        </button>
      </div>
      {!!candidates.length && (
        <div className="collection-candidates">
          <p>Choose a release</p>
          {candidates.map((candidate) => (
            <button key={`${candidate.sourceUrl}:${candidate.path}`} onClick={() => void take(candidate)}>
              <b>{candidate.variant.label}</b>
              <em>{candidate.path.split("/").pop()}</em>
              <span>
                {candidate.collection} · {formatBytes(candidate.bytes)} ·{" "}
                {Math.round(candidate.score * 100)}% match
              </span>
            </button>
          ))}
        </div>
      )}
      {openPanel && <div className="acquisition-form">
        <select value={provider} onChange={(e) => setProvider(e.target.value as "realdebrid" | "torbox")}>
          <option value="realdebrid">Real-Debrid</option>
          <option value="torbox">TorBox</option>
        </select>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a supported host link or magnet" />
        <button disabled={!link.trim() || state.status === "downloading"} onClick={download}>
          {state.status === "downloading" ? state.stage === "preparing" ? "Preparing download…" : `Downloading ${state.percent ?? 0}%` : "Resolve & download"}
        </button>
      </div>}
      {state.status !== "idle" && <div className={`transfer-status ${state.status}`}>
        <i><b style={{ width: `${state.percent ?? 0}%` }} /></i>
        <span>{state.message}</span>
      </div>}
      {state.status === "done" && <button className="source-fallback" disabled={sending} onClick={async () => {
        setSending(true);
        try {
          const result = await window.gameStore!.transferLibraryToFpga(game.title);
          setState({ status: "done", percent: 100, message: `Downloaded and copied to ${result.remoteDir}` });
        } catch (e) {
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
        } finally { setSending(false); }
      }}><HardDriveUpload /> {sending ? "Sending…" : "Send this game to SuperStation / MiSTer now"}</button>}
    </section>
  );
}

function MiSTerManager({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [device, setDevice] = useState<DeviceLibrary | null>(null);
  const [status, setStatus] = useState("Loading your MiSTer library…");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setStatus("Checking game folders and BIOS files…");
    try { const result = await window.gameStore?.getFpgaDeviceLibrary(); if (!result) throw new Error("Open GameStore on your desktop to manage MiSTer files."); setDevice(result); setStatus(`Connected to ${result.host}`); }
    catch (error) { setDevice(null); setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const install = async (platform: DeviceFolderId) => {
    setBusy(true); setStatus(`Installing ${platform} BIOS files from Update All’s configured BIOS Database…`);
    try { await window.gameStore!.installFpgaBios(platform); await load(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); setBusy(false); }
  };
  return <section className="mister-manager">
    <div className="mister-heading"><div><p className="eyebrow">DEVICE LIBRARY</p><h1>Manage MiSTer</h1><p>What is actually on the device, plus the system files each exposed console needs.</p></div><button className="export" onClick={() => void load()} disabled={busy}><RefreshCw className={busy ? "spin" : ""} /> Refresh</button></div>
    {!device ? <div className="device-empty"><HardDrive /><h2>MiSTer unavailable</h2><p>{status}</p><button onClick={onOpenSettings}>Open device settings</button></div> : <>
      <p className="device-status">{status}</p>
      <div className="bios-grid">
        {device.bios.map((bios) => <section className={bios.ready ? "bios-card ready" : "bios-card"} key={bios.platform}>
          <div><b>{deviceFolderLabel(bios.platform)}</b><span>{bios.ready ? "BIOS ready" : "BIOS needed"}</span></div>
          <p>{bios.files.filter((file) => file.present).length}/{bios.files.length} Update All BIOS Database files present</p>
          {!bios.ready && <button disabled={busy} onClick={() => void install(bios.platform)}>Install verified BIOS files</button>}
        </section>)}
      </div>
      <div className="device-library-grid">
        {PLATFORMS.map((definition) => definition.deviceFolder).map((platform) => <section className="device-console" key={platform}>
          <div><h2>{deviceFolderLabel(platform)}</h2><span>{(device.folders[platform] ?? []).length} installed</span></div>
          {!(device.folders[platform] ?? []).length ? <p>No managed games on this console yet.</p> : <ul>{(device.folders[platform] ?? []).map((folder) => <li key={folder}><span>{folder}</span><button disabled={busy} title="Remove this game from MiSTer" onClick={async () => {
            if (!confirm(`Remove “${folder}” from your MiSTer? The local GameStore library will stay intact.`)) return;
            setBusy(true); try { await window.gameStore!.deleteFpgaDeviceGame(platform, folder); await load(); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); setBusy(false); }
          }}><Trash2 /></button></li>)}</ul>}
        </section>)}
      </div>
    </>}
  </section>;
}

function LibraryCart() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [openCart, setOpenCart] = useState(false);
  const [checkout, setCheckout] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const refresh = async () => setItems((await window.gameStore?.getLibraryCart()) ?? []);
  useEffect(() => {
    void refresh();
    return window.gameStore?.onLibraryChanged(() => void refresh());
  }, []);
  if (!window.gameStore) return null;
  return (
    <div className="library-cart">
      <button className={items.length ? "cart-button ready" : "cart-button"} onClick={() => setOpenCart(!openCart)}>
        <ShoppingCart /> MiSTer cart <b>{items.length}</b>
      </button>
      {openCart && <div className="cart-popover">
        <div className="cart-heading">
          <div><small>MANAGED TRANSFER QUEUE</small><h3>Ready for MiSTer</h3></div>
          <button aria-label="Close MiSTer cart" onClick={() => setOpenCart(false)}><X /></button>
        </div>
        {!items.length ? <div className="cart-empty"><ShoppingCart /><p>Downloaded games will appear here automatically.</p></div> : <>
          <div className="cart-items">
            {items.map((item) => <div className="cart-item" key={item.id}>
              <div>
                <b>{item.title}{item.translated && <em className="cart-patched" title={item.translated.team ? `Patched with ${item.translated.team}` : "Translated copy"}>PATCHED</em>}</b>
                <span>
                  {item.platform} · {item.files.length} managed {item.files.length === 1 ? "file" : "files"}
                  {item.translated ? " · English copy, original untouched" : ""}
                </span>
              </div>
              <button aria-label={`Remove ${item.title} from MiSTer cart`} title="Keep files, remove from cart" onClick={() => void window.gameStore!.removeLibraryCartItem(item.id)}><X /></button>
            </div>)}
          </div>
          <button className="checkout" disabled={checkout === "sending"} onClick={async () => {
            setCheckout("sending"); setMessage("Connecting and sending the full cart…");
            try {
              const result = await window.gameStore!.checkoutLibraryCart();
              setCheckout("done"); setMessage(`Sent ${result.items} ${result.items === 1 ? "game" : "games"} · ${result.files} ${result.files === 1 ? "file" : "files"}`);
            } catch (error) {
              setCheckout("error"); setMessage(error instanceof Error ? error.message : String(error));
            }
          }}><HardDriveUpload /> {checkout === "sending" ? "Sending cart…" : `Send all ${items.length} to MiSTer`}</button>
        </>}
        {message && <p className={`cart-message ${checkout}`}>{message}</p>}
        <small className="cart-footnote">Files stay in your managed library after checkout.</small>
      </div>}
    </div>
  );
}

function ProviderSettings({
  favorites,
  onClose,
}: {
  favorites: Set<string>;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"general" | "downloads" | "media" | "device">("general");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [exported, setExported] = useState(false);
  const [test, setTest] = useState("");
  const [debrid, setDebrid] = useState({ realdebrid: "", torbox: "" });
  const [emu, setEmu] = useState({ username: "", password: "" });
  const [emuState, setEmuState] = useState<EmuMoviesSettings | null>(null);
  const [emuStatus, setEmuStatus] = useState("");
  const [emuBusy, setEmuBusy] = useState(false);
  const [emuSystem, setEmuSystem] = useState("PS1");
  const [scrapeDialog, setScrapeDialog] = useState(false);
  const [skipExistingMedia, setSkipExistingMedia] = useState(() =>
    localStorage.getItem("gamestore:scraping:skip-existing") !== "false",
  );
  const [debridState, setDebridState] = useState<{ hasRealDebrid: boolean; hasTorBox: boolean; collections: CollectionSource[] }>({ hasRealDebrid: false, hasTorBox: false, collections: [] });
  /**
   * One collection torrent URL per console, keyed by platform. This was a
   * single PS1-labelled field even though the backend has always stored a list
   * with a `platform` on each entry, so there was nowhere to put an N64 source
   * — and saving one would have replaced the PlayStation one rather than
   * adding to it. Every console in the registry now gets its own slot.
   */
  const [collectionUrls, setCollectionUrls] = useState<Record<string, string>>({});
  const [indexing, setIndexing] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<NetworkCandidate[]>([]);
  const [scan, setScan] = useState("");
  const [cache, setCache] = useState<MediaCacheStats | null>(null);
  const [device, setDevice] = useState({
    host: "MiSTer.local",
    deviceName: "MiSTer.local",
    port: 22,
    username: "root",
    password: "",
    root: "/media/fat/games",
    recognized: false,
  });
  const [locating, setLocating] = useState("");
  useEffect(() => {
    window.gameStore?.getTheGamesDbKey().then(setKey);
    window.gameStore
      ?.getFpgaSettings()
      .then((f) => f && setDevice((d) => ({ ...d, ...f, password: "" })));
    window.gameStore?.getMediaCacheStats().then(setCache);
    window.gameStore?.getDebridSettings().then((state) => {
      setDebridState(state);
      setCollectionUrls(
        Object.fromEntries(
          state.collections.map((source) => [source.platform, source.url]),
        ),
      );
    });
    window.gameStore?.getEmuMoviesSettings().then((state) => {
      setEmuState(state);
      setEmu((current) => ({ ...current, username: state.username }));
    });
    const stopProgress = window.gameStore?.onFpgaDiscoveryProgress(({ done, total }) =>
      setScan(`Scanning local network · ${done}/${total}`),
    );
    const stopLocating = window.gameStore?.onFpgaLocating(({ stage }) => setLocating(stage));
    const stopMoved = window.gameStore?.onFpgaAddressChanged(({ host }) => {
      setDevice((d) => ({ ...d, host }));
      setLocating("");
      setScan(`Your device moved to ${host} — GameStore found it and saved the new address.`);
    });
    return () => { stopProgress?.(); stopLocating?.(); stopMoved?.(); };
  }, []);
  const configuredCollections = (): CollectionSource[] =>
    PLATFORMS.flatMap((platform) => {
      const url = (collectionUrls[platform.id] ?? "").trim();
      if (!url) return [];
      const existing = debridState.collections.find(
        (source) => source.platform === platform.id,
      );
      return [{
        name: existing?.name ?? `${platform.shortLabel} collection`,
        url,
        platform: platform.id,
      }];
    });

  /** Saving persists settings only. Collection indexing is an explicit per-console action. */
  const save = async () => {
    await window.gameStore?.setTheGamesDbKey(key);
    await window.gameStore?.setFpgaSettings(device);
    const collections = configuredCollections();
    setDebridState(
      (await window.gameStore?.setDebridSettings({ ...debrid, collections })) ??
        debridState,
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const indexCollection = async (platformId: PlatformId) => {
    const collections = configuredCollections();
    const source = collections.find((candidate) => candidate.platform === platformId);
    if (!source) return;
    setIndexing((current) => ({ ...current, [platformId]: `Indexing ${source.name}…` }));
    try {
      const nextState = await window.gameStore!.setDebridSettings({ ...debrid, collections });
      setDebridState(nextState);
      const result = await window.gameStore!.indexCollection(source);
      setIndexing((current) => ({
        ...current,
        [platformId]: `${result.files.toLocaleString()} files indexed`,
      }));
    } catch (error) {
      setIndexing((current) => ({
        ...current,
        [platformId]: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  /** Authentication is intentionally separate from console media discovery. */
  const loginEmuMovies = async () => {
    setEmuBusy(true);
    setEmuStatus("Connecting to EmuMovies…");
    // Sign-in scans the member's folder tree, so the main process reports each
    // stage. Without it a normal multi-stage scan is indistinguishable from a
    // hang, which is exactly how the single frozen status used to read.
    const stopProgress = window.gameStore!.onEmuMoviesProgress(setEmuStatus);
    try {
      const probe = await window.gameStore!.loginEmuMovies(emu);
      setEmuStatus(probe.message);
      if (!probe.ok) return;
      setEmu((current) => ({ ...current, password: "" }));
      setEmuState(await window.gameStore!.getEmuMoviesSettings());
    } catch (error) {
      setEmuStatus(error instanceof Error ? error.message : String(error));
    } finally {
      stopProgress();
      setEmuBusy(false);
    }
  };
  const indexEmuMovies = async () => {
    setEmuBusy(true);
    setEmuStatus(`Targeting ${emuSystem} video snaps…`);
    const stopProgress = window.gameStore!.onEmuMoviesProgress(setEmuStatus);
    try {
      const indexed = await window.gameStore!.indexEmuMovies(
        emuSystem,
        games.map(({ title, region, coverName }) => ({ title, region, coverName })),
      );
      const coverage = indexed.coverage;
      setEmuStatus(
        coverage
          ? `${emuSystem}: ${coverage.matched.toLocaleString()} of ${coverage.catalog.toLocaleString()} games matched from ${indexed.snaps.toLocaleString()} ${indexed.quality} provider files; ${coverage.ambiguous.toLocaleString()} ambiguous and ${coverage.unmatched.toLocaleString()} unavailable. Downloads remain per-game and on demand.`
          : `${emuSystem}: ${indexed.snaps.toLocaleString()} ${indexed.quality} provider files indexed. Downloads remain per-game and on demand.`,
      );
      setEmuState(await window.gameStore!.getEmuMoviesSettings());
      setScrapeDialog(false);
    } catch (error) {
      setEmuStatus(error instanceof Error ? error.message : String(error));
    } finally {
      stopProgress();
      setEmuBusy(false);
    }
  };
  const forgetEmuMovies = async () => {
    await window.gameStore?.forgetEmuMovies();
    setEmu({ username: "", password: "" });
    setEmuState(await window.gameStore!.getEmuMoviesSettings());
    setEmuStatus("EmuMovies credentials removed from this machine.");
  };
  const scanNetwork = async () => {
    setScan("Finding SSH/SFTP devices…");
    try {
      const found = (await window.gameStore?.discoverFpga()) ?? [];
      setDevices(found);
      setScan(found.length ? `${found.length} candidate${found.length === 1 ? "" : "s"} found` : "No SSH/SFTP devices found");
    } catch (e) {
      setScan(e instanceof Error ? e.message : String(e));
    }
  };
  const testDebridProvider = async (provider: "realdebrid" | "torbox") => {
    try {
      await window.gameStore?.setDebridSettings(debrid);
      const result = await window.gameStore!.testDebrid(provider);
      setTest(`${provider === "torbox" ? "TorBox" : "Real-Debrid"}: ${result.account}`);
    } catch (e) {
      setTest(e instanceof Error ? e.message : String(e));
    }
  };
  const testDevice = async () => {
    setTest("Connecting…");
    try {
      setTest((await window.gameStore!.testFpga()).message);
    } catch (e) {
      setTest(e instanceof Error ? e.message : String(e));
    }
  };
  const exportShelf = async () => {
    const payload = JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        favorites: [...favorites],
      },
      null,
      2,
    );
    if (window.gameStore) {
      await window.gameStore.saveExport(payload);
      setExported(true);
      setTimeout(() => setExported(false), 2500);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="settings-modal">
        <div>
          <p className="eyebrow">PROVIDERS & DEVICES</p>
          <button onClick={onClose}>
            <X />
          </button>
        </div>
        <nav className="settings-tabs" aria-label="Settings sections">
          {([
            ["general", "General"],
            ["downloads", "Downloads"],
            ["media", "Media"],
            ["device", "MiSTer"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={activeTab === id ? "active" : ""}
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-panel">
        {activeTab === "general" && <>
        <h2>Artwork scrapers</h2>
        <p>
          Libretro works without configuration. Add your TheGamesDB key to
          search official release artwork from each game’s detail panel.
        </p>
        <label>
          TheGamesDB API key
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Stored only on this machine"
          />
        </label>
        <small>
          The key is encrypted with the operating system keychain when available
          and never enters exports or GitHub.
        </small>
        <hr />
        <h2><Library /> Library export</h2>
        <p>
          Save a small JSON backup of your Favorites. It contains no game files,
          credentials, downloaded media, or MiSTer settings.
        </p>
        <div className="settings-actions">
          <button onClick={exportShelf}>
            <Download /> {exported ? "Shelf exported" : "Export favorites"}
          </button>
        </div>
        </>}
        {activeTab === "downloads" && <>
        <h2><Download /> Download providers</h2>
        <p>
          Paste provider API tokens here. They are encrypted locally and omitted from logs, exports, and catalog data. Game downloads land under Documents/GameStore/Games.
        </p>
        <label>
          Real-Debrid API token {debridState.hasRealDebrid && <small>· saved</small>}
          <input type="password" value={debrid.realdebrid} onChange={(e) => setDebrid({ ...debrid, realdebrid: e.target.value })} placeholder="Blank keeps saved token" />
        </label>
        <label>
          TorBox API token {debridState.hasTorBox && <small>· saved</small>}
          <input type="password" value={debrid.torbox} onChange={(e) => setDebrid({ ...debrid, torbox: e.target.value })} placeholder="Blank keeps saved token" />
        </label>
        <div className="collection-sources">
        {PLATFORMS.map((platform) => {
          const saved = debridState.collections.find((source) => source.platform === platform.id);
          const status = indexing[platform.id];
          const busy = status?.startsWith("Indexing ");
          return <div className="collection-source" key={platform.id}>
            <label>
              {platform.label} collection torrent URL {saved && <small>· saved</small>}
              <span>
                <input
                  value={collectionUrls[platform.id] ?? ""}
                  onChange={(e) => setCollectionUrls((prev) => ({ ...prev, [platform.id]: e.target.value }))}
                  placeholder="Paste one HTTPS .torrent URL"
                />
                <button
                  disabled={busy || !(collectionUrls[platform.id] ?? "").trim()}
                  onClick={() => void indexCollection(platform.id)}
                >
                  {busy ? "Indexing…" : saved ? "Re-index" : "Index"}
                </button>
              </span>
            </label>
            {status && <small className="index-status">{status}</small>}
          </div>;
        })}
        </div>
        <small>One source per console. Save stores the URLs; use that console's Index button to build or refresh its file list. Clearing a field removes that console's source when settings are saved.</small>
        <div className="settings-actions split-actions">
          <button onClick={() => testDebridProvider("realdebrid")}>Test Real-Debrid</button>
          <button onClick={() => testDebridProvider("torbox")}>Test TorBox</button>
        </div>
        </>}
        {activeTab === "media" && <>
        <h2><Film /> EmuMovies account</h2>
        <p>
          Sign in and GameStore uses EmuMovies video snaps for previews — one
          curated clip per release, thirty seconds of gameplay, matched to your
          game by its exact Redump filename. Without an account, previews fall
          back to streaming Internet Archive longplays.
        </p>
        <label>
          EmuMovies forum username
          <input
            value={emu.username}
            autoComplete="off"
            onChange={(e) => setEmu({ ...emu, username: e.target.value })}
            placeholder="Your EmuMovies forum username"
          />
        </label>
        <label>
          EmuMovies forum password {emuState?.hasPassword && <small>· saved</small>}
          <input
            type="password"
            value={emu.password}
            autoComplete="off"
            onChange={(e) => setEmu({ ...emu, password: e.target.value })}
            placeholder={emuState?.hasPassword ? "Blank keeps saved forum password" : "Your EmuMovies forum password"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !emuBusy) void loginEmuMovies();
            }}
          />
        </label>
        <small>
          GameStore signs in to files.emumovies.com on port 21 using your
          EmuMovies forum username and password. It tries TLS first and safely
          retries Plain FTP only when TLS cannot connect. Credentials are
          encrypted with the operating system keychain and never written to
          exports, logs, or catalog data.
        </small>
        {emuStatus && <p className="index-status">{emuStatus}</p>}
        <div className="settings-actions split-actions">
          <button disabled={emuBusy} onClick={loginEmuMovies}>
            {emuBusy ? "Working…" : "Sign in to EmuMovies"}
          </button>
          {emuState?.hasPassword && (
            <button disabled={emuBusy} onClick={forgetEmuMovies}>
              Forget account
            </button>
          )}
        </div>
        <hr />
        <h2><Sparkles /> Scraping</h2>
        <p>
          Choose a media type first, then target one console. Scrapes only inspect
          that console's provider folders; opening an unscraped game can still fetch
          its media on demand.
        </p>
        <label className="scrape-checkbox">
          <input
            type="checkbox"
            checked={skipExistingMedia}
            onChange={(event) => {
              setSkipExistingMedia(event.target.checked);
              localStorage.setItem(
                "gamestore:scraping:skip-existing",
                String(event.target.checked),
              );
            }}
          />
          <span>
            Skip titles already containing the desired media type
            <small>Preserves existing local media and avoids unnecessary provider traffic.</small>
          </span>
        </label>
        <div className="scrape-types">
          <div>
            <Image />
            <span><b>Artwork</b><small>Libretro and your selected artwork are already managed automatically.</small></span>
            <em>Automatic</em>
          </div>
          <div>
            <Image />
            <span><b>Screenshots</b><small>Resolved per game from the shared Libretro index.</small></span>
            <em>On demand</em>
          </div>
          <div className="available">
            <Film />
            <span>
              <b>Video</b>
              <small>{emuState?.indexed
                ? `${emuState.snaps.toLocaleString()} ${emuState.quality} EmuMovies snaps available for Sony PlayStation.`
                : "EmuMovies video snaps, matched by console and preferred region."}</small>
            </span>
            <button disabled={!emuState?.hasPassword || emuBusy} onClick={() => setScrapeDialog(true)}>
              {emuState?.indexed ? "Scrape again" : "Scrape"}
            </button>
          </div>
        </div>
        {!emuState?.hasPassword && <small>Sign in to EmuMovies above to scrape video.</small>}
        <hr />
        <h2>
          <Database /> Local media cache
        </h2>
        <p>
          GameStore resolves media only when you open a game, so browsing never
          competes with a catalog-wide background download. EmuMovies snaps
          cache locally after their console is scraped; otherwise, matched Internet Archive
          longplays stream a short loop without silently downloading the full
          recording.
        </p>
        <div className="cache-row">
          <div>
            <b>{cache ? formatBytes(cache.bytes) : "Calculating…"}</b>
            <small>{cache?.path}</small>
          </div>
          <button
            onClick={async () => {
              if (window.gameStore) {
                const cleared = await window.gameStore.clearMediaCache();
                setCache(cleared);
                restartMediaAudit(games);
              }
            }}
          >
            <Trash2 /> Clear media
          </button>
        </div>
        </>}
        {activeTab === "device" && <>
        <h2>
          <Wifi /> SuperStation / MiSTer
        </h2>
        <p>
          Transfers PSX CHD or complete BIN/CUE sets over SFTP into one folder
          per game. GameStore quietly indexes that PSX folder once in the
          background and marks matching catalog covers already on your device.
        </p>
        <p className="device-hint">
          A MiSTer answers to <b>MiSTer.local</b> on your network, so leaving the
          device name alone is the reliable setup — the name keeps working after
          your router hands out a different address. GameStore remembers which
          device is yours and quietly re-finds it whenever the address changes,
          so you should not need to come back here.
          {device.recognized
            ? " This device has been recognised and can be found again on its own."
            : " Connect once and this device will be recognised."}
        </p>
        <div className="settings-actions scan-actions">
          <button onClick={scanNetwork}><Wifi /> Scan network</button>
          {(locating || scan) && <span>{locating || scan}</span>}
        </div>
        {!!devices.length && <div className="device-candidates">
          {devices.map((candidate) => <button key={candidate.host} onClick={() => setDevice({ ...device, host: candidate.host, port: candidate.port, deviceName: candidate.hostname || device.deviceName })}>
            <b>{candidate.hostname || candidate.host}</b>
            <span>{candidate.host} · {candidate.confidence}</span>
            <small>{candidate.reason}</small>
          </button>)}
        </div>}
        <div className="device-fields">
          <label>
            Device name
            <input
              value={device.deviceName}
              placeholder="MiSTer.local"
              onChange={(e) => setDevice({ ...device, deviceName: e.target.value })}
            />
          </label>
          <label>
            Address
            <small>found automatically</small>
            <input
              value={device.host}
              onChange={(e) => setDevice({ ...device, host: e.target.value })}
            />
          </label>
          <label>
            Port
            <input
              type="number"
              value={device.port}
              onChange={(e) =>
                setDevice({ ...device, port: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Username
            <input
              value={device.username}
              onChange={(e) =>
                setDevice({ ...device, username: e.target.value })
              }
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={device.password}
              onChange={(e) =>
                setDevice({ ...device, password: e.target.value })
              }
              placeholder="Blank keeps saved password"
            />
          </label>
        </div>
        <label>
          Games root
          <input
            value={device.root}
            onChange={(e) => setDevice({ ...device, root: e.target.value })}
          />
        </label>
        <small>
          MiSTer defaults are root / 1. Credentials stay encrypted locally when
          the OS keychain is available.
        </small>
        <div className="settings-actions">
          <button onClick={testDevice}>Test connection</button>
          <button onClick={async () => {
            setTest("Refreshing device library…");
            try {
              const result = await window.gameStore!.refreshFpgaInventory();
              setTest(`${result.folders} PSX folder${result.folders === 1 ? "" : "s"} indexed on the device.`);
            } catch (error) {
              setTest(error instanceof Error ? error.message : String(error));
            }
          }}>Refresh device library</button>
        </div>
        </>}
        </div>
        {test && <p className="test-result">{test}</p>}
        <div className="settings-footer">
          <button className="save-provider" onClick={save}>
            {saved ? "Saved" : "Save settings"}
          </button>
        </div>
      </section>
      {scrapeDialog && (
        <div className="scrape-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !emuBusy) setScrapeDialog(false);
        }}>
          <section className="scrape-dialog" role="dialog" aria-modal="true" aria-labelledby="video-scrape-title">
            <header>
              <div><small>VIDEO SCRAPE</small><h3 id="video-scrape-title">Choose a console</h3></div>
              <button disabled={emuBusy} aria-label="Close video scrape" onClick={() => setScrapeDialog(false)}><X /></button>
            </header>
            <p>
              GameStore will inspect only the selected console's EmuMovies video
              folders and build its matching manifest. Clips are downloaded lazily,
              one preferred-region video when a game needs it.
            </p>
            <label>
              Console
              <select value={emuSystem} onChange={(event) => setEmuSystem(event.target.value)}>
                <option value="PS1">Sony PlayStation</option>
              </select>
            </label>
            <div className="scrape-summary">
              <Film />
              <span><b>EmuMovies video snaps</b><small>One region-preferred, Disc-1-first match per catalog title. Demos and other consoles are excluded.</small></span>
            </div>
            {emuStatus && <p className="index-status">{emuStatus}</p>}
            <footer>
              <button disabled={emuBusy} onClick={() => setScrapeDialog(false)}>Cancel</button>
              <button className="primary" disabled={emuBusy} onClick={indexEmuMovies}>
                {emuBusy ? "Scraping Sony PlayStation…" : "Scrape Sony PlayStation video"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function UpdaterButton() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [showNote, setShowNote] = useState(false);
  useEffect(() => {
    window.gameStore?.getUpdateStatus().then(setStatus);
    return window.gameStore?.onUpdateStatus(setStatus);
  }, []);
  const action = () => {
    setShowNote(false);
    if (status.state === "available") return window.gameStore?.downloadUpdate();
    if (status.state === "ready") return window.gameStore?.restartToUpdate();
    if (status.state === "downloading" || status.state === "checking") return;
    window.gameStore?.checkForUpdates();
  };
  const label =
    status.state === "checking"
      ? "Checking…"
      : status.state === "available"
        ? `Download v${status.version}`
        : status.state === "downloading"
          ? `Downloading ${status.percent ?? 0}%`
          : status.state === "ready"
            ? "Restart to update"
            : status.state === "current"
              ? "Up to date"
              : status.state === "error"
                ? "Update failed"
                : status.state === "unsupported"
                  ? "Updates unavailable"
                  : "Check for updates";
  const Icon =
    status.state === "ready"
      ? RefreshCw
      : status.state === "available"
        ? Download
        : status.state === "checking" || status.state === "downloading"
          ? LoaderCircle
          : RefreshCw;
  return (
    <div className="updater">
      <button
        className={`update-button ${status.state}`}
        onClick={action}
        onMouseEnter={() => setShowNote(true)}
        onMouseLeave={() => setShowNote(false)}
        disabled={status.state === "checking" || status.state === "downloading"}
      >
        <Icon />
        <span>{label}</span>
        {status.state === "downloading" && (
          <i style={{ width: `${status.percent ?? 0}%` }} />
        )}
      </button>
      {showNote && (status.message || status.state === "current") && (
        <small>
          {status.message || "You have the newest GameStore release."}
        </small>
      )}
    </div>
  );
}

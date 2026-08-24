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
import { createCuratedShelves, facetOrder, games, Game } from "./catalog";
import { ArtworkProvider, useArtwork } from "./artwork";
import { ArtPicker } from "./ArtPicker";
import { MediaGallery } from "./MediaGallery";
import { restartMediaAudit } from "./mediaLibrary";

type Sort = "curated" | "title" | "year-new" | "year-old";
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
  const detailsRef = useRef<HTMLDivElement>(null);
  const genres = useMemo(
    () => Array.from(new Set(games.flatMap((g) => g.genres))).sort(),
    [],
  );
  const filtered = useMemo(
    () =>
      games
        .filter((g) => {
          const text =
            `${g.title} ${g.description} ${g.genres.join(" ")} ${g.facets.join(" ")}`.toLowerCase();
          return (
            (!query || text.includes(query.toLowerCase())) &&
            (region === "All regions" || g.region === region) &&
            (genre === "All genres" || g.genres.includes(genre)) &&
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
    [query, region, genre, facet, translation, favoriteOnly, favorites, sort],
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
    const catalog = games.map(({ id, title }) => ({ id, title }));
    const loadInventory = () => window.gameStore?.getFpgaInventory(catalog).then((result) => {
      if (result?.status === "ready") setFpgaGameIds(new Set(result.gameIds));
    });
    void loadInventory();
    return window.gameStore?.onFpgaInventoryChanged(() => void loadInventory());
  }, []);
  const reset = () => {
    setQuery("");
    setRegion("All regions");
    setGenre("All genres");
    setFacet("All flavors");
    setTranslation(false);
    setFavoriteOnly(false);
  };
  const browsing =
    !!query ||
    region !== "All regions" ||
    genre !== "All genres" ||
    facet !== "All flavors" ||
    translation ||
    favoriteOnly;
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="logo">
            <Gamepad2 />
          </div>
          <b>
            GAME<span>STORE</span>
          </b>
        </div>
        <nav>
          <button className={!favoriteOnly ? "active" : ""} onClick={reset}>
            <Compass />
            Discover
          </button>
          <button disabled title="More platforms are coming after the PS1 catalog">
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
        </nav>
        <button className="settings-link" onClick={() => setSettings(true)}>
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
          <div className="platforms">
            <button className="active">All</button>
            <button>PS1</button>
            <button disabled>PS2</button>
            <button disabled>Saturn</button>
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
                  : `${filtered.length} PlayStation ${filtered.length === 1 ? "game" : "games"}`}
              </h2>
              <p>
                USA first · PAL fallback · Japan exclusives with English patches
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
        </main>
        <footer>
          <b>GameStore 0.11.2</b>
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
  const { index, unmatched, resolving, refreshIndex } = useArtwork();
  if (index.status === "loading")
    return (
      <span>
        <LoaderCircle className="spin" /> Matching box art…
      </span>
    );
  if (index.status === "error")
    return (
      <span className="warn">Artwork index unavailable · {index.message}</span>
    );
  // Seeded covers land at once; the fuzzy tail fills in behind this readout.
  if (resolving)
    return (
      <span>
        <LoaderCircle className="spin" /> {games.length - unmatched}/
        {games.length} covers matched · still searching the rest
      </span>
    );
  return (
    <span>
      {games.length - unmatched}/{games.length} covers matched from{" "}
      {index.files.length.toLocaleString()} Libretro scans · right-click a game
      for alternates
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
  onFav,
  onOpen,
  onContextMenu,
}: {
  game: Game;
  selected: boolean;
  favorite: boolean;
  onFpga: boolean;
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
        {game.translation && <span className="translated">EN PATCH</span>}
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
          <p>
            {game.year} · {game.genres.join(" / ")}
          </p>
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
            {game.region} · PLAYSTATION · {game.year}
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
            <div>
              <dt>Players</dt>
              <dd>{game.players}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>
                {game.translation ? "English fan patch" : "Official English"}
              </dd>
            </div>
            <div>
              <dt>Release</dt>
              <dd>
                {game.region} · {game.year}
              </dd>
            </div>
          </dl>
          {game.translation && (
            <button
              className="patch-button"
              onClick={() => open(game.translation!.url)}
            >
              Get English patch <ExternalLink />
            </button>
          )}
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
      const result = await window.gameStore.downloadGame(provider, link.trim(), game.title);
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
      const found = await window.gameStore!.searchCollections(game.title, game.region);
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
              <div><b>{item.title}</b><span>{item.platform} · {item.files.length} managed {item.files.length === 1 ? "file" : "files"}</span></div>
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
  const [debridState, setDebridState] = useState<{ hasRealDebrid: boolean; hasTorBox: boolean; collections: CollectionSource[] }>({ hasRealDebrid: false, hasTorBox: false, collections: [] });
  const [collection, setCollection] = useState({ name: "PS1 collection", url: "", platform: "PS1" });
  const [indexing, setIndexing] = useState("");
  const [devices, setDevices] = useState<NetworkCandidate[]>([]);
  const [scan, setScan] = useState("");
  const [cache, setCache] = useState<MediaCacheStats | null>(null);
  const [device, setDevice] = useState({
    host: "MiSTer",
    port: 22,
    username: "root",
    password: "",
    root: "/media/fat/games",
  });
  useEffect(() => {
    window.gameStore?.getTheGamesDbKey().then(setKey);
    window.gameStore
      ?.getFpgaSettings()
      .then((f) => f && setDevice((d) => ({ ...d, ...f, password: "" })));
    window.gameStore?.getMediaCacheStats().then(setCache);
    window.gameStore?.getDebridSettings().then(setDebridState);
    window.gameStore?.getEmuMoviesSettings().then((state) => {
      setEmuState(state);
      setEmu((current) => ({ ...current, username: state.username }));
    });
    return window.gameStore?.onFpgaDiscoveryProgress(({ done, total }) =>
      setScan(`Scanning local network · ${done}/${total}`),
    );
  }, []);
  /**
   * Saving a collection source is also when it gets indexed. Every Add to Cart
   * used to re-download the whole `.torrent` — up to 64 MB — and re-decode its
   * bencode before it could rank one filename, so searching felt like indexing
   * because it was. The manifest is parsed once, here, and kept.
   */
  const save = async () => {
    await window.gameStore?.setTheGamesDbKey(key);
    await window.gameStore?.setFpgaSettings(device);
    const collections = collection.url ? [collection] : debridState.collections;
    setDebridState(
      (await window.gameStore?.setDebridSettings({ ...debrid, collections })) ??
        debridState,
    );
    for (const source of collections) {
      setIndexing(`Indexing ${source.name}…`);
      try {
        const result = await window.gameStore!.indexCollection(source);
        setIndexing(`${source.name}: ${result.files.toLocaleString()} files indexed`);
      } catch (e) {
        setIndexing(e instanceof Error ? e.message : String(e));
      }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
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
      const indexed = await window.gameStore!.indexEmuMovies(emuSystem);
      setEmuStatus(
        `${emuSystem}: ${indexed.snaps.toLocaleString()} ${indexed.quality} video snaps indexed. Downloads remain per-game and on demand.`,
      );
      setEmuState(await window.gameStore!.getEmuMoviesSettings());
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
        <hr />
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
        <label>
          PS1 collection torrent URL {debridState.collections.length > 0 && <small>· {debridState.collections.length} saved</small>}
          <input value={collection.url} onChange={(e) => setCollection({ ...collection, url: e.target.value })} placeholder="Paste one HTTPS .torrent URL once" />
        </label>
        <small>GameStore indexes only sources you configure, once, when you save. Every game then finds its exact file instantly.</small>
        {indexing && <p className="index-status">{indexing}</p>}
        <div className="settings-actions split-actions">
          <button onClick={() => testDebridProvider("realdebrid")}>Test Real-Debrid</button>
          <button onClick={() => testDebridProvider("torbox")}>Test TorBox</button>
        </div>
        <hr />
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
        {emuState?.hasPassword && (
          <label>
            Media console
            <select value={emuSystem} onChange={(e) => setEmuSystem(e.target.value)}>
              <option value="PS1">Sony PlayStation</option>
            </select>
            <small>
              Indexing follows only this console's media branches and stores one
              filename manifest. Clips download later, one selected game at a time.
            </small>
          </label>
        )}
        {emuState?.indexed && (
          <p className="index-status">
            {emuState.snaps.toLocaleString()} {emuState.quality} snaps indexed ·
            reindex any time to pick up new releases
          </p>
        )}
        {emuStatus && <p className="index-status">{emuStatus}</p>}
        <div className="settings-actions split-actions">
          <button disabled={emuBusy} onClick={loginEmuMovies}>
            {emuBusy ? "Working…" : "Sign in to EmuMovies"}
          </button>
          {emuState?.hasPassword && (
            <button disabled={emuBusy} onClick={indexEmuMovies}>
              {emuState.indexed ? `Refresh ${emuSystem} index` : `Index ${emuSystem} media`}
            </button>
          )}
          {emuState?.hasPassword && (
            <button disabled={emuBusy} onClick={forgetEmuMovies}>
              Forget account
            </button>
          )}
        </div>
        <hr />
        <h2>
          <Database /> Local media cache
        </h2>
        <p>
          GameStore resolves media only when you open a game, so browsing never
          competes with a catalog-wide background download. EmuMovies snaps
          cache locally after their console is indexed; otherwise, matched Internet Archive
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
        <hr />
        <h2>
          <Wifi /> SuperStation / MiSTer
        </h2>
        <p>
          Transfers PSX CHD or complete BIN/CUE sets over SFTP into one folder
          per game. GameStore quietly indexes that PSX folder once in the
          background and marks matching catalog covers already on your device.
        </p>
        <div className="settings-actions scan-actions">
          <button onClick={scanNetwork}><Wifi /> Scan network</button>
          {scan && <span>{scan}</span>}
        </div>
        {!!devices.length && <div className="device-candidates">
          {devices.map((candidate) => <button key={candidate.host} onClick={() => setDevice({ ...device, host: candidate.host, port: candidate.port })}>
            <b>{candidate.hostname || candidate.host}</b>
            <span>{candidate.host} · {candidate.confidence}</span>
            <small>{candidate.reason}</small>
          </button>)}
        </div>}
        <div className="device-fields">
          <label>
            Hostname / IP
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
          <button className="save-provider" onClick={save}>
            {saved ? "Saved" : "Save settings"}
          </button>
        </div>
        {test && <p className="test-result">{test}</p>}
      </section>
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

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Compass,
  Download,
  ExternalLink,
  Gamepad2,
  Grid2X2,
  HardDriveUpload,
  Heart,
  Image,
  Library,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Wifi,
  X,
} from "lucide-react";
import { facetOrder, games, Game } from "./catalog";
import { ArtworkProvider, useArtwork } from "./artwork";
import { ArtPicker } from "./ArtPicker";

type Sort = "curated" | "title" | "year-new" | "year-old";
const open = (url: string) =>
  window.gameStore?.openExternal(url) ?? window.open(url, "_blank", "noopener");
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
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("All regions");
  const [genre, setGenre] = useState("All genres");
  const [facet, setFacet] = useState("All flavors");
  const [translation, setTranslation] = useState(false);
  const [sort, setSort] = useState<Sort>("curated");
  const [selected, setSelected] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavs);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState(false);
  const [artPicker, setArtPicker] = useState<Game | null>(null);
  const [menu, setMenu] = useState<{ game: Game; x: number; y: number } | null>(
    null,
  );
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
            (!translation || !!g.translation)
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
    [query, region, genre, facet, translation, sort],
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
    if (selected)
      requestAnimationFrame(() =>
        detailsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        }),
      );
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
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };
  const reset = () => {
    setQuery("");
    setRegion("All regions");
    setGenre("All genres");
    setFacet("All flavors");
    setTranslation(false);
  };
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
          <button className="active" onClick={reset}>
            <Compass />
            Discover
          </button>
          <button>
            <Gamepad2 />
            Platforms
          </button>
          <button onClick={() => setFacet("Surreal")}>
            <Sparkles />
            Weird Picks
          </button>
          <button onClick={() => setTranslation(true)}>
            <Library />
            Translations
          </button>
          <button onClick={() => setFacet("All flavors")}>
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
          <button className="export" onClick={exportShelf}>
            {saved ? "Saved" : "Export shelf"}
          </button>
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
          <section className="feature">
            <div>
              <p>CURATOR'S SHELF</p>
              <h1>Beautifully Weird</h1>
              <span>Surreal worlds, bad ideas, and brilliant accidents.</span>
            </div>
            <div className="feature-cards">
              {[games[3], games[0], games[4], games[1], games[5], games[6]].map(
                (g) => (
                  <MiniCover
                    key={g.id}
                    game={g}
                    onClick={() => {
                      setSelected(g.id);
                      setFacet("All flavors");
                    }}
                  />
                ),
              )}
            </div>
          </section>
          <div className="catalog-head">
            <div>
              <h2>{filtered.length} PlayStation games</h2>
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
                <Sparkles />
                <h2>Nothing in this corner.</h2>
                <button onClick={reset}>Clear filters</button>
              </div>
            )}
          </div>
        </main>
        <footer>
          <b>GameStore 0.5 preview</b>
          <ArtworkStatus />
        </footer>
      </div>
      {settings && <ProviderSettings onClose={() => setSettings(false)} />}
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
  const { index, unmatched, refreshIndex } = useArtwork();
  if (index.status === "loading")
    return (
      <span>
        <LoaderCircle className="spin" /> Matching box art…
      </span>
    );
  if (index.status === "error")
    return <span className="warn">Artwork index unavailable · {index.message}</span>;
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

function CoverImage({ game }: { game: Game }) {
  const [bad, setBad] = useState(false);
  const [ratio, setRatio] = useState("1 / 1");
  const { url } = useArtwork().artFor(game);
  useEffect(() => setBad(false), [url]);
  return (
    <div className="art-frame" style={{ aspectRatio: ratio }}>
      {url && !bad ? (
        <img
          key={url}
          src={url}
          alt={`${game.title} release cover`}
          loading="lazy"
          onLoad={(e) =>
            setRatio(
              `${e.currentTarget.naturalWidth} / ${e.currentTarget.naturalHeight}`,
            )
          }
          onError={() => setBad(true)}
        />
      ) : (
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
  onFav,
  onOpen,
  onContextMenu,
}: {
  game: Game;
  selected: boolean;
  favorite: boolean;
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
          aria-label="Favorite"
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
  const [media, setMedia] = useState<"video" | "screens">("video");
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
          <button onClick={onClose}>
            <X />
            Close
          </button>
        </div>
      </div>
      <div className="detail-body">
        <div className="detail-art">
          <CoverImage game={game} />
          <button onClick={onFindArt}>
            <Image /> Search alternate box art
          </button>
          {artwork.hasOverride(game) && (
            <button className="ghost" onClick={() => artwork.clearOverride(game)}>
              <RotateCcw /> Reset to automatic
            </button>
          )}
          <small>
            {art.source}
            {art.confidence ? ` · ${art.confidence} confidence` : ""}
            {art.variant ? ` · ${art.variant}` : ""}
          </small>
        </div>
        <div className="copy">
          <p className="description">{game.description}</p>
          <blockquote>“{game.curatorNote}”</blockquote>
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
          <button
            className="transfer-button"
            disabled={transfer.state === "copying"}
            onClick={sendToFpga}
          >
            <HardDriveUpload />
            {transfer.state === "copying"
              ? `Transferring ${transfer.percent ?? 0}%`
              : "Send to SuperStation / MiSTer"}
          </button>
          {transfer.state !== "idle" && (
            <div className={`transfer-status ${transfer.state}`}>
              <i>
                <b style={{ width: `${transfer.percent ?? 0}%` }} />
              </i>
              <span>{transfer.message}</span>
            </div>
          )}
          <div className="links">
            {game.links.map((l) => (
              <button key={l.url} onClick={() => open(l.url)}>
                <i className={l.state} />
                {l.label}
                <span>{l.state}</span>
                <ExternalLink />
              </button>
            ))}
          </div>
        </div>
        <div className="media">
          <div className="media-tabs">
            <button
              className={media === "video" ? "active" : ""}
              onClick={() => setMedia("video")}
            >
              Gameplay
            </button>
            <button
              className={media === "screens" ? "active" : ""}
              onClick={() => setMedia("screens")}
            >
              Screenshots
            </button>
          </div>
          {media === "video" && game.video ? (
            <iframe
              src={game.video}
              title={`${game.title} gameplay`}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="no-media">
              <Play />
              <h3>
                {media === "video"
                  ? "Video unavailable"
                  : "Screenshots not downloaded"}
              </h3>
              <p>
                Media stays honest when no release-matched source is available.
              </p>
            </div>
          )}
          <p className="media-note">
            Loaded on demand from its attributed source.
          </p>
        </div>
      </div>
    </div>
  );
});

function ProviderSettings({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState("");
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
  }, []);
  const save = async () => {
    await window.gameStore?.setTheGamesDbKey(key);
    await window.gameStore?.setFpgaSettings(device);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const testDevice = async () => {
    setTest("Connecting…");
    try {
      setTest((await window.gameStore!.testFpga()).message);
    } catch (e) {
      setTest(e instanceof Error ? e.message : String(e));
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
        <h2>
          <Wifi /> SuperStation / MiSTer
        </h2>
        <p>
          Transfers PSX CHD or complete BIN/CUE sets over SFTP into one folder
          per game.
        </p>
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

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Gamepad2, HardDrive, LayoutGrid, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { resolveArt } from "./artMatch";

type CategoryFilter = "all" | MiSTerCoreCategory;
type TierFilter = "all" | MiSTerCoreTier;
type InstalledFilter = "all" | "installed" | "not-installed";

/**
 * Arcade box art has a real source: Libretro's FBNeo pack names every file
 * after the same human-readable arcade title (region/set tags included) that
 * an MRA carries, so the existing catalog art matcher — built for PS1/N64/
 * Saturn covers — resolves it without a new scoring path. No equivalent
 * per-game art source exists for computer/console/LLAPI/other cores, which
 * are open-ended platforms rather than one depictable game; those get a
 * category badge instead of a cover.
 */
const ARCADE_ART_SOURCE = { system: "FBNeo%20-%20Arcade%20Games", folder: "Named_Boxarts" } as const;

const CATEGORY_LABELS: Record<MiSTerCoreCategory, string> = {
  arcade: "Arcade board recreations",
  computer: "Home computers",
  console: "Consoles",
  llapi: "Low-latency (LLAPI)",
  other: "Other",
};

const formatBytes = (value: number) =>
  value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024).toFixed(0)} KB`;

/**
 * The MiSTer Core Cabinet: browse every core in the catalogs `update_all.sh`
 * (theypsilon/Update_All_MiSTer) itself reads, and install one to the
 * connected device.
 *
 * The catalog is fetched from the main process (`mister-core-catalog-get`),
 * which derives it from the real `MiSTer-devel/Distribution_MiSTer` manifest
 * plus the handful of other core-bearing manifests `update_all.sh`'s own
 * `databases.py` names as "unofficial cores" — never from a hand-picked list,
 * which is exactly what missed a real device's PSX/N64/Saturn cores the first
 * time this page shipped.
 */
export function MiSTerCoreCabinet({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [catalog, setCatalog] = useState<MiSTerCoreCatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>("all");
  const [query, setQuery] = useState("");
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null);
  const [status, setStatus] = useState("Checking your connected MiSTer…");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, MiSTerCoreInstallProgress>>({});
  const [arcadeArt, setArcadeArt] = useState<Record<string, string>>({});

  const loadCatalog = async (force = false) => {
    try {
      const result = await window.gameStore?.getMisterCoreCatalog(force);
      if (!result) throw new Error("Open GameStore on your desktop to browse MiSTer cores.");
      setCatalog(result.entries);
      setCatalogError("");
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    }
  };
  const loadInstallState = async () => {
    setStatus("Checking your connected MiSTer…");
    try {
      const result = await window.gameStore?.getMisterCoresInstallState();
      if (!result) throw new Error("Open GameStore on your desktop to browse MiSTer cores.");
      setInstalled(result.installed);
      setStatus(`Connected to ${result.host}`);
    } catch (error) {
      setInstalled(null);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void loadCatalog();
    void loadInstallState();
    return window.gameStore?.onMisterCoreInstallProgress((update) => {
      setProgress((current) => ({ ...current, [update.coreId]: update }));
      if (update.stage === "done" || update.stage === "error") {
        setInstallingId(null);
        if (update.stage === "done") void loadInstallState();
      }
    });
  }, []);

  // Box art is a nice-to-have on top of a browsable, installable list, so a
  // missing/unreachable index leaves cores visible with no cover rather than
  // failing the page.
  useEffect(() => {
    const arcadeCores = (catalog ?? []).filter((core) => core.category === "arcade" && core.artTitle);
    if (!arcadeCores.length) return;
    let cancelled = false;
    (async () => {
      try {
        const index = await window.gameStore?.getArtIndex(ARCADE_ART_SOURCE.system, ARCADE_ART_SOURCE.folder);
        if (!index || cancelled) return;
        const matches: Record<string, string> = {};
        for (const core of arcadeCores) {
          const match = resolveArt(core.artTitle!, "USA", index.files, ARCADE_ART_SOURCE);
          if (match) matches[core.id] = match.url;
        }
        if (!cancelled) setArcadeArt(matches);
      } catch {
        // No box art this session; install/browse still work without it.
      }
    })();
    return () => { cancelled = true; };
  }, [catalog]);

  const install = async (core: MiSTerCoreCatalogEntry) => {
    setInstallingId(core.id);
    setProgress((current) => ({
      ...current,
      [core.id]: { coreId: core.id, stage: "downloading", message: `Downloading ${core.name}…` },
    }));
    try {
      await window.gameStore!.installMisterCore(core.id);
    } catch {
      setInstallingId(null);
    }
  };

  const categoryCounts = useMemo(() => {
    const byCategory: Record<CategoryFilter, number> = { all: 0, arcade: 0, computer: 0, console: 0, llapi: 0, other: 0 };
    for (const core of catalog ?? []) {
      if (tier !== "all" && core.tier !== tier) continue;
      byCategory.all++;
      byCategory[core.category]++;
    }
    return byCategory;
  }, [catalog, tier]);

  const tierCounts = useMemo(() => {
    const counts = { all: 0, official: 0, unofficial: 0 };
    for (const core of catalog ?? []) { counts.all++; counts[core.tier]++; }
    return counts;
  }, [catalog]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog ?? [])
      .filter((core) => category === "all" || core.category === category)
      .filter((core) => tier === "all" || core.tier === tier)
      .filter((core) => !needle || core.name.toLowerCase().includes(needle))
      .filter((core) => {
        if (installedFilter === "all" || !installed) return true;
        const isInstalled = !!installed[core.id];
        return installedFilter === "installed" ? isInstalled : !isInstalled;
      });
  }, [catalog, category, tier, query, installedFilter, installed]);

  const installedCount = installed ? Object.values(installed).filter(Boolean).length : 0;
  const deviceReady = installed !== null;

  return (
    <section className="mister-manager core-cabinet">
      <div className="mister-heading">
        <div>
          <p className="eyebrow">MISTER / CORE CABINET</p>
          <h1>MiSTer Cores</h1>
          <p>Every core in the manifests the official Update All tool reads — arcade board recreations, home computers, consoles, LLAPI variants, and small extras.</p>
        </div>
        <button className="export" onClick={() => { void loadCatalog(true); void loadInstallState(); }}>
          <RefreshCw /> Refresh
        </button>
      </div>
      {catalogError && !catalog ? (
        <div className="device-empty">
          <HardDrive />
          <h2>Core catalog unavailable</h2>
          <p>{catalogError}</p>
        </div>
      ) : !catalog ? (
        <p className="device-status"><LoaderCircle className="spin" /> Loading the MiSTer core catalogs…</p>
      ) : (
        <>
          <p className="device-status">
            {deviceReady ? `${status} · ${installedCount}/${catalog.length} cataloged cores installed` : status}
          </p>
          {!deviceReady && (
            <div className="device-empty core-cabinet-device-empty">
              <HardDrive />
              <p>Cores below can be browsed without a device, but installing one needs your MiSTer configured.</p>
              <button onClick={onOpenSettings}>Open device settings</button>
            </div>
          )}
          <div className="core-toolbar">
            <div className="platforms core-tier-tabs">
              <button className={tier === "all" ? "active" : ""} onClick={() => setTier("all")}>All sources ({tierCounts.all})</button>
              <button className={tier === "official" ? "active" : ""} onClick={() => setTier("official")}>Official ({tierCounts.official})</button>
              <button className={tier === "unofficial" ? "active" : ""} onClick={() => setTier("unofficial")}>Unofficial ({tierCounts.unofficial})</button>
            </div>
            <div className="core-search">
              <Search />
              <input placeholder="Search cores…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="core-toolbar">
            <div className="platforms">
              <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>All cores ({categoryCounts.all})</button>
              {(Object.keys(CATEGORY_LABELS) as MiSTerCoreCategory[]).map((c) => (
                <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>
                  {CATEGORY_LABELS[c]} ({categoryCounts[c]})
                </button>
              ))}
            </div>
            {deviceReady && (
              <div className="platforms core-installed-tabs">
                <button className={installedFilter === "all" ? "active" : ""} onClick={() => setInstalledFilter("all")}>All</button>
                <button className={installedFilter === "installed" ? "active" : ""} onClick={() => setInstalledFilter("installed")}>Installed</button>
                <button className={installedFilter === "not-installed" ? "active" : ""} onClick={() => setInstalledFilter("not-installed")}>Not installed</button>
              </div>
            )}
          </div>
          <div className="core-grid">
            {visible.map((core) => {
              const isInstalled = installed?.[core.id];
              const state = progress[core.id];
              const busy = installingId === core.id;
              const art = arcadeArt[core.id];
              return (
                <section className={isInstalled ? "core-card installed" : "core-card"} key={core.id}>
                  <div className="core-card-art">
                    {art ? (
                      <img src={art} alt="" loading="lazy" />
                    ) : (
                      <div className="core-card-art-placeholder">
                        {core.category === "arcade" ? <Gamepad2 /> : <LayoutGrid />}
                      </div>
                    )}
                    <span className={`core-game-badge ${core.gameCount === null ? "platform" : core.gameCount === 1 ? "single" : "multi"}`}>
                      {core.gameCount === null ? "Platform" : core.gameCount === 1 ? "1 game" : `${core.gameCount} games`}
                    </span>
                  </div>
                  <div className="core-card-head">
                    <b>{core.name}</b>
                    {isInstalled && <span><CheckCircle2 /> Installed</span>}
                  </div>
                  <p className="core-category">
                    {CATEGORY_LABELS[core.category]} <em className={`core-tier ${core.tier}`}>{core.tier}</em>
                  </p>
                  <p>
                    {core.category === "arcade"
                      ? `${core.gameCount} romset${core.gameCount === 1 ? "" : "s"} · ${formatBytes(core.rbfSize)}`
                      : formatBytes(core.rbfSize)}
                  </p>
                  {state && state.stage !== "done" && (
                    <p className={`core-progress ${state.stage}`}>
                      {state.stage === "error" ? state.message : (<><LoaderCircle className="spin" /> {state.message}</>)}
                    </p>
                  )}
                  <button disabled={busy || !deviceReady} onClick={() => void install(core)}>
                    {busy ? (<><LoaderCircle className="spin" /> Installing…</>) : (<><Download /> {isInstalled ? "Reinstall latest" : "Install to MiSTer"}</>)}
                  </button>
                  <span className="core-source">{core.source}</span>
                </section>
              );
            })}
            {!visible.length && <p className="core-empty">No cores match the current filters.</p>}
          </div>
        </>
      )}
    </section>
  );
}

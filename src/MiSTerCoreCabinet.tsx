import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, HardDrive, LoaderCircle, RefreshCw, Search } from "lucide-react";

type Filter = "all" | MiSTerCoreCategory;

const CATEGORY_LABELS: Record<MiSTerCoreCategory, string> = {
  arcade: "Arcade board recreations",
  computer: "Home computers",
  console: "Consoles",
  other: "Other",
};

const formatBytes = (value: number) =>
  value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024).toFixed(0)} KB`;

/**
 * The MiSTer Core Cabinet: browse every core the official MiSTer distribution
 * currently publishes, and install one to the connected device.
 *
 * The catalog is fetched from the main process (`mister-core-catalog-get`),
 * which derives it from the real `MiSTer-devel/Distribution_MiSTer` manifest
 * rather than a hand-picked list — a hand-picked list is exactly what missed
 * a real device's PSX/N64/Saturn cores the first time this page shipped.
 */
export function MiSTerCoreCabinet({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [catalog, setCatalog] = useState<MiSTerCoreCatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null);
  const [status, setStatus] = useState("Checking your connected MiSTer…");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, MiSTerCoreInstallProgress>>({});

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

  const counts = useMemo(() => {
    const byCategory: Record<Filter, number> = { all: 0, arcade: 0, computer: 0, console: 0, other: 0 };
    for (const core of catalog ?? []) { byCategory.all++; byCategory[core.category]++; }
    return byCategory;
  }, [catalog]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog ?? [])
      .filter((core) => filter === "all" || core.category === filter)
      .filter((core) => !needle || core.name.toLowerCase().includes(needle));
  }, [catalog, filter, query]);

  const installedCount = installed ? Object.values(installed).filter(Boolean).length : 0;
  const deviceReady = installed !== null;

  return (
    <section className="mister-manager core-cabinet">
      <div className="mister-heading">
        <div>
          <p className="eyebrow">MISTER / CORE CABINET</p>
          <h1>MiSTer Cores</h1>
          <p>Every core in the official MiSTer distribution — arcade board recreations, home computers, consoles, and small extras.</p>
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
        <p className="device-status"><LoaderCircle className="spin" /> Loading the official MiSTer core catalog…</p>
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
            <div className="platforms">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All cores ({counts.all})</button>
              {(Object.keys(CATEGORY_LABELS) as MiSTerCoreCategory[]).map((category) => (
                <button key={category} className={filter === category ? "active" : ""} onClick={() => setFilter(category)}>
                  {CATEGORY_LABELS[category]} ({counts[category]})
                </button>
              ))}
            </div>
            <div className="core-search">
              <Search />
              <input placeholder="Search cores…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="core-grid">
            {visible.map((core) => {
              const isInstalled = installed?.[core.id];
              const state = progress[core.id];
              const busy = installingId === core.id;
              return (
                <section className={isInstalled ? "core-card installed" : "core-card"} key={core.id}>
                  <div className="core-card-head">
                    <b>{core.name}</b>
                    {isInstalled && <span><CheckCircle2 /> Installed</span>}
                  </div>
                  <p className="core-category">{CATEGORY_LABELS[core.category]}</p>
                  <p>
                    {core.category === "arcade"
                      ? `${core.mraFiles.length || 1} romset${core.mraFiles.length === 1 || !core.mraFiles.length ? "" : "s"} · ${formatBytes(core.rbfSize)}`
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
                  <span className="core-source">Official MiSTer distribution</span>
                </section>
              );
            })}
            {!visible.length && <p className="core-empty">No cores match “{query}”.</p>}
          </div>
        </>
      )}
    </section>
  );
}

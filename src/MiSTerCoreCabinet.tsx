import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, HardDrive, LoaderCircle, RefreshCw } from "lucide-react";
import { CORE_CATEGORIES, MISTER_CORES, type CoreCategory, type MiSTerCoreDefinition } from "../electron/misterCores";

const open = (url: string) =>
  window.gameStore?.openExternal(url) ?? window.open(url, "_blank", "noopener");

type Filter = "all" | CoreCategory;

/**
 * The MiSTer Core Cabinet: browse arcade board recreations, home computers,
 * consoles, and console add-ons, and install one to the connected device.
 *
 * Mirrors `MiSTerManager`'s device-empty/connected shape so the two device
 * surfaces read as one product rather than two unrelated screens.
 */
export function MiSTerCoreCabinet({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null);
  const [status, setStatus] = useState("Checking your connected MiSTer…");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, MiSTerCoreInstallProgress>>({});

  const load = async () => {
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
    void load();
    return window.gameStore?.onMisterCoreInstallProgress((update) => {
      setProgress((current) => ({ ...current, [update.coreId]: update }));
      if (update.stage === "done" || update.stage === "error") {
        setInstallingId(null);
        if (update.stage === "done") void load();
      }
    });
  }, []);

  const install = async (core: MiSTerCoreDefinition) => {
    setInstallingId(core.id);
    setProgress((current) => ({
      ...current,
      [core.id]: { coreId: core.id, stage: "checking", message: `Checking the latest ${core.name} release…` },
    }));
    try {
      await window.gameStore!.installMisterCore(core.id);
    } catch {
      // The progress stream already carries the failure message; the button
      // state alone resets here.
      setInstallingId(null);
    }
  };

  const cores = useMemo(
    () => (filter === "all" ? MISTER_CORES : MISTER_CORES.filter((core) => core.category === filter)),
    [filter],
  );
  const installedCount = installed ? Object.values(installed).filter(Boolean).length : 0;

  return (
    <section className="mister-manager core-cabinet">
      <div className="mister-heading">
        <div>
          <p className="eyebrow">MISTER / CORE CABINET</p>
          <h1>MiSTer Cores</h1>
          <p>Arcade board recreations, home computers, consoles, and console add-ons for your connected MiSTer.</p>
        </div>
        <button className="export" onClick={() => void load()}>
          <RefreshCw /> Refresh
        </button>
      </div>
      {installed === null ? (
        <div className="device-empty">
          <HardDrive />
          <h2>MiSTer unavailable</h2>
          <p>{status}</p>
          <button onClick={onOpenSettings}>Open device settings</button>
        </div>
      ) : (
        <>
          <p className="device-status">
            {status} · {installedCount}/{MISTER_CORES.length} cataloged cores installed
          </p>
          <div className="platforms">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              All cores
            </button>
            {CORE_CATEGORIES.map((category) => (
              <button key={category.id} className={filter === category.id ? "active" : ""} onClick={() => setFilter(category.id)}>
                {category.label}
              </button>
            ))}
          </div>
          <div className="core-grid">
            {cores.map((core) => {
              const isInstalled = installed[core.id];
              const state = progress[core.id];
              const busy = installingId === core.id;
              return (
                <section className={isInstalled ? "core-card installed" : "core-card"} key={core.id}>
                  <div className="core-card-head">
                    <b>{core.name}</b>
                    <span>{isInstalled ? (<><CheckCircle2 /> Installed</>) : "Not installed"}</span>
                  </div>
                  <p className="core-category">{CORE_CATEGORIES.find((category) => category.id === core.category)?.label}</p>
                  <p>{core.description}</p>
                  <ul className="core-requirements">
                    {core.requirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                  {state && state.stage !== "done" && (
                    <p className={`core-progress ${state.stage}`}>
                      {state.stage === "error" ? state.message : (<><LoaderCircle className="spin" /> {state.message}</>)}
                    </p>
                  )}
                  <button disabled={busy} onClick={() => void install(core)}>
                    {busy ? (<><LoaderCircle className="spin" /> Installing…</>) : (<><Download /> {isInstalled ? "Reinstall latest" : "Install to MiSTer"}</>)}
                  </button>
                  <button className="core-source" onClick={() => open(`https://github.com/${core.repo}`)}>
                    Source: {core.repo}
                  </button>
                </section>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

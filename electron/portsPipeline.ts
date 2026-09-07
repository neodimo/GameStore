import type { PcOs } from "./pcTarget";

/**
 * The Ports install pipeline.
 *
 * A port is not one artifact, it is two that have to meet on the target
 * machine: the project's pre-built binary, and the user's own dump of the
 * original game. Emulator deployment never had this problem — a ROM plus an
 * installed core was the whole story. Here the binary is useless without the
 * data and the data is useless without the binary, and either half can be
 * missing for a different reason that the user has to be told about
 * specifically.
 *
 * So this module's job is to turn "install this port" into an explicit plan
 * with named blockers, before anything is downloaded or written. Everything
 * here is pure: the plan is computed and asserted in tests, and only `main.ts`
 * executes it.
 */

/** A published binary attached to a GitHub release. */
export type ReleaseAsset = {
  name: string;
  downloadUrl: string;
  size: number;
};

export type PortRelease = {
  tag: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
};

/** Files that ride along with a release and are never the thing to install. */
const ASSET_NOISE = /\.(blockmap|sha256|sha1|md5|txt|asc|sig|json|yml|yaml)$/i;
const SOURCE_ARCHIVE = /^(source[-_ ]?code|.*-src)\.(zip|tar\.gz|tgz)$/i;

/** OS tokens that positively identify an asset as built for that platform. */
/**
 * `x64` and `amd64` are deliberately absent here: this scene's Linux builds
 * name their architecture the same way ("SoH-linux-x64.AppImage",
 * "GameStore-amd64.deb"), so treating a bare architecture token as Windows
 * evidence let a Linux-only asset outscore an actual Windows build whenever
 * both happened to share it.
 */
const OS_TOKENS: Record<PcOs, RegExp> = {
  windows: /(^|[^a-z])(win(dows)?(32|64)?|w64|msvc)([^a-z]|$)/i,
  linux: /(^|[^a-z])(linux|ubuntu|appimage|x86_64|deb|rpm)([^a-z]|$)/i,
  mac: /(^|[^a-z])(mac(os)?|osx|darwin|universal)([^a-z]|$)/i,
};

/** Tokens that rule an asset out regardless of what else it matches. */
const FOREIGN_TOKENS = /(android|\.apk$|ios|\.ipa$|vita|\bpsp\b|switch|\.nro$|wiiu|\.vpk$)/i;

/**
 * Container formats GameStore can actually open, and what to do with each.
 *
 * `raw` means the asset is the program itself and only needs copying. Anything
 * this function returns null for is refused earlier rather than downloaded and
 * then abandoned: a `.7z` or `.dmg` would download fine and leave the user with
 * a file the app cannot unpack, which is worse than saying so before the fetch.
 */
export type ArchiveKind = "zip" | "tar.gz" | "appimage" | "raw";

export function archiveKind(name: string): ArchiveKind | null {
  if (/\.zip$/i.test(name)) return "zip";
  if (/\.(tar\.gz|tgz)$/i.test(name)) return "tar.gz";
  if (/\.appimage$/i.test(name)) return "appimage";
  if (/\.(7z|rar|dmg|pkg|msi|deb|rpm|tar\.(xz|bz2|zst))$/i.test(name)) return null;
  return "raw";
}

/**
 * Picks the release asset to install for a target OS.
 *
 * Scored rather than first-match because release naming in this scene is not
 * standardized: the same project may ship `SoH-Windows.zip`, `soh-win64.7z`
 * and `soh.AppImage` in one release, and a Linux user handed the `.7z` because
 * it sorted first gets a broken install. An AppImage outranks a tarball on
 * Linux for the same reason — it is the artifact that runs without a build
 * step, which is the entire promise of this pipeline.
 */
export function selectReleaseAsset(assets: ReleaseAsset[], os: PcOs): ReleaseAsset | null {
  const scored = assets
    .filter((asset) => !ASSET_NOISE.test(asset.name) && !SOURCE_ARCHIVE.test(asset.name))
    .filter((asset) => !FOREIGN_TOKENS.test(asset.name))
    .filter((asset) => archiveKind(asset.name) !== null)
    .map((asset) => {
      let score = 0;
      if (OS_TOKENS[os].test(asset.name)) score += 100;
      // A file claiming a different desktop OS is disqualified outright, so a
      // `-macos.zip` never wins a Windows install just by being the only zip.
      for (const other of ["windows", "linux", "mac"] as PcOs[]) {
        if (other !== os && OS_TOKENS[other].test(asset.name) && !OS_TOKENS[os].test(asset.name)) {
          score -= 1000;
        }
      }
      if (os === "linux" && /\.appimage$/i.test(asset.name)) score += 50;
      if (os === "windows" && /\.zip$/i.test(asset.name)) score += 20;
      if (os === "linux" && /\.(tar\.gz|tgz|zip)$/i.test(asset.name)) score += 10;
      // Installers mutate the target's system state; portable archives don't.
      if (/\.(exe|msi)$/i.test(asset.name)) score -= 30;
      return { asset, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.asset.size - a.asset.size);
  return scored[0]?.asset ?? null;
}

/**
 * Where a port is installed on the target.
 *
 * Ports get their own tree rather than sharing the emulator ROM directories:
 * a port is an application with its own save data and config next to the
 * executable, and dropping one into RetroArch's Flatpak sandbox would put it
 * somewhere only RetroArch can read.
 */
export const portInstallDirectory = (os: PcOs, home: string, portId: string): string =>
  os === "windows"
    ? [home, "GameStore", "ports", portId].join("\\")
    : [home, ".local", "share", "GameStore", "ports", portId].join("/");

const EXECUTABLE_ORDER = [".exe", ".appimage", ".sh", ""];

/**
 * Finds the binary to launch inside an extracted release.
 *
 * `hint` comes from curation and wins when present. Otherwise the shallowest
 * candidate wins, because ports habitually ship their launcher at the archive
 * root and their dependencies in subdirectories — a depth-first pick tends to
 * land on a bundled tool like `crashreporter.exe` instead of the game.
 */
export function pickPortExecutable(files: string[], hint?: string): string | null {
  const base = (file: string) => file.replace(/\\/g, "/").split("/").pop() ?? file;
  const depth = (file: string) => file.replace(/\\/g, "/").split("/").length;
  if (hint) {
    const exact = files.find((file) => base(file).toLowerCase() === hint.toLowerCase());
    if (exact) return exact;
  }
  const candidates = files.filter((file) => {
    const name = base(file).toLowerCase();
    if (/(unins|crash|report|setup|vcredist|updater|helper)/.test(name)) return false;
    return /\.(exe|appimage|sh)$/i.test(name) || !name.includes(".");
  });
  if (!candidates.length) return null;
  const rank = (file: string) => {
    const name = base(file).toLowerCase();
    const dot = name.lastIndexOf(".");
    const extension = dot < 0 ? "" : name.slice(dot);
    const index = EXECUTABLE_ORDER.indexOf(extension);
    return index < 0 ? EXECUTABLE_ORDER.length : index;
  };
  return [...candidates].sort((a, b) => depth(a) - depth(b) || rank(a) - rank(b))[0];
}

/** A native-executable Steam launch, as opposed to the RetroArch core launch. */
export type PortLaunch = { exe: string; startDir: string; launchOptions: string };

/**
 * Builds the Steam shortcut command line for an installed port.
 *
 * `startDir` is the install directory rather than the executable's parent for
 * a practical reason: these ports resolve their asset archive, config and save
 * files relative to the working directory, so a shortcut launched from
 * elsewhere starts and then immediately fails to find its own data.
 */
export function buildPortLaunch(os: PcOs, installDir: string, executable: string): PortLaunch {
  const separator = os === "windows" ? "\\" : "/";
  const full = executable.startsWith(installDir)
    ? executable
    : [installDir, executable].join(separator);
  return {
    exe: `"${full}"`,
    startDir: `"${installDir}${separator}"`,
    launchOptions: "",
  };
}

/** Why an install cannot proceed. Each maps to a specific user action. */
export type PortInstallBlocker =
  | { kind: "no-published-binary"; message: string }
  | { kind: "unsupported-target"; message: string }
  | { kind: "missing-game-data"; message: string }
  | { kind: "no-installable-asset"; message: string };

export type PortInstallStep =
  | { kind: "acquire-game-data"; source: "library" | "curated-download"; detail: string }
  | { kind: "download-release"; asset: string; url: string; bytes: number }
  | { kind: "extract-release"; detail: string }
  | { kind: "place-game-data"; files: string[]; detail: string }
  | { kind: "transfer-to-target"; directory: string }
  | { kind: "register-steam-shortcut"; detail: string };

export type PortInstallPlan = {
  portId: string;
  title: string;
  targetOs: PcOs;
  installDirectory: string;
  steps: PortInstallStep[];
  blockers: PortInstallBlocker[];
  /** Only true when every prerequisite is satisfied and the plan can run. */
  ready: boolean;
};

/** The catalog fields the planner needs. Keeps `electron/` off the renderer's types. */
export type PlannablePort = {
  id: string;
  title: string;
  needsOriginalAssets: boolean;
  distributionKind: "github-releases" | "user-assets-required";
  deployTargets: string[];
  executableHint?: string;
  downloadUrl?: string;
  requiredRomRevision?: string;
};

const TARGET_LABEL: Record<PcOs, string> = {
  windows: "Windows",
  linux: "Linux",
  mac: "macOS",
};

/**
 * Computes the full install plan up front, including every reason it cannot run.
 *
 * All blockers are collected rather than returning on the first one. A user
 * whose port has no Linux build *and* no game data in the library should learn
 * both facts from one click, instead of fixing one and discovering the other.
 */
export function planPortInstall(args: {
  entry: PlannablePort;
  targetOs: PcOs;
  home: string;
  /** Absolute paths to the user's own dump of the original game, if held. */
  gameDataFiles: string[];
  release: PortRelease | null;
}): PortInstallPlan {
  const { entry, targetOs, home, gameDataFiles, release } = args;
  const blockers: PortInstallBlocker[] = [];
  const steps: PortInstallStep[] = [];
  const installDirectory = portInstallDirectory(targetOs, home, entry.id);

  if (entry.distributionKind !== "github-releases" || !release) {
    blockers.push({
      kind: "no-published-binary",
      message: `${entry.title} has no published binary. The project ships source only, so it has to be built before GameStore can install it.`,
    });
  }
  if (!entry.deployTargets.includes(TARGET_LABEL[targetOs])) {
    blockers.push({
      kind: "unsupported-target",
      message: `This port publishes no ${TARGET_LABEL[targetOs]} build. Available: ${entry.deployTargets.join(", ") || "none GameStore can deploy"}.`,
    });
  }

  if (entry.needsOriginalAssets) {
    if (gameDataFiles.length) {
      steps.push({
        kind: "acquire-game-data",
        source: "library",
        detail: `Using ${gameDataFiles.length} file(s) already in your library.`,
      });
    } else if (entry.downloadUrl) {
      steps.push({
        kind: "acquire-game-data",
        source: "curated-download",
        detail: "Fetching the original game through the configured MiNERVA / Real-Debrid source.",
      });
    } else {
      blockers.push({
        kind: "missing-game-data",
        message: entry.requiredRomRevision
          ? `${entry.title} needs your own dump of the original game (${entry.requiredRomRevision}). Add it to your library, or set a download source for this entry.`
          : `${entry.title} needs your own dump of the original game. Add it to your library, or set a download source for this entry.`,
      });
    }
  }

  const asset = release ? selectReleaseAsset(release.assets, targetOs) : null;
  if (release && !asset) {
    blockers.push({
      kind: "no-installable-asset",
      message: `Release ${release.tag} publishes nothing GameStore can unpack for ${TARGET_LABEL[targetOs]} — it recognises .zip, .tar.gz, .AppImage and bare executables. Open the release page and install manually.`,
    });
  }
  if (asset) {
    steps.push({ kind: "download-release", asset: asset.name, url: asset.downloadUrl, bytes: asset.size });
    steps.push({ kind: "extract-release", detail: `Unpacking ${asset.name} into a staging folder.` });
  }

  if (entry.needsOriginalAssets && (gameDataFiles.length || entry.downloadUrl)) {
    steps.push({
      kind: "place-game-data",
      files: gameDataFiles,
      detail: "Copying the original game next to the port so its first run can extract assets.",
    });
  }
  steps.push({ kind: "transfer-to-target", directory: installDirectory });
  steps.push({
    kind: "register-steam-shortcut",
    detail: "Adding a Steam shortcut that launches the port directly, with library artwork.",
  });

  return {
    portId: entry.id,
    title: entry.title,
    targetOs,
    installDirectory,
    steps,
    blockers,
    ready: blockers.length === 0,
  };
}

/** One-line summary for the card, so the UI never has to re-derive the reason. */
export const planSummary = (plan: PortInstallPlan): string =>
  plan.ready
    ? `${plan.steps.length} steps — installs to ${plan.installDirectory}`
    : plan.blockers.map((blocker) => blocker.message).join(" ");

/**
 * The MiSTer specialty-core registry: arcade board recreations, home
 * computers, consoles, and console hardware add-ons, alongside the game
 * library's own PS1/N64/Saturn registry in `electron/devicePlatforms.ts`.
 *
 * Lives here for the same build reason as that file: the desktop tsconfig
 * compiles `electron/*.ts` flat into `dist-electron/`, so a module pulled in
 * from `src/` would raise the common root and move `main.js`. Nothing here may
 * import Electron or Node — the renderer bundles it directly through Vite.
 *
 * Every field below was read from the live MiSTer-devel GitHub organization
 * and the official `MiSTer-devel/Distribution_MiSTer` base image (checked
 * 2026-08-28), not guessed. Two naming facts only show up by inspecting a real
 * device image rather than a core's own repository:
 *
 * - Arcade cores are split in two: the game's `.mra` sits directly in
 *   `_Arcade`, but its `.rbf` sits in `_Arcade/cores/` under the core's short
 *   name with the repo's `Arcade-` prefix stripped (`Arcade-DonkeyKong_MiSTer`
 *   publishes `Arcade-DonkeyKong_<date>.rbf`, installed as
 *   `_Arcade/cores/DonkeyKong_<date>.rbf`).
 * - A repository's own filename is not always its installed filename: the
 *   `Genesis_MiSTer` repository still publishes `Genesis_<date>.rbf`, but the
 *   official distribution installs it as `_Console/MegaDrive_<date>.rbf`.
 *
 * `repoRbfPrefix` and `installedRbfPrefix` are therefore deliberately separate
 * fields rather than one assumed-equal name, the same reasoning that keeps a
 * catalog identity separate from a device core folder in `devicePlatforms.ts`.
 */

export type CoreCategory = "arcade" | "computer" | "console" | "addon";

export type CoreFolder = "_Arcade" | "_Computer" | "_Console";

export const CORE_CATEGORIES: { id: CoreCategory; label: string; folder: CoreFolder }[] = [
  { id: "arcade", label: "Arcade board recreations", folder: "_Arcade" },
  { id: "computer", label: "Home computers", folder: "_Computer" },
  { id: "console", label: "Consoles", folder: "_Console" },
  // A real MiSTer keeps add-on cores in the same `_Console` folder as a main
  // system; "add-on" is a GameStore curation grouping, not a device-level
  // folder split.
  { id: "addon", label: "Console add-ons", folder: "_Console" },
];

export type MiSTerCoreDefinition = {
  id: string;
  name: string;
  category: CoreCategory;
  /** `owner/repo` on GitHub; every core here is published under MiSTer-devel. */
  repo: string;
  /** Filename prefix inside that repo's own `releases/` folder. */
  repoRbfPrefix: string;
  /** Filename prefix as the core is actually named once installed on a device. */
  installedRbfPrefix: string;
  /** Exact `.mra` filename in `_Arcade`, published in the same `releases/` folder. Arcade only. */
  mraFile?: string;
  description: string;
  requirements: string[];
};

export const MISTER_CORES: MiSTerCoreDefinition[] = [
  {
    id: "arcade-donkey-kong",
    name: "Donkey Kong",
    category: "arcade",
    repo: "MiSTer-devel/Arcade-DonkeyKong_MiSTer",
    repoRbfPrefix: "Arcade-DonkeyKong",
    installedRbfPrefix: "DonkeyKong",
    mraFile: "Donkey Kong (US, Set 1).mra",
    description: "FPGA recreation of the original Donkey Kong arcade board logic, not an emulator.",
    requirements: ["Original arcade ROM set", "5:4 or 4:3 display"],
  },
  {
    id: "arcade-pac-man",
    name: "Pac-Man",
    category: "arcade",
    repo: "MiSTer-devel/Arcade-Pacman_MiSTer",
    repoRbfPrefix: "Arcade-Pacman",
    installedRbfPrefix: "Pacman",
    mraFile: "Pac-Man - Puck Man (JP, Set 1).mra",
    description: "Namco/Midway Pac-Man board core. Ships against the Puck Man (Japan) ROM set.",
    requirements: ["Original arcade ROM set", "4:3 display"],
  },
  {
    id: "arcade-galaga",
    name: "Galaga",
    category: "arcade",
    repo: "MiSTer-devel/Arcade-Galaga_MiSTer",
    repoRbfPrefix: "Arcade-Galaga",
    installedRbfPrefix: "Galaga",
    mraFile: "Galaga (Midway, Set 1).mra",
    description: "Namco Galaxian-series board core covering the Midway US Galaga revision.",
    requirements: ["Original arcade ROM set", "4:3 display"],
  },
  {
    id: "arcade-centipede",
    name: "Centipede",
    category: "arcade",
    repo: "MiSTer-devel/Arcade-Centipede_MiSTer",
    repoRbfPrefix: "Arcade-Centipede",
    installedRbfPrefix: "Centipede",
    mraFile: "Centipede (Rev 4).mra",
    description: "Atari trackball-era board core, playable with a mouse or spinner as well as a d-pad.",
    requirements: ["Original arcade ROM set", "Trackball, spinner, or mouse recommended"],
  },
  {
    id: "arcade-defender",
    name: "Defender",
    category: "arcade",
    repo: "MiSTer-devel/Arcade-Defender_MiSTer",
    repoRbfPrefix: "Arcade-Defender",
    installedRbfPrefix: "Defender",
    mraFile: "Defender (Red Label).mra",
    description: "Williams Defender board core, the Red Label revision. Its sibling romsets share the same core.",
    requirements: ["Original arcade ROM set", "Multi-button control layout"],
  },
  {
    id: "computer-c64",
    name: "Commodore 64",
    category: "computer",
    repo: "MiSTer-devel/C64_MiSTer",
    repoRbfPrefix: "C64",
    installedRbfPrefix: "C64",
    description: "Full C64 computer core: disk/tape formats, joystick ports, and its own on-screen keyboard.",
    requirements: ["D64/T64/CRT software images", "Keyboard for BASIC/disk commands"],
  },
  {
    id: "computer-atari-st",
    name: "Atari ST",
    category: "computer",
    repo: "MiSTer-devel/AtariST_MiSTer",
    repoRbfPrefix: "AtariST",
    installedRbfPrefix: "AtariST",
    description: "TOS-booting Atari ST core with ST/STE chipset options and floppy disk image support.",
    requirements: ["TOS ROM image", "ST/MSA/ST disk images"],
  },
  {
    id: "computer-apple-ii",
    name: "Apple II",
    category: "computer",
    repo: "MiSTer-devel/Apple-II_MiSTer",
    repoRbfPrefix: "Apple-II",
    installedRbfPrefix: "Apple-II",
    description: "Apple II/II+/IIe core with disk (DSK/PO/NIB) and Disk II drive emulation.",
    requirements: ["DSK/PO/NIB software images", "Keyboard for most software"],
  },
  {
    id: "computer-ao486",
    name: "ao486 (PC compatible)",
    category: "computer",
    repo: "MiSTer-devel/ao486_MiSTer",
    repoRbfPrefix: "ao486",
    installedRbfPrefix: "ao486",
    description: "486-class IBM PC-compatible core: BIOS boot, IDE hard disk image, and DOS-era software.",
    requirements: ["PC BIOS image", "IDE hard disk image", "Keyboard and mouse"],
  },
  {
    id: "console-nes",
    name: "Nintendo Entertainment System",
    category: "console",
    repo: "MiSTer-devel/NES_MiSTer",
    repoRbfPrefix: "NES",
    installedRbfPrefix: "NES",
    description: "NES/Famicom core with mapper coverage for the large majority of the cartridge library.",
    requirements: ["NES/FDS cartridge images"],
  },
  {
    id: "console-snes",
    name: "Super Nintendo Entertainment System",
    category: "console",
    repo: "MiSTer-devel/SNES_MiSTer",
    repoRbfPrefix: "SNES",
    installedRbfPrefix: "SNES",
    description: "SNES core covering the standard cartridge library plus most enhancement-chip titles.",
    requirements: ["SNES cartridge images", "Enhancement-chip BIOS files for some titles"],
  },
  {
    id: "console-genesis",
    name: "Sega Genesis / Mega Drive",
    category: "console",
    repo: "MiSTer-devel/Genesis_MiSTer",
    repoRbfPrefix: "Genesis",
    installedRbfPrefix: "MegaDrive",
    description: "Sega Genesis/Mega Drive core. Installs under the Mega Drive name the official distribution ships it as.",
    requirements: ["Genesis/Mega Drive cartridge images"],
  },
  {
    id: "console-turbografx16",
    name: "TurboGrafx-16 / PC Engine",
    category: "console",
    repo: "MiSTer-devel/TurboGrafx16_MiSTer",
    repoRbfPrefix: "TurboGrafx16",
    installedRbfPrefix: "TurboGrafx16",
    description: "TurboGrafx-16/PC Engine core with HuCard and CD add-on support.",
    requirements: ["HuCard images", "CD BIOS + CHD/BIN-CUE for CD software"],
  },
  {
    id: "console-gameboy",
    name: "Game Boy / Game Boy Color",
    category: "console",
    repo: "MiSTer-devel/Gameboy_MiSTer",
    repoRbfPrefix: "Gameboy",
    installedRbfPrefix: "Gameboy",
    description: "Game Boy and Game Boy Color core with cartridge save-RAM and real-time-clock support.",
    requirements: ["GB/GBC cartridge images"],
  },
  {
    id: "addon-sega-cd",
    name: "Sega CD / Mega-CD",
    category: "addon",
    repo: "MiSTer-devel/MegaCD_MiSTer",
    repoRbfPrefix: "MegaCD",
    installedRbfPrefix: "MegaCD",
    description: "Sega CD hardware add-on core: the original Genesis/Mega Drive plus its CD-ROM expansion.",
    requirements: ["Sega CD/Mega-CD BIOS image", "CHD or BIN/CUE disc images"],
  },
  {
    id: "addon-32x",
    name: "Sega 32X",
    category: "addon",
    repo: "MiSTer-devel/S32X_MiSTer",
    repoRbfPrefix: "S32X",
    installedRbfPrefix: "S32X",
    description: "Sega 32X hardware add-on core: the Genesis/Mega Drive plus its 32-bit expansion.",
    requirements: ["32X cartridge images"],
  },
];

const byId = new Map(MISTER_CORES.map((core) => [core.id, core]));
export const coreById = (id: string) => byId.get(id);

const byCategory = new Map(CORE_CATEGORIES.map((category) => [category.id, category]));
export const coreCategoryFolder = (category: CoreCategory): CoreFolder =>
  (byCategory.get(category) ?? CORE_CATEGORIES[2]).folder;

/** Whether a listed device filename is this core's installed rbf, dated or not. */
export const matchesInstalledRbf = (core: MiSTerCoreDefinition, filename: string) => {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".rbf")) return false;
  const base = lower.slice(0, -4);
  const prefix = core.installedRbfPrefix.toLowerCase();
  return base === prefix || base.startsWith(`${prefix}_`);
};

/**
 * Curated translation-patch manifest.
 *
 * This file is hand-maintained on purpose. No provider offers a translation
 * patch API: ROMhacking.net closed and now returns HTTP 403, its database was
 * preserved on the Internet Archive, and the successor communities publish no
 * machine-readable index — romhack.ing's `robots.txt` is `Disallow: /`. The
 * only machine-readable mirror of the old database covers cartridge systems
 * and holds no PlayStation patches. A short curated list is therefore the
 * honest substitute for the API that does not exist.
 *
 * What each record is for: the `target` serial names the exact Redump release
 * the patch was built against, which `scripts/import-redump-targets.py`
 * resolves into real size and hashes. That is what turns "verify the source
 * image before patching" from an intention into something GameStore can
 * actually do, because IPS and PPF — the two formats PlayStation translations
 * overwhelmingly ship as — carry no checksum of their own.
 *
 * `targetVerified` is deliberately separate from having a serial. It means
 * someone confirmed *which* release this specific patch expects, not merely
 * that a plausible serial exists. Seeding it as `false` is a statement that
 * the work has not been done, and the patch manager refuses to write an image
 * it cannot vouch for rather than guessing.
 */
import { redumpTargets } from "./redumpTargets";

export type PatchContainer = "ips" | "ups" | "bps" | "ppf" | "xdelta";

export type TranslationRecord = {
  /** Catalog id in `src/catalog.ts`. */
  gameId: string;
  /** Repeated from the catalog so this file reads on its own. */
  title: string;
  team: string;
  status: "Complete" | "Partial";
  /**
   * Patch page to open for the manual download step. Omitted when no live URL
   * has been confirmed; discovery then falls back to a search.
   */
  page?: string;
  patch: {
    container: PatchContainer;
    /** Expected file name inside the downloaded archive, when known. */
    file?: string;
    /** SHA-256 of the patch file itself. Absent until a release is checked. */
    sha256?: string;
    /** Published checksum of the successfully patched image, when available. */
    outputSha1?: string;
  };
  target: {
    /**
     * Redump release name of the disc the patch applies to. A serial alone is
     * not a unique key — 403 PlayStation serials in the DAT cover more than one
     * image, because a revision keeps its predecessor's serial — so the release
     * name and the serial together are what identify one disc.
     */
    release: string;
    /** Redump serial of that release, kept as a cross-check. */
    serial: string;
    /** Disc number for multi-disc sets, 1-based. */
    disc?: number;
    /** True only once the patch's expected release has actually been confirmed. */
    targetVerified: boolean;
  };
  notes?: string;
};

/**
 * A game's curated record joined to the Redump hashes for the disc it targets.
 * `target` is null only if the generated table and the manifest have drifted,
 * which `translationManifest.test.ts` fails the build over.
 */
export const translationFor = (gameId: string) => {
  const record = translationManifest.find((entry) => entry.gameId === gameId);
  if (!record) return null;
  const target = redumpTargets.find(
    (entry) => entry.release === record.target.release && entry.serial === record.target.serial,
  );
  return { record, target: target ?? null };
};

export const translationManifest: TranslationRecord[] = [
  {
    gameId: "harmful-park",
    title: "Harmful Park",
    team: "LIPEMCO! Translations",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Harmful Park (Japan)", serial: "SLPS-00498", targetVerified: false },
  },
  {
    gameId: "planet-laika",
    title: "Planet Laika",
    team: "Fan translation",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Planet Laika (Japan)", serial: "SLPM-86264", targetVerified: false },
  },
  {
    gameId: "racing-lagoon",
    title: "Racing Lagoon",
    team: "Hilltop Works",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Racing Lagoon (Japan, Asia)", serial: "SLPS-02038", targetVerified: false },
  },
  {
    gameId: "mizzurna-falls",
    title: "Mizzurna Falls",
    team: "nikita600 / Cirosan / Resident Evie",
    status: "Complete",
    page: "https://romhack.ing/database/content/entry/DNNv5JQBNs8FWu0C5oRp",
    patch: {
      container: "xdelta",
      file: "ProjectMizzurnaBeta.xdelta",
      outputSha1: "8239544d8ee3af231964d435fc6d9d8c5b496fe0",
    },
    target: { release: "Mizzurna Falls (Japan)", serial: "SLPS-01783", targetVerified: true },
    notes: "The published installer directions confirm the Redump source SHA-1 and the translated output SHA-1.",
  },
  {
    gameId: "paranoiascape",
    title: "ParanoiaScape",
    team: "Aeon Genesis",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Paranoia Scape (Japan)", serial: "SLPS-01375", targetVerified: false },
  },
  {
    gameId: "remote-control-dandy",
    title: "Remote Control Dandy",
    team: "Fan translation",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Remote Control Dandy (Japan)", serial: "SLPS-02243", targetVerified: false },
  },
  {
    gameId: "germs",
    title: "Germs: Nerawareta Machi",
    team: "Fan translation",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Germs - Nerawareta Machi (Japan)", serial: "SLPS-02107", targetVerified: false },
  },
  {
    gameId: "ore-no-ryouri",
    title: "Ore no Ryouri",
    team: "Hilltop Works",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Ore no Ryouri (Japan)", serial: "SCPS-10099", targetVerified: false },
  },
  {
    gameId: "baroque",
    title: "Baroque",
    team: "Fan translation",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Baroque - Yuganda Mousou (Japan) (Genteiban)", serial: "SLPM-86328", targetVerified: false },
    notes:
      "The catalog's serial resolves to the Genteiban limited edition. Redump also lists a standard release as SLPM-86759, and the two are different images. Which one the patch targets is unconfirmed.",
  },
  {
    gameId: "tobal-2",
    title: "Tobal No. 2",
    team: "Infinite Lupine",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Tobal 2 (Japan, Asia)", serial: "SLPM-86033", targetVerified: false },
    notes:
      "The catalog recorded SLPS-01025, which in Redump is Dare Devil Derby 3D — a different game entirely. Redump lists Tobal 2 as SLPM-86033 and SCPS-45025, plus a Rev 1 at SLPM-87406. Corrected to SLPM-86033 pending confirmation of which the patch expects.",
  },
  {
    gameId: "linda-cube",
    title: "Linda³ Again",
    team: "Fan translation",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Linda^3 Again (Japan)", serial: "SCPS-10039", targetVerified: false },
    notes:
      "The catalog recorded SCPS-45124, which Redump does not list at all. Redump has SCPS-10039 and a Rev 1 under SCPS-91142. Corrected to SCPS-10039 pending confirmation.",
  },
  {
    gameId: "kowloons-gate",
    title: "Kowloon’s Gate",
    team: "Hilltop / Cargodin / EsperKnight",
    status: "Complete",
    patch: { container: "ppf" },
    target: { release: "Kowloon's Gate - Kowloon Fuusuiden (Japan) (Disc 1) (Byakko)", serial: "SLPS-00706", disc: 1, targetVerified: false },
    notes:
      "A four-disc set: SLPS-00706 through SLPS-00709. Only disc 1 is modelled here; whole-set patching needs a per-disc record each with its own target and is not implemented.",
  },
];

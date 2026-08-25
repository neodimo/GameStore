import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { applyPatch, crc32of, detectPatchFormat, PatchError, PatchVerification } from "./patchFormats";
import { decodeSync as decodeXdelta } from "@chainsafe/xdelta3-node";

/**
 * Applies a translation patch to a disc image under the project's standing
 * rules: the verified source image is never modified, the translated image is a
 * separate copy, and that copy keeps the catalog's canonical original release
 * filename so the normal artwork scraper still finds its box art. The copy is
 * marked as translated by the folder it lands in and by a provenance record,
 * never by renaming the file.
 *
 * Verification is the point of this module rather than a step inside it. A
 * PlayStation translation almost always ships as a PPF, and PPF — like IPS —
 * carries no checksum of the image it was built from. So the check has to come
 * from somewhere else: either the patch container proves the source itself
 * (BPS and UPS embed a source and target CRC32), or the curated manifest names
 * a Redump release whose SHA-1 we hold. With neither, this refuses to write.
 */
export type TranslationTarget = {
  release: string;
  serial: string;
  size: number;
  crc32: string;
  sha1: string;
};

export type TranslationRequest = {
  gameId: string;
  sourcePath: string;
  patchPath: string;
  destinationDirectory: string;
  /** Canonical original release filename the output must keep. */
  outputName: string;
  target?: TranslationTarget;
  expectedPatchSha256?: string;
  expectedOutputSha1?: string;
  team?: string;
  /**
   * Applies a patch that could not be proven against this image. Recorded in
   * the provenance entry, because an unverifiable result should stay visible
   * long after the dialog that allowed it.
   */
  allowUnverifiedSource?: boolean;
};

export type TranslationProvenance = {
  gameId: string;
  appliedAt: string;
  team?: string;
  container: string;
  verification: PatchVerification | "manifest-sha1";
  unverifiedSourceAccepted: boolean;
  patch: { file: string; sha256: string };
  source: { file: string; size: number; crc32: string; sha1: string };
  output: { file: string; size: number; sha1: string };
  target?: TranslationTarget;
};

export class TranslationRefused extends Error {}

const sha1of = (data: Buffer) => createHash("sha1").update(data).digest("hex");
const sha256of = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const hex32 = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

type ProvenanceIndex = { version: 1; applied: TranslationProvenance[] };
const emptyProvenance = (): ProvenanceIndex => ({ version: 1, applied: [] });
const provenancePath = (root: string) => path.join(root, "translations.json");

export const readProvenance = async (root: string): Promise<TranslationProvenance[]> => {
  try {
    const value = JSON.parse(await fs.readFile(provenancePath(root), "utf8"));
    return value?.version === 1 && Array.isArray(value.applied) ? value.applied : [];
  } catch {
    return [];
  }
};

const writeProvenance = async (root: string, entry: TranslationProvenance) => {
  const applied = await readProvenance(root);
  const index: ProvenanceIndex = {
    ...emptyProvenance(),
    applied: [...applied.filter((existing) => existing.output.file !== entry.output.file), entry],
  };
  await fs.mkdir(root, { recursive: true });
  const target = provenancePath(root);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(index, null, 2));
  await fs.rename(temporary, target);
};

/**
 * Decides whether this image may be patched, before anything is written.
 *
 * A manifest SHA-1 is checked first because it is the stronger claim: it says
 * this is the exact Redump release the patch was authored against, where a
 * container's embedded CRC32 only says the bytes match whatever the patch
 * author happened to build from.
 */
const verifySource = (
  source: Buffer,
  container: string,
  target: TranslationTarget | undefined,
  allowUnverified: boolean,
) => {
  if (target) {
    if (source.length !== target.size)
      throw new TranslationRefused(
        `This image is ${source.length} bytes; ${target.release} is ${target.size}. ` +
          "Nothing was written.",
      );
    const actual = sha1of(source);
    if (actual !== target.sha1.toLowerCase())
      throw new TranslationRefused(
        `This image does not match ${target.release} (${target.serial}). Expected SHA-1 ` +
          `${target.sha1}, found ${actual}. Nothing was written.`,
      );
    return "manifest-sha1" as const;
  }
  // BPS and UPS refuse a wrong source inside applyPatch, so reaching the
  // patcher is itself the check for those two.
  if (container === "bps" || container === "ups") return "source-and-target-crc" as const;
  if (allowUnverified) return "none" as const;
  throw new TranslationRefused(
    `A ${container.toUpperCase()} patch carries no checksum of the image it was built from, and ` +
      "no verified release is recorded for this game, so GameStore cannot confirm this is the " +
      "right disc. Nothing was written.",
  );
};

/**
 * Rewrites a cue sheet's FILE references onto the patched image.
 *
 * The output keeps the canonical release filename, so in the common case this
 * substitution is a no-op — which is the point. It exists for the case where a
 * user's source file was named something else, so the copied sheet still
 * points at a file that exists.
 */
export const retargetCueSheet = (cue: string, fromFile: string, toFile: string) =>
  cue.replace(/^(\s*FILE\s+")([^"]+)(")/gim, (whole, open: string, name: string, close: string) =>
    path.basename(name) === fromFile ? `${open}${toFile}${close}` : whole);

export async function applyTranslation(
  libraryRoot: string,
  request: TranslationRequest,
): Promise<TranslationProvenance> {
  const patch = await fs.readFile(request.patchPath);
  const patchSha256 = sha256of(patch);
  if (request.expectedPatchSha256 && patchSha256 !== request.expectedPatchSha256.toLowerCase())
    throw new TranslationRefused(
      "This patch file is not the one recorded for this game. Expected SHA-256 " +
        `${request.expectedPatchSha256}, found ${patchSha256}. Nothing was written.`,
    );

  const container = detectPatchFormat(patch);
  if (!container)
    throw new TranslationRefused("Unrecognized patch file. GameStore applies IPS, UPS, BPS, PPF and xdelta patches.");

  const source = await fs.readFile(request.sourcePath);
  const verification = verifySource(source, container, request.target, request.allowUnverifiedSource ?? false);

  let applied;
  try {
    if (container === "xdelta") {
      // The previous WASM wrapper copied the source, patch and maximum output
      // into one fixed heap. Real CD images exhausted that heap and could turn
      // the resulting ENOMEM into a bogus typed-array length. The native N-API
      // decoder supports large PlayStation images and returns a normal owned
      // byte array; the source remains untouched either way.
      try {
        applied = { output: Buffer.from(decodeXdelta(source, patch)), verification: "none" as const };
      } catch (error) {
        throw new PatchError(
          `xdelta refused the patch (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
    } else {
      applied = applyPatch(source, patch);
    }
  } catch (error) {
    // A patch that fails mid-apply has still written nothing: the patched image
    // only exists in memory until the rename below.
    if (error instanceof PatchError) throw new TranslationRefused(`${error.message} Nothing was written.`);
    throw error;
  }

  const outputSha1 = sha1of(applied.output);
  if (request.expectedOutputSha1 && outputSha1 !== request.expectedOutputSha1.toLowerCase())
    throw new TranslationRefused(
      `The patched image failed its expected output check. Expected SHA-1 ${request.expectedOutputSha1}, ` +
        `found ${outputSha1}. Nothing was written.`,
    );

  await fs.mkdir(request.destinationDirectory, { recursive: true });
  const outputPath = path.join(request.destinationDirectory, request.outputName);
  if (path.resolve(outputPath) === path.resolve(request.sourcePath))
    throw new TranslationRefused("The translated copy would overwrite the source image. Nothing was written.");
  const temporary = `${outputPath}.partial`;
  await fs.writeFile(temporary, applied.output);
  await fs.rename(temporary, outputPath);

  const sourceCue = request.sourcePath.replace(/\.bin$/i, ".cue");
  if (/\.bin$/i.test(request.sourcePath)) {
    try {
      const cue = await fs.readFile(sourceCue, "utf8");
      await fs.writeFile(
        outputPath.replace(/\.bin$/i, ".cue"),
        retargetCueSheet(cue, path.basename(request.sourcePath), path.basename(outputPath)),
      );
    } catch {
      // A disc image without a sheet beside it is still a usable result.
    }
  }

  const entry: TranslationProvenance = {
    gameId: request.gameId,
    appliedAt: new Date().toISOString(),
    team: request.team,
    container,
    verification: verification === "none" ? applied.verification : verification,
    unverifiedSourceAccepted: verification === "none" && applied.verification === "none",
    patch: { file: path.basename(request.patchPath), sha256: patchSha256 },
    source: {
      file: path.basename(request.sourcePath),
      size: source.length,
      crc32: hex32(crc32of(source)),
      sha1: sha1of(source),
    },
    output: { file: path.basename(outputPath), size: applied.output.length, sha1: outputSha1 },
    target: request.target,
  };
  await writeProvenance(libraryRoot, entry);
  return entry;
}

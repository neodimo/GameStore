# PC ports: recomps, decomps and source ports

Status: **design, nothing implemented.** Requested by DiMo 2026-09-05 23:32 PDT.
Nothing in `src/` or `electron/` references any of this yet.

## What DiMo asked for

A section for retro games that now have native PC builds — decompilations,
static recompilations, source ports — sourced by combining GameStore's existing
MiNERVA/debrid acquisition with the port project's own release, then deployed to
the PC + Steam setup the same way console games already are.

## Why this fits GameStore rather than being a new app

The pipeline is four stages, and three of them already ship:

1. **Acquire the base game.** These projects legally ship *no* game assets — the
   user supplies the original ROM. GameStore already does exactly this for
   PS1/N64/Saturn: `config` collection-torrent source → `collectionIndex`
   file-manifest match → `realDebrid`/TorBox selective download →
   `libraryManager` organized local library. N64 is where most recomps live, and
   the N64 lane is already built.
2. **Fetch the port build.** New. GitHub Releases API, pick the asset matching
   the destination OS. No toolchain shipped — see "Prebuilt only" below.
3. **Marry ROM to build.** New, and per-project. Ship of Harkinian's binary
   consumes an OoT ROM and generates `oot.otr` on first launch;
   Zelda64Recomp's prebuilt binary is pointed at an MM ROM at startup. Each
   project has its own recipe, so this is a small table of recipes rather than
   one generic routine.
4. **Deploy to PC + Steam.** Already shipped in v0.26.2/v0.26.3: `pcTarget`
   (local or SSH remote, OS-probed), `steamDeploy` + `steamVdf` +
   `steamCollections`, and `steamGridDb` vertical art. A native PC port is a
   *cleaner* Steam shortcut than an emulator entry — a real executable with no
   RetroArch command line wrapped around it.

## Prebuilt only

Both reference projects state plainly that building is not required and that
prebuilt binaries contain no game assets
(<https://github.com/Zelda64Recomp/Zelda64Recomp>,
<https://www.shipofharkinian.com/setup-guide/linux>). GameStore should never
carry or invoke a C toolchain. If a port has no prebuilt release for the
destination OS, it does not belong in the section.

## Data model sketch

A PC port is not a `Game` — it is not a ROM headed for a Cart, and it has its
own versioning. Proposed separate record, keyed to a catalog game:

```
type PcPort = {
  id: string;
  baseGameId: string;              // existing catalog Game.id
  kind: "decomp" | "recomp" | "source-port";
  project: { name: string; url: string; repo: string };   // owner/name for Releases API
  pinnedTag: string;               // known-good; "latest" is opt-in, not default
  assets: { windows?: RegExp; linux?: RegExp };
  romRequirement: {
    platform: PlatformId;
    releaseName: string;           // No-Intro name
    sha1: string[];                // accepted dumps — exact, not fuzzy
    note?: string;                 // e.g. "US 1.0 only"
  };
  recipe: "soh-otr" | "recomp-first-run" | ...;
};
```

## The one hard engineering problem

**ROM revision matching has to become exact.** Recomps target a specific dump —
wrong revision means it refuses to start or corrupts extraction. GameStore's
current acquisition ranks candidates by fuzzy filename and region confidence,
which is right for "give me a playable copy" and wrong here. This lane needs
SHA-1 verification of the downloaded file against a known list, with a clear
failure message when the dump is close but not the required revision.

## Known risks

- **Interactive first run.** SoH's extraction opens a file picker. A headless
  remote deploy to Bazzite cannot click it. Mitigation: run extraction on the
  machine that will run the game, stage the ROM beside the binary, and either
  use a project's CLI extraction flag where one exists or hand the user one
  explicit click.
- **Release churn.** These projects ship often. Pin a known-good tag per port;
  "always latest" is an opt-in toggle, not the default.
- **Uneven project surface.** Every port has a different asset layout, config
  path and save location. Keep the recipe table small and honest; do not
  pretend a generic installer exists.
- **Section naming.** "PC Ports" reads to a normal person; "Recomps" is accurate
  to the scene. Undecided.

## Suggested first cut

One port, end to end, on the proven path: Ship of Harkinian (OoT) → Bazzite.
The N64 catalog lane, the debrid acquisition and the Steam deploy are all
already real, so the only new code is the Releases fetch, the SHA-1 gate and one
recipe. A catalog of ten ports on top of an unproven pipeline is the wrong
order.

## Open decisions for DiMo

1. First cut = one port proven end to end, or the generic section + a starting
   roster of ports?
2. Section name.
3. Roster: which ports matter to you (OoT/MM, SM64, Perfect Dark, Diablo,
   Tomb Raider, others)?

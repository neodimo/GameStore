# GameStore context

## Product premise

GameStore is a Windows and Linux retro-game discovery catalog inspired by the breadth of CDRomance-style platform browsing. It emphasizes official regional box artwork, English playability, unusually strong filtering, editorial similarity shelves, transparent source provenance, and in-place game details.

## Media plan

- Layered artwork/screenshot candidates from retro metadata providers, with exact release/revision scope preferred over region, platform, or game-level media.
- Candidate artwork is classified (front scan, full cover, reconstruction, 3D render) and never silently replaces a curated choice.
- Expanded details prioritize a large scrollable screenshot gallery beside a substantial 4:3 short-loop video pane; metadata, acquisition, transfer, and source links live in the right rail.
- Media records retain scope, region, provider ID, source, dimensions/duration, attribution, freshness, confidence, and override history.

## Distribution and storage invariant

- Keep the repository and installers media-light: ship executable code, UI assets, schemas, provider adapters, and compact textual/catalog metadata.
- Do not commit or package per-game covers, screenshots, video files, or bulk media archives. Users obtain those after installation through built-in auto-scrapers/providers.
- Downloads require an explicit user action or an enabled in-app cache policy. Show provider attribution, progress, failures, retries, cache size, and clear-cache controls.
- Store fetched media in the platform application-data/cache directory. Cache clearing must not erase favorites, catalog corrections, artwork override history, or provenance.
- Never bundle video. Resolve it from attributed providers; strictly matched previews under 120 MB may cache during the enabled startup audit, while oversized longplays are rejected as ambient previews. Playback uses the local file. Bundled media is limited to small app-owned assets such as the icon, logo, loading UI, and missing-media placeholders.
- CI should guard this invariant with repository/release size budgets and a check that rejects newly bundled per-game media.
- The enforced budgets and UI-asset allowlist live in `config/media-light.json`; `scripts/check-media-light.mjs` checks the source tree, compiled bundles, and platform artifacts in release CI.

## Current implementation

Version 0.8 is an Electron + React/TypeScript desktop application with matching Windows and Linux functionality. Its desktop shell follows the approved mockup direction: fixed navigation rail, global search, platform/filter bars, dense art-led shelves, and anchored inline details. It contains 100 PS1 games, local favorites/export, filters, Weird/Horror/Arcade/RPG shelves, translation records, media/video states, and stateful outbound sources. GitHub Actions builds a Windows NSIS installer plus Linux AppImage and Debian packages.

Box art resolves by fuzzy-matching the live Libretro thumbnail index rather than guessing one exact filename. The main process fetches and disk-caches the full No-Intro filename list per folder (7-day TTL, stale cache preferred over no artwork); the renderer scores it locally in `src/artMatch.ts`. Scoring blends word-level and character-level similarity over normalized titles, rewards the catalog region, and demotes demos, prototypes and later discs. Two floors apply: the automatic resolver keeps a strict 0.6 floor so it refuses rather than inventing a cover, while the manual deep-search panel browses at 0.3 because the user is choosing by eye. Right-clicking any game opens details, alternate-artwork search across box art/title screen/screenshot/TheGamesDB, or a reset to the automatic match; overrides persist locally with their source label. Measured against the live 9,339-file index, the 30-game slice resolves 30/30 with no incorrect picks, against 13/30 for the previous seeded-filename path.

Libretro Thumbnails is the zero-configuration art source. Users can store a TheGamesDB API key locally from Settings and explicitly apply searched front-cover candidates from a game's expanded details. Cover containers derive their ratio from the loaded scan and use `object-fit: contain`, so the UI preserves official package/scan proportions rather than cropping every system into one poster shape. TheGamesDB secrets stay in Electron's main process and use OS-backed safe storage where available.

Commercial game files are never bundled. The private provider boundary accepts user-selected supported host links and Real-Debrid magnets, resolves them with locally encrypted account tokens, refuses executables/unrelated files, and downloads allowed disc-image/archive payloads into `Documents/GameStore/Games/<title>`. TorBox host-link resolution is implemented; TorBox magnet file selection remains explicitly unsupported until verified. RetroGameTalk remains a visible source-page fallback rather than a scraped ROM index.

RetroGameTalk repository search is retained as an explicit, unverified source-page fallback per game. **Scan network** performs a user-started, rate-limited SSH/SFTP probe of local IPv4 `/24` networks, labels likely hostname matches, and exposes unknown SSH candidates for explicit selection. Credential testing checks `/media/fat` before confirming MiSTer/SuperStation layout. PS1 CHD or complete BIN/CUE sets transfer to `/media/fat/games/PSX/<game>` with byte progress and per-game grouping; completed local-library downloads can transfer directly. Hardware-specific connection/write validation remains a user-side acceptance step.

The header includes an in-app release updater. Windows NSIS and Linux AppImage builds check the public GitHub Releases feed, download and stage updates in the background with progress, then require an explicit **Restart to update** action. `.deb` installations report that updates belong to the system package manager. Release jobs must attach `latest.yml` / `latest-linux.yml` plus blockmaps so installed clients can resolve differential updates.

Expanded details keep screenshots and video visible together, with screenshots holding the largest area and video looping a short local segment. Libretro `Named_Snaps` and `Named_Titles` resolve through the same strict title/release matcher as artwork. A strict matcher rejects near-miss video sources; candidates over 120 MB are refused as previews. Settings reports cache bytes/path and provides a clear action that does not erase user curation.

Media discovery begins 600 ms after startup as a non-blocking three-worker audit. It shares provider indexes, fills missing screenshots, automatically caches strictly matched preview files no larger than 120 MB, and publishes per-title records for instant detail rendering. Opening a title reuses the same in-flight promise. The header reports progress; clearing the disposable cache resets and reruns the audit.

## Acceptance direction

The original 30 adversarial fixtures remain the hand-verified data-quality core inside the 100-game catalog. Expanded titles have explicit lightweight Libretro cover fallbacks and participate in runtime fuzzy media matching; broader exact-release coverage remains an ongoing data-quality gate.

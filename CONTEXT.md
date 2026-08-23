# GameStore context

## Product premise

GameStore is a Windows and Linux retro-game discovery catalog inspired by the breadth of CDRomance-style platform browsing. It emphasizes official regional box artwork, English playability, unusually strong filtering, editorial similarity shelves, transparent source provenance, and in-place game details.

## Media plan

- Layered artwork/screenshot candidates from retro metadata providers, with exact release/revision scope preferred over region, platform, or game-level media.
- Candidate artwork is classified (front scan, full cover, reconstruction, 3D render) and never silently replaces a curated choice.
- Expanded details include screenshot galleries and a click-to-play 16:9 video area for gameplay, trailers, and longplays.
- Media records retain scope, region, provider ID, source, dimensions/duration, attribution, freshness, confidence, and override history.

## Distribution and storage invariant

- Keep the repository and installers media-light: ship executable code, UI assets, schemas, provider adapters, and compact textual/catalog metadata.
- Do not commit or package per-game covers, screenshots, video files, or bulk media archives. Users obtain those after installation through built-in auto-scrapers/providers.
- Downloads require an explicit user action or an enabled in-app cache policy. Show provider attribution, progress, failures, retries, cache size, and clear-cache controls.
- Store fetched media in the platform application-data/cache directory. Cache clearing must not erase favorites, catalog corrections, artwork override history, or provenance.
- Stream video from attributed providers by default. Bundled media is limited to small app-owned assets such as the icon, logo, loading UI, and missing-media placeholders.
- CI should guard this invariant with repository/release size budgets and a check that rejects newly bundled per-game media.
- The enforced budgets and UI-asset allowlist live in `config/media-light.json`; `scripts/check-media-light.mjs` checks the source tree, compiled bundles, and platform artifacts in release CI.

## Current implementation

Version 0.3 is an Electron + React/TypeScript desktop application with matching Windows and Linux functionality. Its desktop shell follows the approved mockup direction: fixed navigation rail, global search, platform/filter bars, dense art-led shelves, and anchored inline details. It contains the initial 30-game PS1 slice, local favorites/export, filters, editorial shelves, translation records, media/video states, and stateful outbound sources. GitHub Actions builds a Windows NSIS installer plus Linux AppImage and Debian packages.

Libretro Thumbnails is the zero-configuration art source. Users can store a TheGamesDB API key locally from Settings and explicitly apply searched front-cover candidates from a game's expanded details. Cover containers derive their ratio from the loaded scan and use `object-fit: contain`, so the UI preserves official package/scan proportions rather than cropping every system into one poster shape. TheGamesDB secrets stay in Electron's main process and use OS-backed safe storage where available.

Commercial game files are not bundled or directly downloaded. The application links to references and patch discovery records through visible external-source actions.

## Acceptance direction

The initial 30 fixtures must expose region duplication, translations tied to exact base hashes, multi-disc grouping, revisions, missing/conflicting media, dead/unverified links, and provenance-preserving overrides. Expansion to 100 PS1 games follows only after the initial gate passes.

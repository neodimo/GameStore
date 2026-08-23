# GameStore context

## Product premise

GameStore is a Windows and Linux retro-game discovery catalog inspired by the breadth of CDRomance-style platform browsing. It emphasizes official regional box artwork, English playability, unusually strong filtering, editorial similarity shelves, transparent source provenance, and in-place game details.

## Media plan

- Layered artwork/screenshot candidates from retro metadata providers, with exact release/revision scope preferred over region, platform, or game-level media.
- Candidate artwork is classified (front scan, full cover, reconstruction, 3D render) and never silently replaces a curated choice.
- Expanded details include screenshot galleries and a click-to-play 16:9 video area for gameplay, trailers, and longplays.
- Media records retain scope, region, provider ID, source, dimensions/duration, attribution, freshness, confidence, and override history.

## Current implementation

Version 0.2 is an Electron + React/TypeScript desktop application with matching Windows and Linux functionality. It contains the initial 30-game PS1 slice, local favorites/export, filters, editorial shelves, inline details, translation records, media/video states, and stateful outbound sources. GitHub Actions builds a Windows NSIS installer plus Linux AppImage and Debian packages.

Commercial game files are not bundled or directly downloaded. The application links to references and patch discovery records through visible external-source actions.

## Acceptance direction

The initial 30 fixtures must expose region duplication, translations tied to exact base hashes, multi-disc grouping, revisions, missing/conflicting media, dead/unverified links, and provenance-preserving overrides. Expansion to 100 PS1 games follows only after the initial gate passes.

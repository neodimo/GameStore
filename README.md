# GameStore

Windows and Linux visual catalog for discovering English-playable retro games through box art, deep filters, editorial shelves, and expandable inline details.

The first PS1 discovery release is now in active development. Version 0.3 moves the live interface toward the approved desktop mockups and adds configurable artwork providers.

## Approved identity

- Project name: **GameStore**
- Planned repository name: **GameStore**
- Discord project channel: **#gamestore** under **Projects**

## Current planning direction

- Begin with PS1 and 30 adversarial catalog fixtures.
- Model catalog data as `Game → Release → Revision/media set`.
- Prefer USA releases, then Europe/UK where no USA release exists, then Japan-exclusive games with verified English translations.
- Use local SQLite with JSON shelf export/import.
- Use public-safe built-in providers and an explicit boundary for private, locally configured providers.
- Keep ratings separate by source and provenance.
- Keep "weird" discovery editorial and explainable.
- Present details in an anchored inline accordion, with a narrow-window side-sheet/full-page fallback.
- Treat artwork changes as explicit, reversible, provenance-preserving overrides.
- Include screenshots and click-to-play video in the same expanded detail view.

## Lightweight distribution rule

- GitHub releases contain the application, schemas, provider adapters, and compact catalog metadata only.
- Game box art, screenshots, video thumbnails, and other per-game media are not bundled in the repository or installers. The installed app fetches them on demand through its built-in auto-scrapers/providers.
- Media downloads are user-initiated or governed by an explicit in-app download/cache setting. The UI must show source, storage use, progress, failures, and retry/clear controls.
- Cached media lives in the user's application-data directory and remains disposable/rebuildable. User-selected artwork overrides and provenance records are preserved separately when the media cache is cleared.
- Video streams from its attributed provider by default rather than being copied into GitHub releases or the local cache.
- Small product assets required to identify and operate the app—icons, logos, loading states, and missing-media placeholders—may remain bundled.
- `npm run check:media-light` rejects catalog media and oversized UI assets in the source tree. Release CI also enforces explicit web, Electron, and installer size ceilings from `config/media-light.json`.

## Run locally

```bash
npm install
npm run dev
```

Build the web/client bundle with `npm run build`. Windows NSIS installers, Linux AppImages, and Debian packages are built by GitHub Actions and attached to tagged releases.

Linux users can run the portable AppImage (mark it executable first) or install the `.deb` on Debian/Ubuntu-family systems. Both packages contain the same catalog and features as the Windows build.

## What v0.1 includes

- 30 deliberately unusual PS1 games, including English fan-translation leads.
- Search; region, genre, weird-facet, and translation filters; sorting.
- Editorial discovery shelves with explainable curator notes.
- Responsive box-art grid and anchored inline details.
- Click-to-play video, explicit unavailable-media states, source/link health, and translation/base-release records.
- Local favorites and JSON shelf export.
- No bundled games, ROMs, patches, or silent downloads.

Media candidates are downloaded after installation from their original providers. Missing or unverifiable assets remain visibly missing instead of being silently associated with the wrong release.

## Artwork providers

- Libretro Thumbnails supplies zero-configuration artwork candidates for the compact catalog.
- A TheGamesDB API key can be added under **Settings → Artwork scrapers**. It is stored only in the local application-data directory and encrypted through Electron's OS-backed `safeStorage` when available.
- **Find official box art** in an expanded game row searches TheGamesDB and requires an explicit Apply action. The key is never bundled, exported, logged, or committed.
- Cover frames adopt the selected scan's intrinsic dimensions. Artwork is shown uncropped at the release scan's real aspect ratio; missing art remains a labeled placeholder.

# GameStore

Windows and Linux visual catalog for discovering English-playable retro games through box art, deep filters, editorial shelves, and expandable inline details.

The first PS1 discovery release is now in active development.

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

Media candidates are loaded from their original providers. Missing or unverifiable assets remain visibly missing instead of being silently associated with the wrong release.

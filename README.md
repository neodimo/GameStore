# GameStore

Windows and Linux visual catalog for discovering English-playable retro games through box art, deep filters, editorial shelves, and expandable inline details.

The PS1 discovery release is in active development. Version 0.9 adds a managed, console-aware local library and persistent MiSTer cart on top of the 100-game media-first catalog, private debrid-backed acquisition, and SuperStation/MiSTer network discovery.

## Approved identity

- Project name: **GameStore**
- Planned repository name: **GameStore**
- Discord project channel: **#gamestore** under **Projects**

## Current planning direction

- Begin with PS1, retaining 30 adversarial fixtures inside a broader 100-game catalog.
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
- Video is never bundled. Signed-in EmuMovies accounts provide exact-release video snaps which cache locally. Without that account, strictly matched Internet Archive longplays stream a short looping range without downloading the complete recording.
- Small product assets required to identify and operate the app—icons, logos, loading states, and missing-media placeholders—may remain bundled.
- `npm run check:media-light` rejects catalog media and oversized UI assets in the source tree. Release CI also enforces explicit web, Electron, and installer size ceilings from `config/media-light.json`.

## Run locally

```bash
npm install
npm run dev
```

Build the web/client bundle with `npm run build`. Windows NSIS installers, Linux AppImages, and Debian packages are built by GitHub Actions and attached to tagged releases.

Linux users can run the portable AppImage (mark it executable first) or install the `.deb` on Debian/Ubuntu-family systems. Both packages contain the same catalog and features as the Windows build.

## What v0.8 includes

- 100 PS1 games, retaining 30 deliberately unusual/translation-heavy fixtures and adding horror, arcade, RPG, action, racing, and platformer shelves.
- Search; region, genre, weird-facet, and translation filters; sorting.
- Editorial discovery shelves with explainable curator notes.
- Responsive box-art grid and anchored inline details.
- Screenshot-first detail views, short looping local video, explicit unavailable-media states, source/link health, and translation/base-release records.
- Local favorites and JSON shelf export.
- No bundled games, ROMs, patches, or silent downloads.

Media candidates are downloaded after installation from their original providers. Missing or unverifiable assets remain visibly missing instead of being silently associated with the wrong release.

## Artwork providers

- Libretro Thumbnails supplies zero-configuration artwork candidates for the compact catalog.
- Covers are matched by scoring the whole Libretro filename index rather than requesting one exact filename, so romanization drift, dropped subtitles, swapped articles and alternate numbering still resolve to the right release. The index is cached locally for seven days and can be refreshed on demand.
- The automatic matcher is deliberately strict and leaves a placeholder rather than attaching a plausible-but-wrong cover. Each match records its confidence and region.
- **Right-click any game → Search alternate box art** opens a deeper, deliberately looser browse across box art, title screens, screenshots, and TheGamesDB, ranked by match score. Applying a candidate is an explicit, reversible override; **Reset to automatic match** restores the matcher's choice.
- A TheGamesDB API key can be added under **Settings → Artwork scrapers**. It is stored only in the local application-data directory and encrypted through Electron's OS-backed `safeStorage` when available.
- **Find official box art** in an expanded game row searches TheGamesDB and requires an explicit Apply action. The key is never bundled, exported, logged, or committed.
- Cover frames adopt the selected scan's intrinsic dimensions. Artwork is shown uncropped at the release scan's real aspect ratio; missing art remains a labeled placeholder.

## Screenshots and local video

- Shortly after first paint, a three-worker startup audit checks every catalog title. A compact header indicator reports index, progress, completion, or failure while normal browsing remains available.
- Opening a game resolves primary-release Libretro `Named_Snaps` and `Named_Titles`, caches the release-matched images, and displays large gameplay stills beside the video pane. Gameplay frames captured from a preview augment the gallery.
- Signed-in EmuMovies accounts are matched by exact No-Intro/Redump-style filename and cache their short video snap locally. Credentials are stored only in the install's OS-backed secure storage.
- Without EmuMovies, GameStore strictly matches an Internet Archive longplay and streams a short looping byte range instead of downloading a multi-gigabyte recording. A failed match falls back to the screenshot loop.
- **Settings → Local media cache** reports storage use and location and can clear fetched screenshots/video without touching favorites, catalog corrections, or artwork overrides.
- Clearing media automatically starts a fresh background audit. Existing files are validated and reused on ordinary starts, so the check does not redownload healthy cache entries.

## In-app updates

- Installed Windows NSIS and Linux AppImage builds can check GitHub Releases from the header button.
- The button exposes checking, available, download progress, ready-to-restart, current, unsupported, and error states. Downloads and staging stay in the background; the user chooses when to restart and apply.
- Linux `.deb` installs remain managed by the system package manager because replacing a system package requires distro-specific privileges. The app says so explicitly instead of invoking a visible or privileged installer.
- Release CI publishes the updater metadata and blockmaps alongside each installer. Development builds disable update checks.

## RetroGameTalk and FPGA transfer

- Each game includes an explicit RetroGameTalk repository search as an unverified fallback. It opens the source page in the user's browser; GameStore does not scrape or silently resolve its changing download endpoint.
- **Scan network** performs a short, rate-limited SSH/SFTP probe of the local subnet, ranks likely hostnames, and exposes every candidate for explicit selection. Credential testing confirms `/media/fat` before calling a device MiSTer/SuperStation-compatible.
- Configure a selected SuperStation One or MiSTer under **Settings → SuperStation / MiSTer**. Finished downloads enter the persistent **MiSTer cart** automatically; checkout sends the complete queue into `/media/fat/games/PSX/<game>` by default without another file picker.
- PS1 transfers accept CHD or complete BIN/CUE sets. CD files stay unzipped, related tracks move together, and multi-file titles remain grouped under one game folder as MiSTer expects.
- Transfer progress is shown in the expanded detail view. Device credentials remain local and use OS-backed encryption when available.

## Private download providers

- Real-Debrid and TorBox API tokens live under **Settings → Download providers** and are stored through Electron `safeStorage` when the OS keychain is available. Tokens never enter exports, catalog data, logs, or GitHub.
- Debrid APIs do not discover game torrents. Add a trusted HTTPS collection `.torrent` URL once in Settings. GameStore indexes only its metadata locally, matches each game/release by filename and region, and shows the exact contained candidates in the Download rail.
- Selecting a collection candidate uploads the torrent to Real-Debrid and calls selective file-ID selection for that candidate; unrelated files in the system-wide torrent are not selected for the account download.
- Real-Debrid resolves supported host links and magnets, selects the torrent's files, waits for provider completion, and downloads allowed game-image/archive files with progress. ZIPs extract through a traversal- and symlink-refusing staging boundary; filenames are preserved, the ZIP is deleted only after a complete successful install, multi-file/disc releases land under `Documents/GameStore/Games/<console>/<title>/`, and single-file cartridge releases land directly under `Documents/GameStore/Games/<console>/`.
- TorBox resolves supported host links. Its official API supports cached file lists and per-file links, but the configured-collection path remains disabled until those account responses are tested; the UI does not pretend otherwise.
- Executables and unrelated provider payloads are refused. GameStore accepts known disc-image, playlist, and archive extensions only.
- The disk-backed `Documents/GameStore/library.json` manifest keeps completed releases in the MiSTer cart across restarts. Checkout uses those managed paths, removes successful items from the cart while retaining the local library files, and leaves a failed/current item queued for retry.

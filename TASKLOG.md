# GameStore task log

## 2026-08-22 — RetroGameTalk fallback, box-art-grid icon, and FPGA transfer

- **What was done:** Added an unverified RetroGameTalk repository search fallback to every catalog record. Replaced the package icon with a purpose-built grid of abstract retro box-art cases. Added locally configured SFTP transfer for SuperStation One and MiSTer: connection testing, encrypted credential storage, CHD/BIN/CUE selection and validation, `/media/fat/games/PSX/<game>` grouping, directory creation, and live byte progress in the detail accordion. Evidence: catalog tests, TypeScript validation, production web/Electron build, media-light guard, and production-dependency security audit passed.
- **Artifacts:** `build/icon.png`, `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`, `src/style.css`, `src/catalog.ts`, `src/vite-env.d.ts`, `package.json`, `package-lock.json`, `README.md`, and `CONTEXT.md`. The icon was generated with the built-in image tool from a no-text, no-character 3×3 abstract game-case prompt, then resized/optimized locally to 512×512 (384,690 bytes). Intended status: committed, pushed, and released as v0.4.0; generated installers remain ignored local/CI artifacts.
- **State:** Implementation and local validation done. A physical network write is unverified because no SuperStation One or MiSTer was reachable from this environment; the in-app connection test and Omid's first hardware transfer are the acceptance gate. RetroGameTalk links are deliberately labeled unverified because repository entries can disappear or rename.
- **Next owner + concrete artifact:** Omid installs v0.4.0, enters the device host and credentials under Settings, runs **Test connection**, then uses **Send to SuperStation / MiSTer** on a legally obtained CHD or complete BIN/CUE set. Report the exact displayed error and device firmware if the hardware test fails.

## 2026-08-22 — Background in-app updater

- **What was done:** Added a header updater flow with check, update-available, background download progress, ready, restart, current, unsupported, and error states. Windows NSIS and Linux AppImage builds use GitHub Releases through `electron-updater`; `.deb` installs explicitly defer to the package manager. The renderer receives status through a narrow preload IPC bridge, and release CI now uploads updater manifests and blockmaps with installers. Evidence: catalog tests, TypeScript validation, production web/Electron build, media-light guard, and runtime-only dependency audit passed.
- **Artifacts:** `electron/updater.ts`, `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`, `src/style.css`, `src/vite-env.d.ts`, `package.json`, `package-lock.json`, `.github/workflows/release.yml`, `README.md`, and `CONTEXT.md`. Intended repository status: committed/pushed on `feat/in-app-updater`, merged through GitHub, and released as v0.3.1.
- **State:** Implementation complete locally. A true end-to-end update requires two published versions; v0.3.1 establishes the updater-capable baseline, and its check/no-update path can be tested immediately after release. The next release will exercise download/stage/restart from v0.3.1.
- **Failure mode:** The first packaged AppImage smoke test exposed that a default import from `electron-updater` compiled but resolved undefined under the CommonJS Electron bundle. The updater now uses the library's named `autoUpdater` import; packaged launch is a mandatory release gate because the renderer/dev build cannot catch this interop failure.
- **Next owner + concrete artifact:** Gonzo publishes v0.3.1 and verifies its updater metadata assets. Omid installs v0.3.1 once; the next GameStore release should then arrive through the header button without a visible installer.

## 2026-08-22 — Mockup-aligned UI and release-ratio artwork

- **What was done:** Rebuilt the live desktop shell around the approved mockups: fixed navigation rail, global search, platform and filter bars, dense editorial shelf, six-column catalog, and an anchored three-part detail accordion. Cover frames now adopt each loaded scan's intrinsic aspect ratio and render with containment, preventing the former universal 3:4 crop. Added a local TheGamesDB API-key setting and explicit front-cover candidate search/apply flow; Libretro remains the zero-configuration source. Evidence: catalog tests, TypeScript validation, production web/Electron build, media-light source guard, and a 1600×1000 Linux Chromium visual smoke test passed.
- **Artifacts:** `src/App.tsx`, `src/style.css`, `electron/main.ts`, `electron/preload.ts`, `src/vite-env.d.ts`, `README.md`, and `CONTEXT.md`. Visual QA capture is deliberate temporary scratch at `/tmp/gamestore-v003.png`; generated bundles remain ignored local artifacts. Intended repository status: commit/push through PR #4, followed by the v0.3.0 release pipeline.
- **State:** Implementation complete locally. TheGamesDB live lookup still needs user-key validation against Omid's account/quota; no API key was requested, exposed, or committed. Provider overrides are local and explicit; a fuller append-only override-history UI remains future work.
- **Next owner + concrete artifact:** Gonzo publishes and verifies PR #4 and the v0.3.0 Windows/Linux release artifacts. Omid adds the key under **Settings → Artwork scrapers**, opens a game, and tests **Find official box art** with an exact-region title.

## 2026-08-22 — Media-light repository and package guard implemented

- **What was done:** Enforced the standing lightweight-core rule in package configuration and release CI. The source guard rejects bundled video, catalog/media archives, artwork outside explicit app-owned UI paths, and oversized UI assets. Separate checks enforce tracked-core, compiled web/Electron bundle, Windows installer, Linux AppImage, and Debian package budgets. Evidence: tests, TypeScript validation, production build, bundle checks, and current Linux artifact checks passed; a deliberate `data/covers/should-fail.png` fixture was correctly rejected and then removed.
- **Artifacts:** `scripts/check-media-light.mjs`, `config/media-light.json`, `package.json`, `.github/workflows/release.yml`, `README.md`, and `CONTEXT.md`. Intended status: committed and pushed through the repository workflow; generated `dist/`, `dist-electron/`, and `release/` outputs remain ignored/local build artifacts.
- **State:** Done. Current measurements: tracked core 0.35 MiB of 5 MiB; web bundle 0.22 MiB of 3 MiB; Linux AppImage 115.76 MiB of 130 MiB; Debian package 158.58 MiB of 180 MiB. Windows size enforcement will run on the Windows CI runner.
- **Next owner + concrete artifact:** Gonzo maintains thresholds and allowlists in `config/media-light.json` when dependencies or app-owned UI assets change; pull-request CI in `.github/workflows/ci.yml` and package checks in `.github/workflows/release.yml` are the acceptance gates.

## 2026-08-22 — Media-light distribution rule adopted

- **What was done:** Recorded Omid's standing rule that GameStore's repository and downloadable installers stay lightweight. Per-game artwork, screenshots, thumbnails, and video are acquired after installation through built-in auto-scrapers/providers; only code, compact metadata, provider logic, and small app-owned UI assets ship. Cache behavior, user control, provenance preservation, video streaming, and future CI size guards are now explicit requirements.
- **Artifacts:** `README.md` and `CONTEXT.md`, committed/pushed project documentation.
- **State:** Done as a durable product invariant. The current vertical slice already loads remote media rather than bundling a media archive; scraper orchestration, cache controls, and CI size-budget enforcement remain future implementation work.
- **Next owner + concrete artifact:** Gonzo uses the distribution invariant in `CONTEXT.md` when implementing the media-provider/cache layer; the acceptance artifact is a CI check plus an in-app media/cache settings screen.

## 2026-08-22 — Linux parity and v0.2 packaging

- **What was done:** Added Linux as a first-class release target without removing or conditionalizing catalog features. Electron now uses native window chrome outside macOS, and the release workflow independently tests and packages Windows and Linux. Evidence: catalog tests, TypeScript validation, production bundling, AppImage packaging, Debian packaging, runtime-only dependency audit, and a real Linux Electron visual smoke test passed locally.
- **Artifacts:** Source is committed and pushed in GitHub release `v0.2.0` at `https://github.com/neodimo/GameStore/releases/tag/v0.2.0`. Release assets are `GameStore-0.2.0-x86_64.AppImage`, `GameStore-0.2.0-amd64.deb`, and `GameStore-Setup-0.2.0-x64.exe`. Visual-QA captures are deliberate temporary files in `/tmp/gamestore-linux-qa.LZwZTL/` for Discord delivery.
- **State:** Done. GitHub's Linux and Windows jobs independently passed install, catalog tests, TypeScript validation, native packaging, and release upload. The packaged Linux app was also launched and visually inspected locally. Installers remain unsigned; installation on Omid's exact Linux machine is the remaining user-side confirmation.
- **Next owner + concrete artifact:** Omid runs either `GameStore-0.2.0-x86_64.AppImage` or `GameStore-0.2.0-amd64.deb` from the v0.2.0 release and reports distro/desktop-specific issues in `#gamestore` with a screenshot.

## 2026-08-22 — GameStore v0.1.1 released

- **What was done:** Published the public `neodimo/GameStore` repository and production GitHub release `v0.1.1`. GitHub's Windows runner passed install, catalog tests, TypeScript validation, production bundling, NSIS packaging, and release upload.
- **Artifacts:** Source is committed/pushed at `https://github.com/neodimo/GameStore` (HEAD `309c1f5` before this log-only follow-up). Installer `GameStore-Setup-0.1.1-x64.exe` is attached to `https://github.com/neodimo/GameStore/releases/tag/v0.1.1`; SHA-256 `1a247a83c263279326dd226d77b9de3a28e767e9c0ec782c3d87a464beda0ce3`.
- **State:** Done. Windows installer was produced and uploaded by a successful Windows CI run. It is currently unsigned, so Windows SmartScreen may show an unknown-publisher warning. Installation on Omid's specific machine remains user verification.
- **Next owner + concrete artifact:** Omid downloads and runs `GameStore-Setup-0.1.1-x64.exe`; report UI/data issues in `#gamestore` with the affected title/filter and a screenshot.

## 2026-08-22 — Windows release packaging correction

- **What was done:** Corrected electron-builder so tagged CI builds produce the NSIS installer without electron-builder attempting its own unauthenticated parallel publication. Artifact publication remains owned by the explicit GitHub Release action.
- **Artifacts:** `package.json`, `package-lock.json`, and `.github/workflows/release.yml` in the GameStore repository. Intended committed/pushed release fix.
- **State:** Fix prepared; the replacement Windows runner and attached installer require verification.
- **Next owner + concrete artifact:** Gonzo tags `v0.1.1`, watches the GitHub Actions run, and verifies `GameStore-Setup-0.1.1-x64.exe` on the release page.
- **Failure mode:** electron-builder detects Git tags and defaults to auto-publish when a `publish` config exists; without `GH_TOKEN` in its process it fails after successfully building. Always pass `--publish never` when a later workflow step owns release upload.

## 2026-08-22 — v0.1 Windows vertical slice implemented

- **What was done:** Built the first GameStore desktop vertical slice in Electron, React, and TypeScript. Evidence: 30 unique PS1 catalog fixtures; search and deep filters; curated shelves/facets; inline detail accordion; translation/base-release records; stateful source links; click-to-play video and explicit missing-media states; responsive layouts; favorites and JSON export. Automated catalog tests, TypeScript validation, production build, runtime dependency audit, and desktop/narrow visual smoke tests pass. The runtime dependency audit reports zero known vulnerabilities.
- **Artifacts:** Application source and build workflow live throughout `projects/GameStore/`; production web bundle in `projects/GameStore/dist/` is deliberate local build output and ignored by Git. Visual QA captures are deliberate temporary files at `/tmp/gamestore-desktop.png` and `/tmp/gamestore-narrow.png`. GitHub publication/release is the remaining step for this entry.
- **State:** Implementation and local validation done; Windows installer remains unverified until the GitHub Windows runner finishes packaging it. Several upstream cover URLs deliberately fall back to labeled missing-art cards when exact filenames do not match; no questionable regional art is substituted.
- **Next owner + concrete artifact:** Gonzo publishes/tag/releases the repository using `.github/workflows/release.yml`, then verifies the GitHub Actions run and attached `.exe` artifacts. Omid installs the NSIS `.exe` from the GitHub release.

## 2026-08-22 — Project identity established

- **What was done:** Omid selected **GameStore** as the project and planned repository name. The workspace project record was created, and the existing Discord discussion channel was designated for rename/move to `#gamestore` under `Projects`.
- **Artifacts:** `projects/GameStore/README.md`, `projects/GameStore/CONTEXT.md`, and this task log. Local workspace files; no Git repository or remote has been created.
- **State:** Done for naming and workspace identity. Planning remains in progress; implementation is explicitly unstarted.
- **Next owner + concrete artifact:** Bert/Gonzo should produce plan v002 and revised edge-state mockups using `projects/GameStore/README.md` and `projects/GameStore/CONTEXT.md`; Omid approves before the 30-case spike.

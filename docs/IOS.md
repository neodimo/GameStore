# GameStore for iOS

The iOS app uses Capacitor so the catalog, matching, filters, media gallery, and
visual language remain shared with the desktop application. Native services
will implement the existing `window.gameStore` contract; Electron remains the
desktop implementation of that contract.

## Current foundation

- Bundle identifier: `com.neodimo.gamestore`
- iPhone and iPad targets, iOS 15+
- Shared React production bundle embedded in a native Xcode project
- Safe-area-aware header and bottom navigation, including mobile access to
  Discover, Favorites, and Settings
- Local-network privacy declaration and Bonjour SSH discovery declaration for
  MiSTer/SuperStation support
- Capacitor App, Browser, Filesystem, Preferences, and iOS packages
- macOS simulator CI and a manual TestFlight workflow ready for signing secrets

## Native capability work

The catalog and browsing UI run immediately. The following Electron main-process
services need iOS-native adapters before feature parity is claimed:

1. Keychain-backed EmuMovies, Real-Debrid, TorBox, and device credentials.
2. Background URLSession downloads, safe ZIP extraction, managed library, and
   persistent MiSTer cart in the app container.
3. Bonjour/local-subnet discovery plus SSH/SFTP checkout to MiSTer/SuperStation.
4. Provider indexes, media cache, frame cache, and collection manifest indexing.
5. Native share-sheet shelf export and App Store/TestFlight update messaging.

Game files remain user-managed documents and are excluded from iCloud backup.
Long-running transfers must use iOS background-task APIs and surface resumable
state when iOS suspends the app.

## Local workflow

```bash
npm ci
npm run ios:verify
npm run ios:open
```

`ios:open` requires macOS with Xcode. The generated project uses Swift Package
Manager through Capacitor.

## TestFlight secrets

The manual `iOS TestFlight` workflow expects these GitHub Actions secrets:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY` (the complete `.p8` contents)

Until those are present, normal iOS CI builds the simulator target without code
signing. TestFlight upload stays manual so an incomplete native bridge cannot be
published accidentally.

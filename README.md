# WHATZ IT

WHATZ IT is a React Native party game built with Expo. Players choose a themed deck, hold the phone to their forehead, and guess cards from their friends' clues.

This repository currently contains the Milestone 3 motion-control implementation:

- Expo SDK 57 with React Native and TypeScript
- Expo Router navigation
- A branded deck library
- Deck detail and preview screens
- Three typed local sample decks
- Shared theme tokens
- Timer presets and a custom 30–300 second timer
- Three-second ready countdown
- Shuffled, reducer-driven rounds
- Button controls for correct and pass
- Accurate timestamp-based round timing
- Results, scoring, and replay
- Automated tests for core game behavior
- Landscape ready and gameplay screens
- Neutral-position motion calibration
- Smoothed tilt detection with debounce and return-to-neutral rearming
- Tilt down for correct and tilt up to pass
- Haptic feedback for card outcomes
- Screen-awake behavior during gameplay
- Button controls when motion is unavailable or denied

Motion thresholds are intentionally configurable in `src/game/tilt-detector.ts` and must be tuned on physical iOS and Android devices before Milestone 3 is considered fully validated.

## Requirements

- Node.js 22.13 or newer
- npm
- Expo Go or an Android/iOS simulator

## Run locally

```bash
npm install
npm start
```

Then scan the QR code with Expo Go or choose an available simulator from the Expo terminal interface.

This project uses Expo SDK 57 and includes a custom development client. During the SDK 57 transition, use an EAS development build rather than Expo Go on a physical phone.

## Test on a physical phone

Sign in to an Expo account and configure the remote EAS project once:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

Create an installable development build:

```bash
# Android phone
npx eas-cli@latest build --platform android --profile development

# iPhone (requires an active Apple Developer membership)
npx eas-cli@latest build --platform ios --profile development
```

Install the resulting build from its QR code. For later development sessions, start Metro with:

```bash
npm start
```

The application identifiers are `com.cadelawless.whatzit` on both platforms.

## Catalog rollout and rollback

The app uses the local SQLite catalog by default. On first launch it imports the
bundled release baseline, so the starter decks remain available without a
network connection. To test synchronization against staging locally, create an
ignored `.env.local` file containing:

```dotenv
EXPO_PUBLIC_CATALOG_SOURCE=sqlite
EXPO_PUBLIC_CATALOG_MANIFEST_URL=https://api-staging.playwhatzit.com/api/v1/catalog/manifest
```

Restart Metro after changing these values. A successful sync persists verified
free cards, covers, and thumbnails for later offline use; an interrupted or
invalid sync leaves the last activated local revision unchanged.

The preview EAS profile uses that staging endpoint. Production intentionally
has no catalog URL checked into the repository: configure
`EXPO_PUBLIC_CATALOG_MANIFEST_URL` with the production HTTPS manifest URL in the
production build environment before enabling live production updates. Without
a manifest URL, SQLite continues using its bundled or last-synchronized data
and makes no catalog request.

For an emergency build-time rollback, set:

```dotenv
EXPO_PUBLIC_CATALOG_SOURCE=bundled
```

That restores the original synchronous TypeScript catalog and disables network
synchronization. An invalid source value also fails closed to the bundled path.
If SQLite initialization itself fails, app startup retains the bundled snapshot
so the existing game remains usable.

## App-release catalog baseline

Before preparing an app-store build, compare the bundled starter catalog with
the active public catalog:

```bash
npm run catalog:baseline:check -- https://api.example.com/api/v1/catalog/manifest
```

If the check reports `STALE`, regenerate the baseline and review the generated
catalog and cover changes:

```bash
npm run catalog:baseline:update -- https://api.example.com/api/v1/catalog/manifest
npm test
npm run typecheck
npm run lint
git diff -- src/data/bundles.ts assets/images/decks/baseline
```

The check is read-only. The update verifies each public artifact's HTTPS URL,
byte count, and SHA-256 hash before writing anything. It embeds the active
catalog metadata plus free starter cards and content-addressed free covers;
paid card payloads and paid covers are never added to the app baseline. Commit
the reviewed generated changes with the release. Normal Deck Manager publishes
still reach existing installations through catalog sync and do not require an
app-store release.

## Checks

```bash
npm run typecheck
npm run lint
```

See [PROJECT_PLAN.md](./PROJECT_PLAN.md) for the complete scope, milestones, architecture, and release criteria.

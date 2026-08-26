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

After the parallel production API is live, a development client can follow
production catalog publications without creating an app-store build. Copy
`.env.production-catalog.example` to the ignored `.env.local`, then restart
Metro. This mode deliberately disables commerce: use the staging environment
for sandbox purchase and restore testing. Production catalog sync still makes
new metadata and free starter-deck content available to the development app.

For unpublished authoring review, copy `.env.dev-preview.example` instead and
add the same 64-character preview key stored in the production API and Deck
Manager configuration. The manager's deliberate **Update Dev Preview** action
creates a private snapshot; ordinary draft autosaves do not affect the app.
Expo development then downloads that snapshot—including paid deck cards for
authoring review—through secret-authenticated routes. Preview mode is gated by
`__DEV__`, uses its own SQLite database, and is absent from release/EAS
profiles, so preview ownership and draft content cannot enter the production
catalog cache or a store build. It also uses the dedicated
`EXPO_PUBLIC_DEV_PREVIEW_MANIFEST_URL`; while preview mode is enabled, the app
will never fall back to the normal staging or production catalog URL.

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

Catalog schema evolution, old-build support, artifact retention, and the
evidence required before legacy cleanup are defined in
[`CATALOG_COMPATIBILITY_POLICY.md`](./CATALOG_COMPATIBILITY_POLICY.md).

The EAS production profile runs this check automatically after native
dependencies are installed. Configure `EXPO_PUBLIC_CATALOG_MANIFEST_URL` in the
EAS `production` environment with the production manifest URL. Production
builds stop before compilation if that variable is missing or the committed
baseline is stale; development, preview, and staging profiles skip this gate.

## Checks

```bash
npm run typecheck
npm run lint
```

See [PROJECT_PLAN.md](./PROJECT_PLAN.md) for the complete scope, milestones, architecture, and release criteria.

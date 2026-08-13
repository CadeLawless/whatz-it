# WHATZ IT? Deck Platform Architecture Plan

## 1. Purpose

This plan replaces the build-time-only deck catalog with a scalable platform
that supports:

- hundreds or thousands of discoverable decks and bundles;
- immediate, atomic publishing from Deck Manager;
- local catalog browsing, filtering, and searching;
- automatic installation of purchased deck content;
- offline play for free and owned decks;
- automatic catalog, deck, bundle, card, and cover updates;
- future Apple App Store and Google Play purchases; and
- recovery, auditing, and rollback without depending on Git as the production
  content database.

The work spans both repositories:

- **WHATZ IT? mobile app:** `C:\dev\whatz-it`
- **Landing page, PHP services, and Deck Manager:**
  `C:\dev\whatz-it-landing-page`

This is an architecture and implementation plan. It does not itself change the
runtime behavior of either project.

## Fresh-Task Handoff Context

Read this section before beginning implementation in a new task.

### Confirmed product decisions

- The catalog is expected to grow to hundreds or thousands of decks.
- All locally synchronized deck metadata should be browsable, searchable, and
  filterable from SQLite.
- Locally known deck thumbnails, titles, and descriptions should remain visible
  offline.
- Free starter decks and purchased decks must be playable offline.
- Purchasing a deck or bundle automatically installs its cards and required
  media; users should not manage a separate offline-download feature.
- A new store transaction itself requires internet access. The product accepts
  this limitation because most purchasing users are expected to be connected.
- Deck and bundle versions must be assigned automatically during publishing.
- The target server stack is Hostinger PHP plus its included MySQL/MariaDB
  service, exposed to the app only through HTTPS APIs.
- Deck Manager should ultimately publish to the database-backed platform rather
  than modifying the Git repository as its live production workflow.
- Paid decks, paid-deck screens, in-app purchases, accounts, and entitlements do
  not exist yet. They must not be assumed to be partially implemented.

### Repository and source-control boundaries

- `C:\dev\whatz-it` and `C:\dev\whatz-it-landing-page` are separate Git
  repositories. Inspect and report their worktree state independently.
- Preserve unrelated user changes in either repository.
- The architecture plan lives in the mobile repository, but it explicitly
  authorizes scoped implementation work in both repositories when requested.
- Keep app and server changes separable and deploy server-compatible changes
  before app code that depends on them.
- Do not remove the existing TypeScript catalog or GitHub publishing path until
  the replacement has parity tests, a rollout flag, and a demonstrated rollback
  path.

### Required instructions and version constraints

- The mobile repository's `AGENTS.md` requires reading the exact Expo SDK 57
  documentation at <https://docs.expo.dev/versions/v57.0.0/> before writing
  code.
- The app currently uses Expo `~57.0.8`, React Native `0.86.0`, React `19.2.3`,
  Expo Router `~57.0.8`, and TypeScript `~6.0.3`.
- `expo-sqlite` is not currently installed. Install it with the SDK-compatible
  Expo command/version when the mobile SQLite phase begins; do not choose a
  version from memory.
- An in-app-purchase library/native integration has not been selected. It must
  support the actual Expo SDK 57 development-build/native setup and current
  Apple and Google billing requirements.
- This app already contains custom native modules and uses a development client,
  so native dependency changes require an appropriate rebuilt development
  client rather than an Expo Go-only assumption.

### Current catalog facts

- Source: `C:\dev\whatz-it\src\data\bundles.ts`
- Schema version: `5`
- Current global revision at plan creation: `32`
- Current size at plan creation: 20 decks, 2 bundles, 3,814 cards, and roughly
  505 KB of catalog JSON embedded in TypeScript
- Current deck covers at plan creation: 20 files totaling roughly 3 MB
- Current per-deck versions are all `1` and are manually editable in Deck
  Manager; this is legacy behavior to replace with server-assigned versions.
- The mobile app currently imports synchronous catalog helpers from
  `src/data/bundles.ts` throughout home, deck details, ready/game/results, round
  context, settings return, and recorded-video labeling. The migration must find
  and update every consumer, not only the store screens.

### Important existing Deck Manager files

- Manager documentation:
  `C:\dev\whatz-it-landing-page\deck-manager\README.md`
- Current PHP API:
  `C:\dev\whatz-it-landing-page\deck-manager\public\api.php`
- Current GitHub repository/validation/publish implementation:
  `C:\dev\whatz-it-landing-page\deck-manager\lib\GitHubDeckManager.php`
- Current browser editor:
  `C:\dev\whatz-it-landing-page\deck-manager\public\assets\app.js`
- Authoritative current catalog schema:
  `C:\dev\whatz-it-landing-page\deck-manager\schema\bundles.schema.json`
- Current configuration template:
  `C:\dev\whatz-it-landing-page\deck-manager\config.example.php`

The current manager already provides valuable behavior that should be preserved:
server validation, CSRF/session hardening, admin allowlisting, staged WebP
conversion, optimistic publish conflicts, atomic publication, change summaries,
history, and recovery. Replace its storage/publishing mechanism without
regressing those protections.

### Secrets and infrastructure assumptions

- No production Hostinger database credentials, Apple credentials, Google
  credentials, signing secrets, or store product configuration are expected in
  either repository.
- Never add real credentials to source control or expose them through
  `EXPO_PUBLIC_` variables.
- Server secrets should be supplied through Hostinger environment configuration
  or an external configuration file outside the public web root, following the
  manager's existing production-secret pattern.
- If production infrastructure details are unavailable, implement and verify
  against local/test configuration and clearly document the exact deployment
  values or user actions still required.
- phpMyAdmin is an administration tool, not an app-facing API and not the
  migration system.

### Existing verification commands

Run mobile checks from `C:\dev\whatz-it`:

```powershell
npm test
npm run typecheck
npm run lint
```

Run current manager checks from `C:\dev\whatz-it-landing-page`:

```powershell
node deck-manager/tests/run.js
php deck-manager/tests/lint.php
php deck-manager/tests/github.php
```

Add database/API tests rather than replacing current coverage before feature
parity is established. Tests that require MySQL must use an explicitly named
test database and must never point at production.

### Recommended first implementation slice

Do not attempt commerce, the entire app migration, and the manager rewrite in
one undifferentiated change. The safest first slice is:

1. Reconfirm the unresolved decisions in Section 20 that affect the first
   phase, especially Hostinger database availability and API/content domains.
2. Define versioned MySQL migrations and environment-based local/test database
   configuration in the landing-page repository.
3. Implement a read-only import/export path that loads the current schema-5
   catalog into the new database and reproduces it deterministically.
4. Implement and test the public discovery manifest and free-content artifact
   generation without changing the production app or manager write path.
5. Add parity tests comparing the database export to the current TypeScript
   catalog, including ordering, IDs, cards, bundles, and media references.

This creates a verifiable foundation and a safe stopping point. Continue with
the numbered phases in Section 16 only after that slice passes and its remaining
deployment assumptions are documented.

## 2. Product Experience to Preserve

The technical implementation should stay mostly invisible to players.

### 2.1 Browsing

- The last synchronized catalog remains browsable without internet access.
- Every locally known deck can show its thumbnail, title, description, tags,
  bundle membership, ownership state, and card count while offline.
- Catalog screens query SQLite in pages rather than rendering the full catalog
  at once.
- Search and filters operate locally.
- A deck published after a device's last successful synchronization cannot be
  shown until that device reconnects; this is the only unavoidable catalog
  freshness limitation.

### 2.2 Purchasing

- A player can inspect an unowned deck while offline.
- A new purchase requires connectivity because Apple or Google must present and
  authorize the transaction and the backend must verify it.
- If the player taps Buy while offline, the app explains that a connection is
  required; it does not silently queue or later initiate a payment.
- The store's current localized price is authoritative. A cached price may be
  displayed offline as last-known information but must not be treated as a
  guaranteed current price.
- Successful purchases automatically install the required cover and cards.
- There is no separate "download for offline play" action.
- A deck is labeled playable only after its local installation is complete.
- Restoring purchases automatically installs any missing owned content.

### 2.3 Playing

- Every included free deck and every fully installed owned deck works without
  internet access.
- Starting a round takes a snapshot of the installed deck version. Background
  updates cannot change the cards in an active round.
- The last known-good version remains playable until a replacement has been
  fully downloaded, validated, and committed.

## 3. Current State

### 3.1 WHATZ IT? app

- The complete schema-version-5 catalog is embedded in
  `src/data/bundles.ts` as a TypeScript object.
- The current catalog has a global `revision`, `updatedAt`, and a manually
  editable `version` on each deck.
- Cover images are bundled Metro assets resolved through static `require()`
  calls.
- Screens and round logic synchronously import `freeBundleDecks`,
  `getDeckById`, and related helpers.
- AsyncStorage currently persists preferences and other small pieces of local
  state; there is no catalog database or network synchronization layer.
- Paid/free metadata exists, but purchasing, accounts, receipt validation, and
  entitlements are not implemented.

### 3.2 Deck Manager

- Deck Manager is a PHP application in the landing-page repository.
- It authenticates administrators through a repository-scoped GitHub App.
- Editor changes remain in browser memory until Publish.
- Publish validates the whole catalog, increments the global revision, writes
  the TypeScript catalog and covers to GitHub, and uses Git history for audit
  and recovery.
- Optimistic concurrency currently compares the Git commit loaded by the
  editor with the current branch head.

## 4. Target Architecture

```text
Deck Manager browser
        |
        | authenticated admin API
        v
Hostinger PHP service ---- MySQL/MariaDB
        |                       |
        | publish transaction   | drafts, revisions, entitlements, audit
        v                       |
Published manifest + immutable deck artifacts
        |
        | HTTPS API
        v
WHATZ IT? mobile app
        |
        +---- local SQLite catalog and installed cards
        |
        +---- persistent owned covers and catalog thumbnails
        |
        +---- Apple StoreKit / Google Play Billing
```

### 4.1 Responsibilities

| Component | Responsibility |
| --- | --- |
| MySQL/MariaDB | Authoritative drafts, published content, versions, publication history, products, entitlements, and audit records |
| PHP admin API | Authentication, draft editing, validation, conflict handling, publishing, history, and rollback |
| PHP public/app API | Catalog manifests, deck metadata, authorized content downloads, entitlement synchronization, and purchase verification |
| Hostinger filesystem | Immutable content-addressed thumbnails and cover images; optional generated JSON artifacts |
| Mobile SQLite | Last synchronized catalog, locally installed cards, ownership/install state, sync metadata, and local search indexes |
| StoreKit / Play Billing | Customer-facing transaction confirmation and store-owned transaction history |

### 4.2 Non-negotiable boundaries

- The mobile app never connects directly to MySQL.
- Database credentials and store verification credentials never ship in the
  app.
- Draft edits never appear in the public catalog.
- A publish becomes visible atomically as one catalog revision.
- The app never deletes a working local revision before its replacement is
  usable.
- Raw cover images are not stored as SQLite BLOBs. SQLite stores metadata,
  hashes, URLs, and local file paths.
- Protected card content is not included in the public discovery manifest.

## 5. Version and Identity Model

Versions are generated by the server during Publish, not manually selected by
an administrator.

### 5.1 Stable identities

- `deckId`, `bundleId`, and `cardId` are stable identifiers.
- Renaming a title does not change its stable ID.
- ID changes are explicit migrations because they affect entitlements,
  downloads, history, and recorded rounds.
- Apple and Google product IDs are immutable once released and must be stored
  separately from editable deck titles.

### 5.2 Version fields

| Field | Increments when |
| --- | --- |
| `schemaVersion` | The wire/storage format becomes incompatible or requires a migration |
| `catalogRevision` | Any published catalog change occurs |
| `deckVersion` | Any published metadata, access, card-content, or cover-reference change affects a deck |
| `cardContentVersion` | The playable card payload changes |
| `bundleVersion` | Bundle metadata, access, ordering, or membership changes |
| `coverHash` | The actual cover bytes change |
| `thumbnailHash` | The generated catalog thumbnail bytes change |

`updatedAt` remains useful for display and diagnostics but is not used as the
primary synchronization comparison.

### 5.3 Version rules

- Editing cards increments `cardContentVersion`, `deckVersion`, and
  `catalogRevision`.
- Editing a deck title, description, tags, access, or product mapping increments
  `deckVersion` and `catalogRevision` but does not force card redownload when
  `cardContentVersion` and the content hash are unchanged.
- Replacing a cover creates new cover and thumbnail hashes and increments
  `deckVersion` and `catalogRevision`.
- Changing bundle membership increments only the affected bundle versions and
  the global catalog revision; it does not increment member deck versions.
- Reordering catalog sections increments the global catalog revision and only
  the entity versions whose own stored order changed.
- Every downloadable artifact has a SHA-256 hash and byte size in the manifest.

## 6. Server Data Model

The exact table names can change during implementation, but the following
logical entities are required.

### 6.1 Catalog authoring and publication

- `catalog_revisions`
  - revision number, schema version, state, publication time, publisher,
    source revision, summary, and manifest hash;
- `decks`
  - stable ID and lifecycle status;
- `deck_revisions`
  - deck version, card-content version, metadata, access, product mappings,
    cover hashes, and publication range;
- `cards`
  - deck revision/content version, stable card ID, text, byline, and order;
- `bundles`
  - stable ID and lifecycle status;
- `bundle_revisions`
  - bundle version, metadata, access, product mappings, and order;
- `bundle_decks`
  - ordered deck membership for a bundle revision;
- `media_assets`
  - hash, type, MIME type, dimensions, byte size, storage path, creation time,
    and reference status;
- `drafts` or equivalent draft tables
  - unpublished editor state and optimistic-lock version;
- `publication_events`
  - validation result, change summary, administrator, timestamp, source IP or
    request metadata, and rollback relationship.

### 6.2 Commerce and entitlement data

- `store_products`
  - platform, immutable product ID, product type, deck/bundle target, status,
    and availability;
- `app_users` or `installations`
  - the stable backend identity used to associate verified transactions;
- `store_transactions`
  - platform, unique transaction/purchase token, original transaction,
    product ID, state, purchase time, verification result, and raw-response
    reference where retention is permitted;
- `entitlements`
  - user, deck or bundle source, granted/revoked state, source transaction,
    and verification timestamps;
- `entitlement_events`
  - append-only grant, restore, revoke, refund, and reconciliation history.

All schema changes require ordered, repeatable PHP/database migrations. Manual
phpMyAdmin edits are acceptable for initial database creation but not as the
normal deployment mechanism.

## 7. Published Catalog and Content Artifacts

### 7.1 Public discovery manifest

The public manifest contains enough data to browse the store but no protected
cards. It includes:

- schema and global catalog versions;
- minimum supported app/content schema information;
- deck summaries, versions, access, tags, card counts, hashes, and product IDs;
- bundle summaries, versions, ordered membership, and product IDs;
- thumbnail and cover URLs/hashes/sizes;
- deletion or retirement status; and
- an ETag or manifest hash.

The API supports `ETag` and `If-None-Match` so an unchanged check returns no
catalog body.

### 7.2 Playable deck artifacts

- Each published card payload is immutable and addressed by deck ID plus
  content version or hash.
- A payload includes the stable deck ID, card-content version, ordered cards,
  hash, and schema version.
- Free payloads may be public; paid payloads require a verified entitlement.
- The client validates schema, deck ID, expected version, byte size, and hash
  before installation.
- Old artifacts remain available long enough for safe rollback and interrupted
  downloads.

### 7.3 Images

- Deck Manager converts source covers to the supported WebP format.
- Publish creates a full cover and a smaller catalog thumbnail.
- Files use content-addressed or hash-versioned names so caches cannot serve an
  old image at a new revision.
- Catalog thumbnails may be prefetched and persisted to support fully visual
  offline browsing.
- Full covers for free and owned decks are stored persistently.
- Unowned full covers may use a replaceable cache.
- Media garbage collection occurs only after a retention window and only when
  no published or rollback-supported revision references the asset.

## 8. Mobile SQLite Model

The exact SQL is an implementation detail, but SQLite needs these logical
tables:

- `catalog_state`
  - installed schema version, catalog revision, ETag, sync timestamps, and
    last error;
- `decks`
  - all discoverable deck metadata and version/hash fields;
- `bundles`
  - all discoverable bundle metadata and versions;
- `bundle_decks`
  - ordered local membership;
- `cards`
  - cards only for bundled free content and installed owned content;
- `deck_installations`
  - ownership source, desired version, installed version, status, progress,
    retry information, and last verified time;
- `media_files`
  - remote hash/URL, local URI, persistence class, byte size, and validation
    status;
- `entitlements`
  - locally known grants and their last server/store verification state;
- `sync_jobs`
  - recoverable catalog, deck, cover, restore, and reconciliation jobs;
- optional SQLite FTS tables for deck title, description, and tags.

Use foreign keys, prepared statements, explicit migrations, and WAL mode where
supported by Expo SQLite. Follow the exact Expo SDK 57 documentation before
implementation: <https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/>.

### 8.1 Seed behavior

- Every build includes a valid baseline catalog plus a small free starter set.
- First launch creates/migrates SQLite and imports the bundled baseline.
- A later app build may contain a newer baseline than the local database. The
  app imports it only when its revision is newer and preserves locally owned
  installations and entitlements.
- A server catalog newer than both local and bundled data is applied afterward.
- A failed seed or migration surfaces a recoverable error rather than opening
  the game against a partially initialized database.

### 8.2 Repository/provider transition

- Introduce a catalog repository interface instead of importing mutable
  module-level arrays.
- Provide in-memory indexes after SQLite initialization so gameplay lookups do
  not perform unnecessary queries per frame or card.
- Place the provider above all screens that need deck information.
- Add an explicit initialized/loading/error state to app startup.
- Update deck details, home, ready, game, results, settings-return behavior,
  recorded-video deck labels, and round context to use the repository.
- Keep a temporary bundled-catalog adapter behind a feature flag during
  migration and remove it only after rollback confidence is established.

### 8.3 Bundled-baseline release workflow

- Database publication remains the live source of truth and immediately feeds
  device synchronization; Hostinger does not receive Git credentials and does
  not push directly into the mobile repository.
- Every publication deterministically generates a revision-addressed baseline
  export. A change to a free/starter deck's metadata, cards, cover, order, or
  bundle membership—and the addition or removal of a starter deck—marks the
  app baseline as needing refresh.
- Before an app-store release, a release-preparation command fetches the active
  baseline export and immutable free content/media, verifies every revision,
  size, and SHA-256 hash, regenerates the bundled catalog and Metro static image
  registry, and runs parity tests before the generated files are committed.
- Existing installations do not wait for an app release: after one successful
  foreground/resume synchronization, updated metadata and persisted thumbnails
  remain browsable offline, and verified free-deck cards and covers remain
  playable offline. A brief network connection that ends before the atomic sync
  completes does not count as a successful synchronization.
- Future binaries may therefore grow their bundled free starter baseline, but
  ordinary Deck Manager publications do not enlarge an already-installed app
  or require a new app-store build. Paid card payloads are never included in
  the bundled baseline.

## 9. Synchronization Protocol

### 9.1 Catalog sync triggers

- after local database initialization;
- when the app becomes active, subject to a freshness interval;
- when connectivity returns;
- after a completed or restored purchase;
- after authentication/entitlement reconciliation; and
- optional user-initiated refresh on catalog screens.

The app renders local content immediately and performs network work in the
background. Connectivity detection improves timing, but failed HTTP requests
remain the authoritative signal and must be handled normally.

### 9.2 Catalog sync algorithm

1. Read the local revision and ETag.
2. Request the current manifest conditionally.
3. Stop on `304 Not Modified`.
4. Download a newer manifest to staging.
5. Validate schema compatibility, required fields, IDs, uniqueness, hashes,
   bundle references, and version monotonicity.
6. In one exclusive SQLite transaction, upsert deck/bundle metadata, update
   memberships, mark retired items, and set the catalog revision.
7. Commit only after the complete manifest is valid.
8. Recompute automatic install/update jobs for free and entitled decks.
9. Notify subscribed screens once, after commit.

### 9.3 Deck installation/update algorithm

1. Record or retain the entitlement.
2. Set the desired card-content version and installation state.
3. Download the immutable card artifact and required persistent cover to
   staging locations.
4. Validate response authorization, schema, ID, version, size, and hashes.
5. In one SQLite transaction, replace that deck's cards and update its
   installation record.
6. Atomically move/finalize staged media.
7. Mark the deck `installed` only when both database and required media are
   ready.
8. Remove obsolete files later, after successful activation.

If any step fails, keep the previous installed version and retry with bounded
exponential backoff when connectivity returns.

### 9.4 Installation states

- `catalog_only`
- `owned_pending_install`
- `installing`
- `installed`
- `update_available`
- `updating`
- `install_failed`
- `retired_installed`

These states support recovery and diagnostics. Normal user-facing UI should
reduce them to simple actions such as Buy, Preparing, Play, or Retry.

## 10. Purchase and Entitlement Flow

Decks and bundles are expected to use non-consumable in-app purchases unless a
future product decision changes the business model.

### 10.1 Purchase flow

1. Load the platform product and current localized price.
2. Present the native Apple/Google confirmation flow.
3. Receive a completed, pending, cancelled, or failed result.
4. Send the signed transaction/purchase token to the PHP backend.
5. Verify it with the appropriate store service and enforce unique processing.
6. Persist the transaction and grant deck/bundle entitlements atomically.
7. Return the complete effective entitlement set or its revision.
8. Automatically enqueue and install all newly entitled decks.
9. Expose Play only when the selected deck is locally installed.
10. Acknowledge/finish the store transaction only at the correct point in the
    platform's required workflow.

Store transaction listeners must initialize at app launch so purchases
completed outside the current screen, pending-family approvals, interrupted
transactions, and purchases made on another device can be reconciled.

### 10.2 Bundle purchases

- Purchasing a bundle grants an entitlement whose source is the bundle.
- The backend resolves that grant into effective deck entitlements.
- The app automatically installs every currently entitled member deck.
- Overlap between an individually owned deck and a bundle never creates
  duplicate cards or conflicting installation records.
- The business must decide before launch whether previous bundle purchasers
  automatically receive decks added to that bundle later. The recommended
  default is yes; a catalog/entitlement sync then automatically installs the
  newly included deck.
- Removing a deck from a purchased bundle requires an explicit product policy.
  It should not silently remove already purchased value without product/legal
  review.

### 10.3 Interrupted purchases

- Payment success and content installation are separate recoverable facts.
- A successful transaction that loses connectivity becomes
  `owned_pending_install`, not a failed or repeatable purchase.
- On every launch/resume, query unfinished/current store transactions and
  reconcile with the backend.
- Never ask the customer to buy again to repair a missing download.

### 10.4 Restores and multiple devices

- Restore Purchases verifies store history and repopulates backend/local
  entitlements.
- Missing deck content installs automatically after restore.
- Store purchases are naturally tied to the customer's Apple or Google store
  account.
- Cross-platform ownership between iOS and Android is not automatic. Supporting
  it requires a WHATZ IT? account and a deliberate cross-platform entitlement
  policy. This is a product decision before commerce implementation.

### 10.5 Refunds and revocations

- Store server notifications and periodic reconciliation update revoked or
  refunded entitlements.
- Offline devices continue using their last locally verified state until they
  reconnect; this limitation must be accepted or mitigated with an entitlement
  lease policy.
- The product must decide whether revoked content is deleted, retained but
  locked, or retained for a grace period. Prefer locking first and deferring
  deletion to avoid accidental data loss during reconciliation errors.

## 11. Catalog and Store Screens

### 11.0 Primary navigation and terminology

- The home screen uses two top-level tabs: **My Decks** and **Explore**.
- **My Decks** is the player's playable library: free starter decks and fully
  installed purchases. **Explore** is the storefront and discovery surface;
  the label remains appropriate when it contains free, owned, and purchasable
  content instead of making every visit feel like checkout.
- Explore has two clearly selectable views: **Bundles** and **All Decks**. Use
  a compact segmented control or equivalent native-feeling control rather than
  adding another navigation hierarchy.
- Preserve the selected Explore view, search query, filters, and scroll
  position while navigating into a product and back during the same session.
- The storefront shell, navigation, search, filters, and product-detail states
  are built and tested before store transactions are connected. Until Phase 4
  supplies real platform products, purchase controls remain explicitly
  unavailable or operate only in a clearly identified development fixture;
  they must never simulate ownership in a production build.

### 11.1 Home/My Decks

- Show free starter decks and fully installed owned decks.
- A newly purchased deck may briefly show Preparing with progress.
- Never route an incomplete installation into gameplay.
- Surface a compact retry state only after automatic retries fail.

### 11.2 Store/catalog browsing

- Query SQLite using stable cursor/keyset pagination where practical; simple
  `LIMIT` paging is acceptable for the first implementation.
- Support See More, Load More, or infinite scrolling without changing storage
  architecture.
- Search titles, descriptions, and tags locally; add SQLite FTS when catalog
  size or search quality warrants it.
- Initial search covers deck and bundle titles, descriptions, tags, and the
  names/tags of decks contained in a bundle. Do not expose paid card text in
  the public manifest or local catalog search index. Card-text search may be
  considered later only for already-installed content, but is not part of
  storefront discovery because it can reveal paid content and gameplay
  answers.
- Filters begin with ownership/access state, category, and tags. Genre may be
  presented as a user-facing category where appropriate, but the data model
  should use one controlled category/taxonomy system rather than accumulating
  overlapping free-text genre/category fields.
- Support multiple selected tags/categories, a clear-all action, useful empty
  states, and result counts. Search and filters compose rather than replacing
  one another.
- Bundles and individual decks remain independently purchasable. Owning a
  bundle marks its included decks accordingly, while a previously purchased
  individual deck is not charged or installed twice when buying an overlapping
  bundle.
- Load/prefetch thumbnails near the viewport and persist them according to the
  offline catalog policy.
- Clearly distinguish owned, included-in-owned-bundle, free, and unowned.

### 11.2.1 Bundle browse cards

- Each bundle result gives the title and a short description visual priority
  alongside its member deck covers as a compact fan.
- Use an alternating editorial layout down the bundle list: the first result
  places copy on the left and the cover fan on the right, the second places the
  fan on the left and copy on the right, and subsequent results repeat that
  left/right rhythm.
- The fan is generated from locally cached thumbnails, has a defined maximum
  visible count, and includes an accessible text equivalent such as the bundle
  deck count. Large bundles must not render every cover in the browse card.
- The layout adapts rather than shrinking text or covers excessively on narrow
  phones, large text sizes, and landscape/orientation changes. When there is
  not enough horizontal space, every result uses one predictable stacked order
  instead of preserving alternation at the expense of readability.

### 11.3 Deck details

- Always show locally cached metadata and thumbnail when available.
- Offline unowned state allows inspection but replaces Buy with a concise
  connection-required message.
- Online unowned state uses the current platform-localized price.
- Owned but incomplete state shows Preparing or Retry.
- Installed state shows Play.
- A deck opened from Explore uses a purchase-focused detail screen that closely
  matches the existing deck visual language: cover, title, description, tags,
  ownership state, and localized price. It omits timer and Play controls while
  unowned and uses one clear Buy action instead.
- After purchase and installation, the same stable deck route may transition
  to an owned/installed state with Play, avoiding duplicate product identities
  or conflicting detail screens.
- A deck preview opened from inside a bundle appears in a dismissible sheet
  with a close button in the upper-right. The sheet shows cover, title,
  description, and relevant tags, but no timer or Play control. It may offer a
  secondary route to the individual deck purchase detail when that deck is
  sold separately.

### 11.4 Bundle details

- Show membership and installed/owned status per deck.
- Lead with bundle title, description, localized bundle price, and one clear
  purchase button whose disabled/offline/owned/preparing states are explicit.
- Present member covers in a slow, subtle, automatically moving carousel. The
  player can swipe or drag it directly; manual interaction pauses automatic
  motion long enough to prevent the carousel from fighting the gesture.
- Respect Reduce Motion by disabling automatic movement while retaining manual
  swiping and full bundle information.
- Selecting a cover opens the read-only deck-preview sheet described above.
  Carousel items expose deck names and position/count to assistive technology,
  and focus returns to the selected cover after the sheet closes.
- Buying a bundle starts one purchase followed by automatic installation of
  all included content.
- Aggregate progress may be shown as Preparing Bundle without exposing file or
  offline-download concepts.

### 11.5 Storefront states and price integrity

- Product prices displayed for purchase come from StoreKit or Google Play and
  use the store's localized formatting. Database prices are merchandising
  metadata/fallbacks and are never the amount charged or a guarantee of a
  current price.
- Offline storefront browsing uses synchronized metadata and thumbnails. An
  unowned product remains inspectable, but Buy is replaced or disabled with a
  concise connection-required explanation.
- Distinguish loading price, unavailable product, already owned, included in an
  owned bundle, purchasing, pending approval, verifying, preparing content,
  retry, and ready states without allowing repeated purchase taps.
- Include Restore Purchases in a discoverable account/settings or storefront
  location; it is not presented as a substitute for ordinary automatic
  reconciliation.

## 12. Deck Manager Changes

### 12.1 Authentication and authorization

- Preserve the existing administrator allowlist and secure session/CSRF
  protections initially.
- GitHub OAuth may remain the admin identity provider even after GitHub ceases
  to be the catalog data store.
- Remove repository installation-token and repository-write requirements only
  after the database publishing path is production-ready.
- Add explicit admin roles later if publishing and editing need separation.

### 12.2 Loading and drafts

- Replace GitHub catalog reads with PHP/MySQL reads.
- Persist drafts server-side so an accidental browser close does not discard
  work.
- Autosave draft changes with debouncing and visible saved/error state.
- Use optimistic concurrency with a draft version or update token.
- Detect and explain another editor's conflicting changes.
- Preserve an explicit Get Latest/discard workflow for conflict recovery.

### 12.3 Deck editor

- Remove manual version management from the normal form.
- Display current published deck and card-content versions read-only.
- Add Apple and Google product mapping/status fields when commerce work begins.
- Validate stable ID changes as migrations rather than ordinary edits.
- Continue card creation, editing, bulk import, duplicate detection, and ordered
  card management.
- Show whether a change will affect metadata only, playable card content, or
  media before publish.

### 12.4 Bundle editor

- Add server-managed bundle versions.
- Add Apple and Google bundle-product mappings when commerce work begins.
- Continue independent bundle ordering and deck membership ordering.
- Warn when changing membership of an already purchasable bundle because that
  may change existing customer entitlements.
- Show the effective paid/free and entitlement consequences in publish review.

### 12.5 Images

- Continue server-side upload validation, resizing, and WebP conversion.
- Generate both full cover and catalog thumbnail variants.
- Stage files under temporary names outside the public immutable namespace.
- Finalize content-addressed files during publish.
- Preserve old referenced media for rollback and delayed garbage collection.

### 12.6 Publishing

Publish must execute as a guarded server operation:

1. Confirm the draft is based on the current published revision.
2. Re-run full server validation.
3. Diff the draft against the current published snapshot.
4. Assign global, deck, card-content, bundle, and media versions/hashes.
5. Generate immutable artifacts and manifest in staging.
6. Commit database rows and the new active catalog revision atomically.
7. Finalize staged media/artifacts.
8. Record the administrator and automatic change summary.
9. Return the newly published state to the editor.

If filesystem finalization cannot be included in the database transaction, use
a two-phase publication state (`preparing` then `active`). Public APIs return
only the latest `active` revision. A failed preparation is never visible.

### 12.7 History, rollback, and backups

- Replace Git commit history in the UI with immutable publication records.
- Show entity/card/media changes and the publishing administrator.
- Rollback creates a new forward-moving catalog revision from an older snapshot;
  revision numbers never move backward.
- Provide a JSON export compatible with the published wire schema.
- Schedule automated MySQL backups and media backups outside the web root.
- Periodically test restoration into a non-production database.
- Retain Git export as an optional secondary backup during migration, not the
  live source of truth.

## 13. PHP API Surface

Exact routes may change, but responsibilities should be separated.

### 13.1 Public/app catalog routes

- `GET /api/v1/catalog/manifest`
- `GET /api/v1/catalog/revisions/{revision}` when immutable revision retrieval
  is needed
- `GET /content/thumbnails/{hash}.webp`
- `GET /content/covers/{hash}.webp`
- `GET /api/v1/decks/{deckId}/content/{contentVersion}`

Paid deck-content responses require an authenticated effective entitlement.

### 13.2 Commerce routes

- `POST /api/v1/purchases/apple/verify`
- `POST /api/v1/purchases/google/verify`
- `POST /api/v1/purchases/restore` or platform-specific reconciliation
- `GET /api/v1/entitlements`
- store server-notification/webhook endpoints for refunds, revocations, pending
  completions, and out-of-app changes

### 13.3 Admin routes

- session/authentication and logout;
- load active catalog and draft;
- create/update draft;
- stage media;
- validate draft;
- publish;
- publication history;
- rollback by creating a new revision; and
- operational health/status restricted to admins.

### 13.4 API behavior

- Use HTTPS only in production.
- Return typed JSON error codes, not only human messages.
- Use conditional requests and appropriate immutable caching headers.
- Use prepared SQL statements and transactions.
- Apply request-size limits, rate limits, authentication checks, and audit
  logging by route sensitivity.
- Include a request/correlation ID for diagnosing purchase and publish failures.
- Never expose internal filesystem paths, SQL errors, secrets, store
  credentials, or raw stack traces.

## 14. Security and Content Protection

- Verify purchases on the backend before granting entitlements.
- Enforce uniqueness of Apple transaction IDs and Google purchase tokens.
- Validate that product IDs, bundle/application IDs, environment, and purchase
  states match expected production configuration.
- Make entitlement grants and transaction persistence idempotent.
- Protect paid card endpoints with short-lived authenticated authorization.
- Do not place paid card data in the public manifest, app bundle, or public
  cover directory.
- Store local auth credentials/tokens in the platform secure store, not
  AsyncStorage or ordinary SQLite fields.
- Validate all artifact hashes before local activation.
- Accept that no client-side offline content system provides perfect DRM: a
  sufficiently motivated device owner can inspect app storage. The goal is
  strong store verification and reasonable access control, not an impossible
  promise that decrypted offline cards can never be extracted.
- Establish privacy, data-retention, account-deletion, and support procedures
  before collecting persistent user/account identifiers.

## 15. Reliability and Observability

Track operational events without logging card content or secrets:

- catalog checks, changes, validation failures, and applied revisions;
- deck install/update duration, bytes, version, retry count, and error class;
- purchase state transitions and backend verification outcomes;
- entitlement reconciliation and restore outcomes;
- Deck Manager draft saves, conflicts, validations, publishes, and rollbacks;
- API latency, error rates, and database/media health.

The app should expose a support/diagnostics view or export containing:

- app version and platform;
- local schema/catalog revision;
- installed deck/content versions;
- pending job states;
- last sync time and sanitized error codes; and
- no store receipt, token, personal secret, or complete card payload.

## 16. Migration and Delivery Phases

### Phase 0: Confirm product decisions

- Confirm Hostinger database availability, limits, backup method, PHP version,
  required extensions, HTTPS domain, and production filesystem layout.
- Decide whether WHATZ IT? accounts are required initially.
- Decide platform-local versus cross-platform ownership.
- Decide whether existing bundle purchasers receive future member decks.
- Decide refund/revocation and offline grace behavior.
- Select an Expo SDK 57-compatible in-app purchase library/native integration.
- Define Apple and Google product-ID naming conventions before creating store
  products.

Exit criterion: unresolved choices cannot force a destructive schema or store
product migration later.

### Phase 1: Database foundation and read-only catalog service

- Add versioned database migrations and environment-based secrets.
- Implement published catalog/media tables and import tooling.
- Import the existing schema-version-5 catalog as the initial database
  revision while preserving stable IDs and current global revision.
- Generate manifest, card artifacts, covers, and thumbnails.
- Implement public manifest and free-content endpoints with caching.
- Compare database exports against the existing TypeScript catalog in automated
  parity tests.

Exit criterion: the new service can reproduce the current catalog exactly and
serve it without changing the production app.

### Phase 2: Deck Manager database migration

- Add server-side drafts and optimistic concurrency.
- Replace GitHub read/publish operations with database/media operations.
- Add automatic entity/content version calculation.
- Add publication history, change summaries, export, and forward rollback.
- Preserve optional Git export/backup during the transition.
- Run current and new manager test suites against a disposable database.

Exit criterion: administrators can edit, publish, recover, and roll back through
the database path with no Git repository write required.

### Phase 3: Mobile local catalog and free-content sync

- Install and configure Expo SQLite using the exact SDK 57 APIs.
- Add schema migrations, baseline seed, repository/provider, and boot state.
- Convert static deck lookups across all screens and round state.
- Add local metadata paging, search/filter foundations, and media file manager.
- Add background catalog synchronization and automatic free-deck updates.
- Add deterministic baseline export/import tooling, stale-baseline detection,
  and release-time parity verification for free starter content and media.
- Preserve a feature-flagged bundled fallback for rollout.
- Confirm all free starter decks work after a clean offline installation.

Exit criterion: the app launches and plays from SQLite, can apply a server
catalog revision, and remains fully usable with the server unavailable.

### Phase 3.5: Storefront experience foundation

- Add the **My Decks** and **Explore** home tabs and the **Bundles** / **All
  Decks** Explore control.
- Implement paged local search and composable filters against synchronized
  public metadata, with a controlled category/tag taxonomy.
- Build alternating bundle browse cards with accessible cover fans, bundle
  details with the motion-aware interactive carousel, and the deck-preview
  sheet.
- Build purchase-focused individual deck details and every offline/loading/
  unavailable/owned/preparing visual state using non-transactional fixtures.
- Define the UI-facing purchase/entitlement state interface that Phase 4 will
  implement, without granting ownership or embedding fake production prices.
- Test navigation restoration, accessibility, large text, Reduce Motion,
  empty/error states, and catalogs large enough to require paging.

Exit criterion: the complete storefront can browse real synchronized catalog
metadata and accurately render every commerce state through fixtures, while no
production control can initiate or imitate a purchase. Phase 4 then connects
the state interface to verified Apple/Google products and backend entitlements.

### Phase 4: Store and entitlement backend

- Configure non-consumable deck/bundle products in Apple and Google test
  environments.
- Add product mappings to the database and Deck Manager.
- Implement backend receipt/token verification, idempotent transactions,
  entitlements, restores, and store notifications.
- Complete security review and sandbox/license-tester coverage.

Exit criterion: test purchases and restores produce correct, auditable effective
entitlements without granting pending, cancelled, forged, or duplicate
transactions.

### Phase 5: Invisible owned-content installation

- Connect purchase completion and entitlement sync to the installation queue.
- Add protected deck artifact downloads and persistent owned covers.
- Add Preparing, retry, restore, and offline states to deck/bundle screens.
- Make bundle installation resumable and deduplicated.
- Pin installed content during active rounds.
- Test interruption at every boundary: payment, verification, metadata sync,
  artifact download, hash validation, SQLite commit, and media finalization.

Exit criterion: once a deck is shown as owned and ready, it plays offline with
no additional user download action.

### Phase 6: Scale, rollout, and cleanup

- Load-test catalogs with at least 1,000 decks, large bundles, and realistic
  card counts.
- Tune pagination, indexes, FTS, media prefetch, and retention policies.
- Roll out server sync behind a feature flag and monitor adoption/errors.
- Keep old app versions supported through a documented compatibility window.
- Retire TypeScript catalog publishing only after active supported builds use
  the service safely.
- Remove obsolete GitHub App repository-write secrets and legacy manager code.

Exit criterion: production monitoring and recovery drills demonstrate safe
catalog publishing, automatic updates, purchases, restores, and offline play at
the target scale.

## 17. Test Plan

### 17.1 Mobile unit and integration tests

- SQLite migration from every released schema version;
- baseline seed and newer-build baseline merge;
- global/deck/bundle/content version comparisons;
- manifest validation and rejected downgrade/corruption;
- atomic catalog commit and rollback on failure;
- paged catalog queries, filters, and search;
- entitlement-to-install-state reduction;
- deck/bundle overlap and deduplicated cards;
- interrupted/resumed downloads and hash mismatch;
- active-round version pinning;
- automatic update while old content remains playable;
- offline launch, browsing, and owned-deck play;
- offline Buy behavior and online recovery;
- restore after reinstall and missing-content repair.

### 17.2 PHP/database tests

- migration up/down or forward-recovery behavior as supported;
- input/schema/referential validation;
- prepared-statement and authorization boundaries;
- admin CSRF/session expiry;
- optimistic draft conflicts;
- deterministic version assignment from diffs;
- atomic publish visibility and two-phase failure recovery;
- media validation, content hashing, and reference retention;
- publication history and forward rollback;
- transaction verification fixtures for both stores;
- duplicate/replayed transaction idempotency;
- pending, cancelled, refunded, revoked, restored, and out-of-order events;
- entitlement resolution for individual/bundle overlap;
- protected deck endpoint authorization;
- ETag, cache-control, rate-limit, and error response behavior.

### 17.3 End-to-end scenarios

1. Clean install with no internet plays the bundled starter decks.
2. Catalog revision publishes and appears without a new app build.
3. Description-only edit does not redownload cards.
4. Card edit automatically updates an installed free or owned deck.
5. Purchase succeeds and cards install without a separate download action.
6. Connectivity disappears immediately after store success; next launch
   recovers ownership and installation without another charge.
7. Bundle purchase installs every unique member deck.
8. Purchase restore on a clean device reinstalls owned content.
9. Owned decks play in airplane mode after app restart.
10. Corrupt or truncated content never replaces the last working deck.
11. Deck Manager conflict prevents one editor from overwriting another.
12. A bad publication is rolled back as a new revision while apps retain a
    playable last-known-good catalog.
13. Explore search and combined filters return the same paged results online
    and offline from the last synchronized public metadata.
14. Bundle cover fans, the manually swipeable carousel, and deck-preview sheet
    remain usable with large text, assistive technology, and Reduce Motion.
15. An offline unowned deck or bundle remains inspectable but cannot begin a
    purchase, while an owned installed deck remains playable.

### 17.4 Performance targets to establish and measure

- warm offline app startup and catalog availability;
- catalog query latency for 1,000+ decks;
- local search latency;
- manifest payload size and conditional-check bandwidth;
- purchase-to-playable duration by deck and large bundle size;
- SQLite size after realistic ownership patterns;
- thumbnail/full-cover disk usage and cleanup behavior;
- PHP/API latency and concurrent database connection behavior within Hostinger
  limits.

## 18. Deployment, Compatibility, and Recovery

- Use separate development/test and production databases, credentials, media
  roots, store environments, and API base URLs.
- Never use production store verification endpoints for sandbox transactions or
  vice versa without explicit environment handling.
- Deploy backward-compatible server changes before app builds that depend on
  them.
- Include `minimumAppVersion` and supported schema information in the manifest,
  but avoid blocking existing offline play merely because a sync endpoint has
  newer optional data.
- Keep published artifacts immutable and retain enough history for supported
  clients and rollback.
- Back up database and media together so references remain consistent.
- Document a maintenance mode that blocks admin publishing while leaving the
  latest active catalog readable.
- Provide a server disable/feature flag allowing the app to remain on its local
  last-known-good catalog during an incident.

## 19. Completion Criteria

The architecture migration is complete when:

- Deck Manager publishes to the database-backed platform rather than modifying
  the app repository as its production workflow.
- Every publish is validated, versioned, auditable, atomic, and recoverable.
- The app stores and queries the catalog through SQLite.
- Hundreds or thousands of deck metadata records can be browsed and searched
  without loading every card into memory or rendering every result at once.
- Free starter and purchased deck cards are automatically persisted locally.
- A completed purchase or restore automatically becomes playable offline after
  installation, without an offline-download button.
- Interrupted purchases and downloads recover without duplicate charges or
  loss of entitlement.
- Paid card payloads are protected behind verified entitlements.
- Catalog, deck, bundle, card, and cover updates do not require an app-store
  binary release.
- Active rounds and last-known-good offline content remain stable throughout
  background updates and server incidents.
- Database/media backup restoration and catalog rollback have been tested.

## 20. Decisions to Record Before Implementation

Create an architecture decision record or update this section when each item is
resolved:

- Hostinger production database limits and backup retention;
- production API/content domain and directory layout;
- Expo SDK 57-compatible StoreKit/Play Billing integration;
- whether a WHATZ IT? account is required at purchase launch;
- cross-platform entitlement policy;
- future additions/removals from previously sold bundles;
- refund/revocation and offline grace policy;
- catalog thumbnail prefetch/persistence limits;
- supported old-app/schema compatibility window;
- draft collaboration model and admin roles;
- controlled storefront category/tag taxonomy and editorial ownership; and
- privacy, account deletion, transaction retention, and support procedures.

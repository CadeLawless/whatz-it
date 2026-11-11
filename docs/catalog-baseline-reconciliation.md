# Bundled Catalog Baseline reconciliation

The `Reconcile catalog baseline` workflow updates the Bundled Catalog Baseline through one
bot-managed pull request. It runs after an authenticated `catalog-production-published`
repository dispatch, daily at 09:17 UTC, or from **Actions → Reconcile catalog baseline → Run
workflow**. Event payloads provide `environment`, `status`, `published_revision`, and
`correlation_id`. Only `environment: production` plus `status: succeeded` is actionable.

The event revision is trace metadata, not catalog input. Every actionable event and every
recovery run independently fetches `CATALOG_MANIFEST_URL`, then converges the fixed
`automation/catalog-baseline` branch and its single rolling pull request on that active public
manifest. One cancelling concurrency group prevents obsolete runs from creating competing PRs.

## Repository setup

Configure these values in repository settings:

- Variable `CATALOG_MANIFEST_URL`: the active public HTTPS manifest.
- Variable `CATALOG_BASELINE_APP_ID`: the dedicated GitHub App ID.
- Secret `CATALOG_BASELINE_APP_PRIVATE_KEY`: that App's private key. The repository owner is
  responsible for storage, rotation, and revoking replaced keys.

Install the App only on this repository with read/write **Contents** and **Pull requests**
permissions. The workflow mints a short-lived installation token; do not substitute a personal
access token. Enable repository auto-merge, and protect `main` with the `Canonical quality gate`
required check. The App must be allowed to create branches/PRs and request auto-merge, but must
not bypass branch protection or write directly to `main`.

## Safety and recovery

Automation permits only `src/data/bundles.ts` and
`assets/images/decks/baseline/**`. It runs the canonical quality command before pushing. A
forward revision may request auto-merge; a regression remains open for human review. If
auto-merge is disabled or unavailable, a valid PR remains open and is not treated as generation
failure. Correlation IDs appear in the commit and PR body for publication-log tracing.

If an event is missed, wait for the daily run or start a manual run. Re-running is safe because
the active public manifest is the source of truth and an already-current baseline is a no-op.
Reconciliation and merging do not invoke EAS, TestFlight, store submission, or any release
workflow; releases remain explicit operations.

## External publication sender boundary

Issue #19 is owned by the private `CadeLawless/whatz-it-deck-platform` repository; this app
repository implements only the receiving and reconciliation side. The sender belongs in
`PublicationCoordinator::publish()` in `platform/lib/Publication.php`, after
`ArtifactPromoter::activateManifest()` succeeds and `publication_preparations` transitions from
`database_active` to `active`. Before dispatch, that service must verify the public
`/api/v1/catalog/manifest`, then send `preparationId` as `correlation_id` and
`catalog.revision` as `published_revision`.

This documents the handoff; it does not claim the external sender exists. Sender implementation
and integration exercise remain required externally, including authentication, bounded delivery
retries, operator logging, and proof that one production-like publication updates the rolling PR
without starting an app release.

# Catalog compatibility and retention policy

Effective: 2026-08-25

## Supported app window

WHATZ IT? supports the current production app version and the immediately
preceding production version. A superseded version remains in the compatibility
window for at least 12 months after its replacement is released. If fewer than
two production versions exist, every released version remains supported.

Version 1.0.0 is the initial client in this window. The public catalog remains
on manifest schema 1, catalog schema 5, and deck-content schema 1 while that
client is supported. Additive optional fields may be introduced without a
schema bump. Existing fields cannot change meaning, become invalid, or be
removed during the window.

An incompatible wire change requires one of these strategies before it can be
published:

1. Continue serving the existing schema alongside the new schema.
2. Introduce a separately negotiated endpoint or representation.
3. Wait until every incompatible app version has completed its support window.

`minimumAppVersion` remains `null` during the initial rollout. Raising it is a
reviewed production operation, not a routine Deck Manager publication. It may
only exclude versions already outside the compatibility window and requires
usage evidence, a rollback plan, and a verified current release baseline.

## Client behavior

The app validates manifest, catalog, and content schemas before activation. If
a future manifest requires a newer app version, synchronization fails closed:
the downloaded revision is not activated, no artifacts are installed, and the
last-known-good local catalog and offline decks continue working. The app does
not block offline play or show a mandatory-update screen solely because an
online catalog is incompatible.

## Artifact and rollback retention

Immutable card and media artifacts must remain available while referenced by:

- the active catalog;
- any revision retained for operational rollback; or
- a catalog that may still be requested by an app inside the supported window.

After the final reference leaves the supported window, retain the artifact for
an additional 90-day safety period. Garbage collection must begin with a
read-only report, must never delete database and media references separately,
and requires a verified backup before deletion. Until that reporting and
restore drill exists, the safe policy is no automated artifact deletion.

## Retirement evidence

The TypeScript catalog publisher and GitHub repository-write path may be
removed only after all of the following are recorded:

- every app version inside the supported window uses SQLite/server catalog
  synchronization safely;
- production sync, purchase, restore, offline play, rollback, and recovery
  drills pass;
- production diagnostics show no dependency on the legacy publication path;
- database and media backup restoration has been tested together; and
- the legacy path has remained unused through one full rollback-observation
  period.

Until then, the legacy files and secrets remain isolated rollback assets and
must not be deleted by routine cleanup.

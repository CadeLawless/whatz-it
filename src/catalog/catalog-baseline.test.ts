import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { applyBundledCatalogBaseline } from './catalog-database';
import { type CatalogSeedSource } from './catalog-seed';
import { catalogSchemaSqlForTests } from './catalog-schema';

const source = readFileSync(
  fileURLToPath(new URL('../data/bundles.ts', import.meta.url)),
  'utf8',
);
const managedCatalog = source.match(
  /\/\* DECK_MANAGER_CATALOG_START \*\/\s*([\s\S]*?)\s*\/\* DECK_MANAGER_CATALOG_END \*\//,
)?.[1];
if (!managedCatalog) throw new Error('Managed bundled catalog was not found.');
const bundledCatalog = JSON.parse(managedCatalog) as CatalogSeedSource;

describe('bundled catalog baseline activation', () => {
  it('inserts the baseline into an empty migrated database', async () => {
    const harness = createDatabaseHarness();
    try {
      assert.equal(
        await applyBundledCatalogBaseline(harness.adapter, bundledCatalog),
        'inserted',
      );
      assert.equal(catalogState(harness.database).catalog_revision, 32);
      assert.equal(catalogState(harness.database).source, 'bundled');
    } finally {
      harness.database.close();
    }
  });

  it('does not replace an equal or newer synchronized revision', async () => {
    const harness = createDatabaseHarness();
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      harness.database
        .prepare(
          `UPDATE catalog_state
              SET catalog_revision = 40, source = 'remote', etag = 'remote-etag'`,
        )
        .run();
      harness.database
        .prepare("UPDATE decks SET title = 'Remote title' WHERE deck_id = 'celebrity-shuffle'")
        .run();

      const olderBuild = structuredClone(bundledCatalog);
      olderBuild.revision = 39;
      olderBuild.decks[0].title = 'Older bundled title';
      assert.equal(
        await applyBundledCatalogBaseline(harness.adapter, olderBuild),
        'unchanged',
      );
      assert.deepEqual(catalogState(harness.database), {
        catalog_revision: 40,
        source: 'remote',
        etag: 'remote-etag',
      });
      assert.equal(deckTitle(harness.database), 'Remote title');
    } finally {
      harness.database.close();
    }
  });

  it('atomically installs a strictly newer bundled free-content baseline', async () => {
    const harness = createDatabaseHarness();
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      harness.database
        .prepare(
          `UPDATE catalog_state
              SET catalog_revision = 38, source = 'remote', etag = 'revision-38'`,
        )
        .run();

      const newerBuild = structuredClone(bundledCatalog);
      newerBuild.revision = 39;
      newerBuild.updatedAt = '2026-08-13T12:00:00Z';
      newerBuild.decks[0].title = 'Bundled revision 39';
      newerBuild.decks[0].version = 8;
      newerBuild.decks[0].cardContentVersion = 2;
      newerBuild.decks[0].cards[0].text = 'Bundled update installed';
      newerBuild.bundles[0].version = 2;

      assert.equal(
        await applyBundledCatalogBaseline(harness.adapter, newerBuild),
        'updated',
      );
      assert.deepEqual(catalogState(harness.database), {
        catalog_revision: 39,
        source: 'bundled',
        etag: null,
      });
      const deckRow = harness.database
        .prepare(
          `SELECT title, deck_version, card_content_version
             FROM decks WHERE deck_id = 'celebrity-shuffle'`,
        )
        .get();
      const deck = deckRow
        ? {
            title: deckRow.title,
            deck_version: deckRow.deck_version,
            card_content_version: deckRow.card_content_version,
          }
        : null;
      assert.deepEqual(deck, {
        title: 'Bundled revision 39',
        deck_version: 8,
        card_content_version: 2,
      });
      assert.equal(
        harness.database
          .prepare(
            `SELECT text FROM cards
              WHERE deck_id = 'celebrity-shuffle' AND position = 0`,
          )
          .get()?.text,
        'Bundled update installed',
      );
    } finally {
      harness.database.close();
    }
  });

  it('rolls back a failed newer baseline without disturbing the active catalog', async () => {
    const harness = createDatabaseHarness();
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      const invalidBuild = structuredClone(bundledCatalog);
      invalidBuild.revision = 39;
      invalidBuild.decks[0].title = 'Must not become active';
      invalidBuild.decks[0].cards.push({ ...invalidBuild.decks[0].cards[0] });

      await assert.rejects(() =>
        applyBundledCatalogBaseline(harness.adapter, invalidBuild),
      );
      assert.equal(catalogState(harness.database).catalog_revision, 32);
      assert.equal(deckTitle(harness.database), bundledCatalog.decks[0].title);
    } finally {
      harness.database.close();
    }
  });
});

function createDatabaseHarness() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(catalogSchemaSqlForTests);

  type Adapter = {
    getFirstAsync: (sql: string, ...parameters: SQLInputValue[]) => Promise<unknown>;
    getAllAsync: (sql: string, ...parameters: SQLInputValue[]) => Promise<unknown[]>;
    runAsync: (sql: string, ...parameters: SQLInputValue[]) => Promise<unknown>;
    prepareAsync: (sql: string) => Promise<{
      executeAsync: (parameters?: SQLInputValue[]) => Promise<unknown>;
      finalizeAsync: () => Promise<undefined>;
    }>;
    withExclusiveTransactionAsync: (
      operation: (transaction: Adapter) => Promise<void>,
    ) => Promise<void>;
  };
  const adapter: Adapter = {
    getFirstAsync: async (sql: string, ...parameters: SQLInputValue[]) =>
      database.prepare(sql).get(...parameters),
    getAllAsync: async (sql: string, ...parameters: SQLInputValue[]) =>
      database.prepare(sql).all(...parameters),
    runAsync: async (sql: string, ...parameters: SQLInputValue[]) =>
      database.prepare(sql).run(...parameters),
    prepareAsync: async (sql: string) => {
      const statement = database.prepare(sql);
      return {
        executeAsync: async (parameters: SQLInputValue[] = []) =>
          statement.run(...parameters),
        finalizeAsync: async () => undefined,
      };
    },
    withExclusiveTransactionAsync: async (
      operation: (transaction: typeof adapter) => Promise<void>,
    ) => {
      database.exec('BEGIN EXCLUSIVE');
      try {
        await operation(adapter);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };

  return { adapter: adapter as unknown as SQLiteDatabase, database };
}

function catalogState(database: DatabaseSync) {
  const row = database
    .prepare('SELECT catalog_revision, source, etag FROM catalog_state')
    .get();
  if (!row) throw new Error('Catalog state is missing.');
  return {
    catalog_revision: Number(row.catalog_revision),
    source: String(row.source),
    etag: row.etag === null ? null : String(row.etag),
  };
}

function deckTitle(database: DatabaseSync) {
  return String(
    database
      .prepare("SELECT title FROM decks WHERE deck_id = 'celebrity-shuffle'")
      .get()?.title,
  );
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { configuredCatalogSource } from './catalog-feature';
import { createCatalogSeed, type CatalogSeedSource } from './catalog-seed';
import {
  catalogSchemaSqlForTests,
  migrateCatalogDatabase,
} from './catalog-schema';

const source = readFileSync(
  fileURLToPath(new URL('../data/bundles.ts', import.meta.url)),
  'utf8',
);
const managedCatalog = source.match(
  /\/\* DECK_MANAGER_CATALOG_START \*\/\s*([\s\S]*?)\s*\/\* DECK_MANAGER_CATALOG_END \*\//,
)?.[1];
if (!managedCatalog) throw new Error('Managed bundled catalog was not found.');
const catalog = JSON.parse(managedCatalog) as CatalogSeedSource;

describe('bundled SQLite catalog seed', () => {
  it('preserves the complete discoverable catalog and ordering', () => {
    const seed = createCatalogSeed(catalog);

    assert.equal(seed.state.localSchemaVersion, 2);
    assert.equal(seed.state.catalogSchemaVersion, 5);
    assert.equal(seed.state.catalogRevision, 32);
    assert.equal(seed.decks.length, 20);
    assert.equal(seed.bundles.length, 2);
    assert.equal(
      seed.decks.reduce((total, deck) => total + deck.cardCount, 0),
      3814,
    );
    assert.deepEqual(
      seed.deckOrders.filter(({ scope }) => scope === 'free').map(({ deckId }) => deckId),
      catalog.deckOrders.free,
    );
    assert.deepEqual(
      seed.deckOrders.filter(({ scope }) => scope === 'paid').map(({ deckId }) => deckId),
      catalog.deckOrders.paid,
    );
    assert.deepEqual(
      seed.bundleDecks.map(({ bundleId, deckId }) => `${bundleId}:${deckId}`),
      catalog.bundles.flatMap((bundle) =>
        bundle.deckIds.map((deckId) => `${bundle.id}:${deckId}`),
      ),
    );
  });

  it('installs only free playable cards in the new local database', () => {
    const seed = createCatalogSeed(catalog);
    const freeDecks = catalog.decks.filter((deck) => deck.access === 'free');
    const paidDeckIds = new Set(
      catalog.decks.filter((deck) => deck.access === 'paid').map((deck) => deck.id),
    );

    assert.equal(
      seed.cards.length,
      freeDecks.reduce((total, deck) => total + deck.cards.length, 0),
    );
    assert.equal(seed.cards.some((card) => paidDeckIds.has(card.deckId)), false);
    assert.equal(
      seed.installations.filter(({ status }) => status === 'installed').length,
      freeDecks.length,
    );
    assert.equal(
      seed.installations.filter(({ status }) => status === 'not_owned').length,
      paidDeckIds.size,
    );
  });

  it('defines the local-first catalog, installation, and media tables', () => {
    for (const table of [
      'catalog_state',
      'decks',
      'bundles',
      'bundle_decks',
      'deck_orders',
      'cards',
      'deck_installations',
      'media_files',
    ]) {
      assert.match(catalogSchemaSqlForTests, new RegExp(`CREATE TABLE ${table} \\(`));
    }
    assert.doesNotMatch(catalogSchemaSqlForTests, /\bBLOB\b/i);
    for (const column of [
      'content_hash',
      'content_url',
      'cover_url',
      'thumbnail_url',
    ]) {
      assert.match(catalogSchemaSqlForTests, new RegExp(`\\b${column}\\b`));
    }
  });

  it('applies the complete schema to SQLite with foreign keys enabled', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec(catalogSchemaSqlForTests);
      const tables = database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all()
        .map((row) => String(row.name));
      assert.deepEqual(tables, [
        'bundle_decks',
        'bundles',
        'cards',
        'catalog_state',
        'deck_installations',
        'deck_orders',
        'decks',
        'media_files',
      ]);
      assert.throws(() =>
        database
          .prepare(
            `INSERT INTO cards (
              deck_id, card_content_version, card_id, position, text
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run('missing-deck', 1, 'missing-card', 0, 'Invalid'),
      );
    } finally {
      database.close();
    }
  });

  it('migrates the initial development schema without deleting its catalog', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE decks (
          deck_id TEXT PRIMARY KEY NOT NULL,
          cover_path TEXT,
          cover_hash TEXT,
          thumbnail_hash TEXT
        );
        INSERT INTO decks (deck_id) VALUES ('kept-deck');
        PRAGMA user_version = 1;
      `);
      type MigrationAdapter = {
        execAsync: (sql: string) => Promise<void>;
        getFirstAsync: (sql: string) => Promise<Record<string, unknown> | undefined>;
        withExclusiveTransactionAsync: (
          operation: (transaction: MigrationAdapter) => Promise<void>,
        ) => Promise<void>;
      };
      const adapter: MigrationAdapter = {
        execAsync: async (sql: string) => database.exec(sql),
        getFirstAsync: async (sql: string) =>
          database.prepare(sql).get() ?? undefined,
        withExclusiveTransactionAsync: async (
          operation: (transaction: typeof adapter) => Promise<void>,
        ) => operation(adapter),
      };

      await migrateCatalogDatabase(
        adapter as unknown as Parameters<typeof migrateCatalogDatabase>[0],
      );

      assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 2);
      assert.equal(
        database.prepare('SELECT deck_id FROM decks').get()?.deck_id,
        'kept-deck',
      );
      const columns = database
        .prepare('PRAGMA table_info(decks)')
        .all()
        .map((row) => String(row.name));
      assert.equal(columns.includes('content_hash'), true);
      assert.equal(columns.includes('thumbnail_url'), true);
    } finally {
      database.close();
    }
  });

  it('keeps the bundled runtime as the default feature-flag fallback', () => {
    assert.equal(configuredCatalogSource(undefined), 'bundled');
    assert.equal(configuredCatalogSource('unexpected'), 'bundled');
    assert.equal(configuredCatalogSource('sqlite'), 'sqlite');
  });
});

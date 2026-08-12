import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase, SQLiteStatement } from 'expo-sqlite';

import { bundledCatalog } from '@/data/bundles';

import { createCatalogSeed, type CatalogSeed } from './catalog-seed';
import {
  CATALOG_DATABASE_NAME,
  migrateCatalogDatabase,
} from './catalog-schema';

export async function openCatalogDatabase() {
  const database = await SQLite.openDatabaseAsync(CATALOG_DATABASE_NAME);
  await migrateCatalogDatabase(database);
  await seedBundledCatalogIfEmpty(database);
  return database;
}

export async function seedBundledCatalogIfEmpty(database: SQLiteDatabase) {
  const current = await database.getFirstAsync<{ catalog_revision: number }>(
    'SELECT catalog_revision FROM catalog_state WHERE singleton_id = 1',
  );
  if (current) return false;

  const seed = createCatalogSeed(bundledCatalog);
  let inserted = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<{ catalog_revision: number }>(
      'SELECT catalog_revision FROM catalog_state WHERE singleton_id = 1',
    );
    if (existing) return;
    await insertSeed(transaction, seed);
    inserted = true;
  });
  return inserted;
}

async function insertSeed(database: SQLiteDatabase, seed: CatalogSeed) {
  await database.runAsync(
    `INSERT INTO catalog_state (
      singleton_id, local_schema_version, catalog_schema_version,
      catalog_revision, source, catalog_updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)`,
    seed.state.localSchemaVersion,
    seed.state.catalogSchemaVersion,
    seed.state.catalogRevision,
    seed.state.source,
    seed.state.catalogUpdatedAt,
  );

  const statements = await Promise.all([
    database.prepareAsync(
      `INSERT INTO decks (
        deck_id, deck_version, card_content_version, title, description,
        access, price_minor_units, tags_json, card_count, cover_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    database.prepareAsync(
      `INSERT INTO bundles (
        bundle_id, bundle_version, title, description, access,
        price_minor_units, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    database.prepareAsync(
      'INSERT INTO bundle_decks (bundle_id, deck_id, position) VALUES (?, ?, ?)',
    ),
    database.prepareAsync(
      'INSERT INTO deck_orders (scope, deck_id, position) VALUES (?, ?, ?)',
    ),
    database.prepareAsync(
      `INSERT INTO cards (
        deck_id, card_content_version, card_id, position, text, byline
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    database.prepareAsync(
      `INSERT INTO deck_installations (
        deck_id, ownership_source, desired_content_version,
        installed_content_version, status
      ) VALUES (?, ?, ?, ?, ?)`,
    ),
  ]);

  try {
    for (const deck of seed.decks) {
      await statements[0].executeAsync([
        deck.deckId,
        deck.deckVersion,
        deck.cardContentVersion,
        deck.title,
        deck.description,
        deck.access,
        deck.priceMinorUnits,
        deck.tagsJson,
        deck.cardCount,
        deck.coverPath,
      ]);
    }
    for (const bundle of seed.bundles) {
      await statements[1].executeAsync([
        bundle.bundleId,
        bundle.bundleVersion,
        bundle.title,
        bundle.description,
        bundle.access,
        bundle.priceMinorUnits,
        bundle.sortOrder,
      ]);
    }
    await executeRows(statements[2], seed.bundleDecks, (row) => [
      row.bundleId,
      row.deckId,
      row.position,
    ]);
    await executeRows(statements[3], seed.deckOrders, (row) => [
      row.scope,
      row.deckId,
      row.position,
    ]);
    await executeRows(statements[4], seed.cards, (row) => [
      row.deckId,
      row.cardContentVersion,
      row.cardId,
      row.position,
      row.text,
      row.byline,
    ]);
    await executeRows(statements[5], seed.installations, (row) => [
      row.deckId,
      row.ownershipSource,
      row.desiredContentVersion,
      row.installedContentVersion,
      row.status,
    ]);
  } finally {
    for (const statement of statements) await statement.finalizeAsync();
  }
}

async function executeRows<Row>(
  statement: SQLiteStatement,
  rows: Row[],
  parameters: (row: Row) => SQLite.SQLiteBindParams,
) {
  for (const row of rows) await statement.executeAsync(parameters(row));
}

import type { SQLiteBindParams, SQLiteDatabase, SQLiteStatement } from 'expo-sqlite';

import { createCatalogSeed, type CatalogSeed, type CatalogSeedSource } from './catalog-seed';
import {
  CATALOG_DATABASE_NAME,
  CATALOG_DEV_PREVIEW_DATABASE_NAME,
  migrateCatalogDatabase,
} from './catalog-schema';
import { configuredDevPreviewEnabled } from './catalog-feature';

export function createCatalogDatabaseOpener<Database>(
  initialize: () => Promise<Database>,
) {
  let databasePromise: Promise<Database> | undefined;
  return () => {
    if (!databasePromise) {
      databasePromise = initialize().catch((error: unknown) => {
        databasePromise = undefined;
        throw error;
      });
    }
    return databasePromise;
  };
}

async function initializeCatalogDatabase() {
  const [SQLite, { bundledCatalog }] = await Promise.all([
    import('expo-sqlite'),
    import('@/data/bundles'),
  ]);
  const database = await SQLite.openDatabaseAsync(
    configuredDevPreviewEnabled()
      ? CATALOG_DEV_PREVIEW_DATABASE_NAME
      : CATALOG_DATABASE_NAME,
  );
  await migrateCatalogDatabase(database);
  await applyBundledCatalogBaseline(database, bundledCatalog);
  return database;
}

export const openCatalogDatabase = createCatalogDatabaseOpener(
  initializeCatalogDatabase,
);

export async function seedBundledCatalogIfEmpty(
  database: SQLiteDatabase,
  catalog: CatalogSeedSource,
) {
  return (await applyBundledCatalogBaseline(database, catalog)) === 'inserted';
}

export type BundledBaselineResult = 'inserted' | 'updated' | 'unchanged';

export async function applyBundledCatalogBaseline(
  database: SQLiteDatabase,
  catalog: CatalogSeedSource,
): Promise<BundledBaselineResult> {
  const seed = createCatalogSeed(catalog);
  let result: BundledBaselineResult = 'unchanged';

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<{ catalog_revision: number }>(
      'SELECT catalog_revision FROM catalog_state WHERE singleton_id = 1',
    );
    if (!existing) {
      await insertSeed(transaction, seed);
      result = 'inserted';
      return;
    }
    if (existing.catalog_revision >= seed.state.catalogRevision) return;
    await mergeSeed(transaction, seed);
    result = 'updated';
  });
  return result;
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
        access, price_minor_units, tags_json, card_count, cover_path,
        apple_product_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    database.prepareAsync(
      `INSERT INTO bundles (
        bundle_id, bundle_version, title, description, access,
        price_minor_units, sort_order, apple_product_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
        deck.appleProductId,
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
        bundle.appleProductId,
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

async function mergeSeed(database: SQLiteDatabase, seed: CatalogSeed) {
  const existingInstallations = new Map(
    (
      await database.getAllAsync<{
        deck_id: string;
        ownership_source: string;
        installed_content_version: number | null;
        status: string;
      }>(
        `SELECT deck_id, ownership_source, installed_content_version, status
           FROM deck_installations`,
      )
    ).map((row) => [row.deck_id, row]),
  );

  await database.runAsync("UPDATE decks SET lifecycle_status = 'retired'");
  await database.runAsync("UPDATE bundles SET lifecycle_status = 'retired'");
  await database.runAsync('DELETE FROM bundle_decks');
  await database.runAsync('DELETE FROM deck_orders');

  const statements = await Promise.all([
    database.prepareAsync(
      `INSERT INTO decks (
        deck_id, deck_version, card_content_version, title, description,
        access, price_minor_units, tags_json, card_count, cover_path,
        content_hash, content_bytes, content_url, cover_hash, cover_bytes,
        cover_url, thumbnail_hash, thumbnail_bytes, thumbnail_url,
        apple_product_id, lifecycle_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL,
                NULL, NULL, NULL, NULL, NULL, ?, 'active')
      ON CONFLICT(deck_id) DO UPDATE SET
        deck_version = excluded.deck_version,
        card_content_version = excluded.card_content_version,
        title = excluded.title,
        description = excluded.description,
        access = excluded.access,
        price_minor_units = excluded.price_minor_units,
        tags_json = excluded.tags_json,
        card_count = excluded.card_count,
        cover_path = excluded.cover_path,
        content_hash = NULL,
        content_bytes = NULL,
        content_url = NULL,
        cover_hash = NULL,
        cover_bytes = NULL,
        cover_url = NULL,
        thumbnail_hash = NULL,
        thumbnail_bytes = NULL,
        thumbnail_url = NULL,
        apple_product_id = excluded.apple_product_id,
        lifecycle_status = 'active'`,
    ),
    database.prepareAsync(
      `INSERT INTO bundles (
        bundle_id, bundle_version, title, description, access,
        price_minor_units, sort_order, apple_product_id, lifecycle_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      ON CONFLICT(bundle_id) DO UPDATE SET
        bundle_version = excluded.bundle_version,
        title = excluded.title,
        description = excluded.description,
        access = excluded.access,
        price_minor_units = excluded.price_minor_units,
        sort_order = excluded.sort_order,
        apple_product_id = excluded.apple_product_id,
        lifecycle_status = 'active'`,
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
        deck.appleProductId,
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
        bundle.appleProductId,
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

    const freeDeckIds = new Set(
      seed.installations
        .filter((installation) => installation.ownershipSource === 'free')
        .map((installation) => installation.deckId),
    );
    for (const deckId of freeDeckIds) {
      await database.runAsync('DELETE FROM cards WHERE deck_id = ?', deckId);
    }
    await executeRows(statements[4], seed.cards, (row) => [
      row.deckId,
      row.cardContentVersion,
      row.cardId,
      row.position,
      row.text,
      row.byline,
    ]);

    for (const installation of seed.installations) {
      const existing = existingInstallations.get(installation.deckId);
      if (installation.ownershipSource === 'free') {
        await database.runAsync(
          `INSERT INTO deck_installations (
            deck_id, ownership_source, desired_content_version,
            installed_content_version, status, last_error_code
          ) VALUES (?, 'free', ?, ?, 'installed', NULL)
          ON CONFLICT(deck_id) DO UPDATE SET
            ownership_source = 'free',
            desired_content_version = excluded.desired_content_version,
            installed_content_version = excluded.installed_content_version,
            status = 'installed',
            last_error_code = NULL`,
          installation.deckId,
          installation.desiredContentVersion,
          installation.installedContentVersion,
        );
      } else if (!existing || existing.ownership_source === 'free') {
        if (existing?.ownership_source === 'free') {
          await database.runAsync('DELETE FROM cards WHERE deck_id = ?', installation.deckId);
        }
        await database.runAsync(
          `INSERT INTO deck_installations (
            deck_id, ownership_source, desired_content_version,
            installed_content_version, status, last_error_code
          ) VALUES (?, 'none', ?, NULL, 'not_owned', NULL)
          ON CONFLICT(deck_id) DO UPDATE SET
            ownership_source = 'none',
            desired_content_version = excluded.desired_content_version,
            installed_content_version = NULL,
            status = 'not_owned',
            last_error_code = NULL`,
          installation.deckId,
          installation.desiredContentVersion,
        );
      } else {
        await database.runAsync(
          `UPDATE deck_installations
              SET desired_content_version = ?
            WHERE deck_id = ?`,
          installation.desiredContentVersion,
          installation.deckId,
        );
      }
    }
  } finally {
    for (const statement of statements) await statement.finalizeAsync();
  }

  await database.runAsync(
    `UPDATE catalog_state SET
      local_schema_version = ?,
      catalog_schema_version = ?,
      catalog_revision = ?,
      etag = NULL,
      source = 'bundled',
      catalog_updated_at = ?,
      last_synced_at = NULL,
      last_sync_error_code = NULL
     WHERE singleton_id = 1`,
    seed.state.localSchemaVersion,
    seed.state.catalogSchemaVersion,
    seed.state.catalogRevision,
    seed.state.catalogUpdatedAt,
  );
}

async function executeRows<Row>(
  statement: SQLiteStatement,
  rows: Row[],
  parameters: (row: Row) => SQLiteBindParams,
) {
  for (const row of rows) await statement.executeAsync(parameters(row));
}

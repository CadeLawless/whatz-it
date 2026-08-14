import type { SQLiteDatabase } from 'expo-sqlite';

export const CATALOG_DATABASE_NAME = 'whatz-it-catalog.db';
export const CATALOG_DATABASE_VERSION = 3;

const CREATE_SCHEMA_SQL = `
CREATE TABLE catalog_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  local_schema_version INTEGER NOT NULL,
  catalog_schema_version INTEGER NOT NULL,
  catalog_revision INTEGER NOT NULL,
  etag TEXT,
  source TEXT NOT NULL CHECK (source IN ('bundled', 'remote')),
  catalog_updated_at TEXT NOT NULL,
  last_synced_at TEXT,
  last_sync_error_code TEXT
);

CREATE TABLE decks (
  deck_id TEXT PRIMARY KEY NOT NULL,
  deck_version INTEGER NOT NULL,
  card_content_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('free', 'paid')),
  price_minor_units INTEGER,
  tags_json TEXT NOT NULL,
  card_count INTEGER NOT NULL,
  content_hash TEXT,
  content_bytes INTEGER,
  content_url TEXT,
  cover_path TEXT,
  cover_hash TEXT,
  cover_bytes INTEGER,
  cover_url TEXT,
  thumbnail_hash TEXT,
  thumbnail_bytes INTEGER,
  thumbnail_url TEXT,
  apple_product_id TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired'))
);

CREATE TABLE bundles (
  bundle_id TEXT PRIMARY KEY NOT NULL,
  bundle_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('free', 'paid')),
  price_minor_units INTEGER,
  sort_order INTEGER NOT NULL,
  apple_product_id TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired'))
);

CREATE TABLE bundle_decks (
  bundle_id TEXT NOT NULL REFERENCES bundles(bundle_id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL REFERENCES decks(deck_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (bundle_id, deck_id),
  UNIQUE (bundle_id, position)
);

CREATE TABLE deck_orders (
  scope TEXT NOT NULL CHECK (scope IN ('free', 'paid')),
  deck_id TEXT NOT NULL REFERENCES decks(deck_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (scope, deck_id),
  UNIQUE (scope, position)
);

CREATE TABLE cards (
  deck_id TEXT NOT NULL REFERENCES decks(deck_id) ON DELETE CASCADE,
  card_content_version INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  byline TEXT,
  PRIMARY KEY (deck_id, card_content_version, card_id),
  UNIQUE (deck_id, card_content_version, position)
);

CREATE TABLE deck_installations (
  deck_id TEXT PRIMARY KEY NOT NULL REFERENCES decks(deck_id) ON DELETE CASCADE,
  ownership_source TEXT NOT NULL CHECK (ownership_source IN ('free', 'none')),
  desired_content_version INTEGER NOT NULL,
  installed_content_version INTEGER,
  status TEXT NOT NULL CHECK (status IN ('installed', 'not_owned', 'pending', 'failed')),
  last_verified_at TEXT,
  last_error_code TEXT
);

CREATE TABLE media_files (
  content_hash TEXT PRIMARY KEY NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('thumbnail', 'cover')),
  remote_url TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  local_uri TEXT,
  status TEXT NOT NULL CHECK (status IN ('missing', 'ready', 'failed')),
  last_verified_at TEXT
);

CREATE TABLE commerce_entitlements (
  product_id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('deck', 'bundle')),
  target_id TEXT NOT NULL,
  verified_at TEXT NOT NULL
);

CREATE TABLE commerce_state (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  last_synced_at TEXT,
  last_error_code TEXT
);

CREATE INDEX idx_decks_access_title ON decks(access, title, deck_id);
CREATE INDEX idx_cards_deck_position ON cards(deck_id, card_content_version, position);
CREATE INDEX idx_bundle_decks_deck ON bundle_decks(deck_id, bundle_id);
`;

export async function migrateCatalogDatabase(database: SQLiteDatabase) {
  await database.execAsync('PRAGMA journal_mode = WAL');
  await database.execAsync('PRAGMA foreign_keys = ON');
  const row = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const currentVersion = row?.user_version ?? 0;
  if (currentVersion > CATALOG_DATABASE_VERSION) {
    throw new Error(
      `Catalog database version ${currentVersion} is newer than supported version ${CATALOG_DATABASE_VERSION}.`,
    );
  }
  if (currentVersion === 0) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const transactionVersion = await transaction.getFirstAsync<{
        user_version: number;
      }>('PRAGMA user_version');
      if ((transactionVersion?.user_version ?? 0) !== 0) return;
      await transaction.execAsync(CREATE_SCHEMA_SQL);
      await transaction.execAsync(`PRAGMA user_version = ${CATALOG_DATABASE_VERSION}`);
    });
  }
  if (currentVersion === 1) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ALTER TABLE decks ADD COLUMN content_hash TEXT;
        ALTER TABLE decks ADD COLUMN content_bytes INTEGER;
        ALTER TABLE decks ADD COLUMN content_url TEXT;
        ALTER TABLE decks ADD COLUMN cover_bytes INTEGER;
        ALTER TABLE decks ADD COLUMN cover_url TEXT;
        ALTER TABLE decks ADD COLUMN thumbnail_bytes INTEGER;
        ALTER TABLE decks ADD COLUMN thumbnail_url TEXT;
        PRAGMA user_version = 2;
      `);
    });
  }
  if (currentVersion <= 2 && currentVersion !== 0) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
        ALTER TABLE decks ADD COLUMN apple_product_id TEXT;
        ALTER TABLE bundles ADD COLUMN apple_product_id TEXT;
        CREATE TABLE commerce_entitlements (
          product_id TEXT PRIMARY KEY NOT NULL,
          target_type TEXT NOT NULL CHECK (target_type IN ('deck', 'bundle')),
          target_id TEXT NOT NULL,
          verified_at TEXT NOT NULL
        );
        CREATE TABLE commerce_state (
          singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
          last_synced_at TEXT,
          last_error_code TEXT
        );
        PRAGMA user_version = 3;
      `);
    });
  }
}

export const catalogSchemaSqlForTests = CREATE_SCHEMA_SQL;

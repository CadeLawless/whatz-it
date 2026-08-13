import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { applyBundledCatalogBaseline } from './catalog-database';
import { type CatalogSeedSource } from './catalog-seed';
import { catalogSchemaSqlForTests } from './catalog-schema';
import {
  applyPreparedCatalog,
  CatalogSyncError,
  downloadVerified,
} from './catalog-sync';
import type { CatalogManifest, DeckContentArtifact } from './catalog-wire';

const source = readFileSync(
  fileURLToPath(new URL('../data/bundles.ts', import.meta.url)),
  'utf8',
);
const managedCatalog = source.match(
  /\/\* DECK_MANAGER_CATALOG_START \*\/\s*([\s\S]*?)\s*\/\* DECK_MANAGER_CATALOG_END \*\//,
)?.[1];
if (!managedCatalog) throw new Error('Managed bundled catalog was not found.');
const bundledCatalog = JSON.parse(managedCatalog) as CatalogSeedSource;
const synchronizedRevision = bundledCatalog.revision + 1;

describe('catalog artifact verification', () => {
  const bytes = new TextEncoder().encode('verified catalog artifact');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const runtime = {
    request: async () => new Response(bytes, { status: 200 }),
    digestSha256: async (input: Uint8Array) =>
      createHash('sha256').update(input).digest('hex'),
  };

  it('returns an artifact only after its size and SHA-256 match', async () => {
    assert.deepEqual(
      await downloadVerified('https://example.test/artifact', bytes.length, hash, undefined, runtime),
      bytes,
    );
  });

  it('rejects truncated and corrupt artifacts before activation', async () => {
    await assert.rejects(
      () =>
        downloadVerified(
          'https://example.test/artifact',
          bytes.length + 1,
          hash,
          undefined,
          runtime,
        ),
      (error) => error instanceof CatalogSyncError && error.code === 'invalid_artifact',
    );
    await assert.rejects(
      () =>
        downloadVerified(
          'https://example.test/artifact',
          bytes.length,
          'f'.repeat(64),
          undefined,
          runtime,
        ),
      (error) => error instanceof CatalogSyncError && error.code === 'invalid_artifact',
    );
  });

  it('normalizes request failures without exposing native errors', async () => {
    await assert.rejects(
      () =>
        downloadVerified(
          'https://example.test/artifact',
          bytes.length,
          hash,
          undefined,
          { request: async () => { throw new Error('socket details'); } },
        ),
      (error) => error instanceof CatalogSyncError && error.code === 'network_error',
    );
  });
});

describe('catalog synchronization activation', () => {
  it('commits metadata, cards, media, and revision together', async () => {
    const harness = createDatabaseHarness();
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      const { artifacts, manifest, media } = updateFixture();
      await applyPreparedCatalog(
        harness.adapter,
        manifest,
        artifacts,
        media,
        `revision-${synchronizedRevision}`,
        '2026-08-13T13:00:00Z',
      );

      assert.equal(stateRevision(harness.database), synchronizedRevision);
      assert.deepEqual(
        plainRow(
          harness.database
            .prepare(
              `SELECT title, deck_version, card_content_version
                 FROM decks WHERE deck_id = 'celebrity-shuffle'`,
            )
            .get(),
        ),
        {
          title: 'Synchronized title',
          deck_version: 8,
          card_content_version: 2,
        },
      );
      assert.equal(
        harness.database
          .prepare(
            `SELECT text FROM cards
              WHERE deck_id = 'celebrity-shuffle' AND position = 0`,
          )
          .get()?.text,
        'Synchronized card',
      );
      assert.equal(
        harness.database.prepare("SELECT COUNT(*) AS count FROM media_files WHERE status = 'ready'").get()?.count,
        2,
      );
    } finally {
      harness.database.close();
    }
  });

  it('keeps the last-known-good revision when activation fails', async () => {
    const harness = createDatabaseHarness('UPDATE catalog_state SET');
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      const { artifacts, manifest, media } = updateFixture();
      await assert.rejects(() =>
        applyPreparedCatalog(
          harness.adapter,
          manifest,
          artifacts,
          media,
          `revision-${synchronizedRevision}`,
          '2026-08-13T13:00:00Z',
        ),
      );
      assert.equal(stateRevision(harness.database), bundledCatalog.revision);
      assert.equal(
        harness.database
          .prepare("SELECT title FROM decks WHERE deck_id = 'celebrity-shuffle'")
          .get()?.title,
        bundledCatalog.decks[0].title,
      );
    } finally {
      harness.database.close();
    }
  });
});

function updateFixture() {
  const coverHash = 'a'.repeat(64);
  const thumbnailHash = 'b'.repeat(64);
  const contentHash = 'c'.repeat(64);
  const manifest: CatalogManifest = {
    schemaVersion: 1,
    catalogSchemaVersion: 5,
    catalogRevision: synchronizedRevision,
    updatedAt: '2026-08-13T13:00:00Z',
    supportedContentSchemaVersions: [1],
    decks: [
      {
        id: 'celebrity-shuffle',
        order: 1,
        title: 'Synchronized title',
        description: 'Verified before activation.',
        tags: ['sync'],
        access: 'free',
        price: null,
        status: 'active',
        deckVersion: 8,
        cardContentVersion: 2,
        cardCount: 1,
        content: {
          hash: contentHash,
          bytes: 100,
          url: 'https://example.test/content/2',
          protected: false,
        },
        cover: {
          hash: coverHash,
          bytes: 10,
          url: `https://example.test/covers/${coverHash}.webp`,
        },
        thumbnail: {
          hash: thumbnailHash,
          bytes: 5,
          url: `https://example.test/thumbnails/${thumbnailHash}.webp`,
        },
      },
    ],
    bundles: [],
    deckOrders: { free: ['celebrity-shuffle'], paid: [] },
  };
  const artifact: DeckContentArtifact = {
    schemaVersion: 1,
    deckId: 'celebrity-shuffle',
    cardContentVersion: 2,
    cards: [{ id: 'sync-card', text: 'Synchronized card' }],
  };
  return {
    manifest,
    artifacts: new Map([['celebrity-shuffle', artifact]]),
    media: new Map([
      [coverHash, { ...manifest.decks[0].cover, localUri: 'file:///cover.webp' }],
      [thumbnailHash, { ...manifest.decks[0].thumbnail, localUri: 'file:///thumbnail.webp' }],
    ]),
  };
}

function createDatabaseHarness(failSqlPrefix?: string) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(catalogSchemaSqlForTests);
  let baselineInstalled = false;

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
    getFirstAsync: async (sql, ...parameters) => database.prepare(sql).get(...parameters),
    getAllAsync: async (sql, ...parameters) => database.prepare(sql).all(...parameters),
    runAsync: async (sql, ...parameters) => {
      if (baselineInstalled && failSqlPrefix && sql.trimStart().startsWith(failSqlPrefix)) {
        throw new Error('Injected catalog activation failure.');
      }
      return database.prepare(sql).run(...parameters);
    },
    prepareAsync: async (sql) => {
      const statement = database.prepare(sql);
      return {
        executeAsync: async (parameters = []) => statement.run(...parameters),
        finalizeAsync: async () => undefined,
      };
    },
    withExclusiveTransactionAsync: async (operation) => {
      database.exec('BEGIN EXCLUSIVE');
      try {
        await operation(adapter);
        database.exec('COMMIT');
        baselineInstalled = true;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { adapter: adapter as unknown as SQLiteDatabase, database };
}

function stateRevision(database: DatabaseSync) {
  return Number(database.prepare('SELECT catalog_revision FROM catalog_state').get()?.catalog_revision);
}

function plainRow(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row));
}

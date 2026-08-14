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
import { SqliteCatalogDiscoveryRepository } from './catalog-discovery';
import {
  applyPreparedCatalog,
  CatalogSyncError,
  downloadVerified,
  synchronizeCatalog,
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

describe('Phase 3 catalog acceptance', () => {
  it('hydrates discovery media when the bundled revision already matches the server', async () => {
    const harness = createDatabaseHarness();
    const storedFiles = new Map<string, Uint8Array>();
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      const fixture = acceptanceFixture(bundledCatalog.revision);
      const runtime = acceptanceRuntime(fixture, storedFiles);
      const result = await synchronizeCatalog(harness.adapter, {
        manifestUrl: fixture.manifestUrl,
        downloadRuntime: runtime,
      });
      assert.deepEqual(result, {
        status: 'updated',
        revision: bundledCatalog.revision,
        downloadedDecks: 1,
        downloadedMedia: 4,
      });
      assert.equal(storedFiles.size, 4);
      assert.equal(
        harness.database
          .prepare(
            "SELECT apple_product_id FROM decks WHERE deck_id = 'accents-and-impressions'",
          )
          .get()?.apple_product_id,
        'com.cadelawless.whatzit.deck.accents_and_impressions',
      );
      assert.equal(
        harness.database
          .prepare("SELECT COUNT(*) AS count FROM media_files WHERE status = 'ready'")
          .get()?.count,
        4,
      );
    } finally {
      harness.database.close();
    }
  });

  it('bypasses a matching ETag to repair missing same-revision media', async () => {
    const harness = createDatabaseHarness();
    const storedFiles = new Map<string, Uint8Array>();
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      const fixture = acceptanceFixture(bundledCatalog.revision);
      await synchronizeCatalog(harness.adapter, {
        manifestUrl: fixture.manifestUrl,
        downloadRuntime: acceptanceRuntime(fixture, storedFiles),
      });

      harness.database.exec('DELETE FROM media_files');
      storedFiles.clear();
      let conditionalEtag: string | null = 'not-requested';
      let transientAttempts = 0;
      const runtime = acceptanceRuntime(fixture, storedFiles);
      const transientUrl = fixture.manifest.decks[1].cover.url;
      const result = await synchronizeCatalog(harness.adapter, {
        manifestUrl: fixture.manifestUrl,
        downloadRuntime: {
          ...runtime,
          request: async (url, init) => {
            if (url === fixture.manifestUrl) {
              conditionalEtag = new Headers(init.headers).get('if-none-match');
            }
            if (url === transientUrl && transientAttempts++ === 0) {
              return new Response('temporarily unavailable', { status: 503 });
            }
            return runtime.request(url);
          },
        },
      });

      assert.equal(conditionalEtag, null);
      assert.equal(result.status, 'updated');
      assert.equal(transientAttempts, 2);
      assert.equal(storedFiles.size, 4);
      assert.equal(
        harness.database
          .prepare("SELECT COUNT(*) AS count FROM media_files WHERE status = 'ready'")
          .get()?.count,
        4,
      );
    } finally {
      harness.database.close();
    }
  });

  it('persists a verified revision for offline restart and rejects a corrupt successor', async () => {
    const harness = createDatabaseHarness();
    const storedFiles = new Map<string, Uint8Array>();
    try {
      await applyBundledCatalogBaseline(harness.adapter, bundledCatalog);
      const fixture = acceptanceFixture(synchronizedRevision);
      const requested: string[] = [];
      const runtime = acceptanceRuntime(fixture, storedFiles, requested);

      assert.deepEqual(
        await synchronizeCatalog(harness.adapter, {
          manifestUrl: fixture.manifestUrl,
          now: () => new Date('2026-08-13T22:00:00Z'),
          downloadRuntime: runtime,
        }),
        {
          status: 'updated',
          revision: synchronizedRevision,
          downloadedDecks: 1,
          downloadedMedia: 4,
        },
      );
      assert.equal(requested.includes(fixture.paidContentUrl), false);
      assert.equal(storedFiles.size, 4);
      assert.equal(
        harness.database
          .prepare("SELECT COUNT(*) AS count FROM media_files WHERE status = 'ready'")
          .get()?.count,
        4,
      );

      // A fresh repository instance represents a process restart. It must read
      // the activated SQLite snapshot without consulting the network.
      const restartedRepository = new SqliteCatalogDiscoveryRepository(
        harness.adapter,
      );
      const restarted = await restartedRepository.queryDecks({
        search: 'acceptance',
        access: 'free',
      });
      assert.deepEqual(restarted.decks.map(({ id }) => id), ['celebrity-shuffle']);
      assert.equal(restarted.decks[0].coverUri?.startsWith('file:///'), true);
      assert.equal(restarted.decks[0].thumbnailUri?.startsWith('file:///'), true);
      assert.equal(
        harness.database
          .prepare(
            "SELECT text FROM cards WHERE deck_id = 'celebrity-shuffle' AND position = 0",
          )
          .get()?.text,
        'Acceptance card',
      );

      let conditionalEtag: string | null = null;
      await assert.rejects(
        () =>
          synchronizeCatalog(harness.adapter, {
            manifestUrl: fixture.manifestUrl,
            downloadRuntime: {
              ...runtime,
              request: async (_url, init) => {
                conditionalEtag = new Headers(init.headers).get('if-none-match');
                throw new Error('offline');
              },
            },
          }),
        (error) => error instanceof CatalogSyncError && error.code === 'network_error',
      );
      assert.equal(conditionalEtag, `"revision-${synchronizedRevision}"`);
      assert.equal(stateRevision(harness.database), synchronizedRevision);

      const corrupt = corruptSuccessor(fixture);
      await assert.rejects(
        () =>
          synchronizeCatalog(harness.adapter, {
            manifestUrl: fixture.manifestUrl,
            downloadRuntime: {
              ...runtime,
              request: async (url) =>
                url === fixture.manifestUrl
                  ? Response.json(corrupt.manifest)
                  : new Response(corrupt.bytes.slice().buffer as ArrayBuffer),
            },
          }),
        (error) => error instanceof CatalogSyncError && error.code === 'invalid_artifact',
      );
      assert.equal(stateRevision(harness.database), synchronizedRevision);
      assert.equal(
        harness.database
          .prepare(
            "SELECT text FROM cards WHERE deck_id = 'celebrity-shuffle' AND position = 0",
          )
          .get()?.text,
        'Acceptance card',
      );
      assert.equal(storedFiles.size, 4);
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
        productIds: { apple: null, google: null },
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

function acceptanceFixture(revision: number) {
  const manifestUrl = 'https://example.test/api/v1/catalog/manifest';
  const freeContentUrl = 'https://example.test/content/free.json';
  const paidContentUrl = 'https://example.test/content/paid.json';
  const artifact: DeckContentArtifact = {
    schemaVersion: 1,
    deckId: 'celebrity-shuffle',
    cardContentVersion: 2,
    cards: [{ id: 'acceptance-card', text: 'Acceptance card' }],
  };
  const freeContent = new TextEncoder().encode(JSON.stringify(artifact));
  const media = {
    freeCover: new Uint8Array([1, 2, 3, 4]),
    freeThumbnail: new Uint8Array([5, 6]),
    paidCover: new Uint8Array([7, 8, 9]),
    paidThumbnail: new Uint8Array([10]),
  };
  const reference = (bytes: Uint8Array, name: string) => ({
    hash: sha256(bytes),
    bytes: bytes.byteLength,
    url: `https://example.test/content/${name}.webp`,
  });
  const manifest: CatalogManifest = {
    schemaVersion: 1,
    catalogSchemaVersion: 5,
    catalogRevision: revision,
    updatedAt: '2026-08-13T22:00:00Z',
    supportedContentSchemaVersions: [1],
    decks: [
      {
        id: 'celebrity-shuffle',
        order: 1,
        title: 'Acceptance Update',
        description: 'Acceptance metadata persists offline.',
        tags: ['acceptance'],
        access: 'free',
        price: null,
        status: 'active',
        deckVersion: 8,
        cardContentVersion: 2,
        cardCount: 1,
        content: {
          hash: sha256(freeContent),
          bytes: freeContent.byteLength,
          url: freeContentUrl,
          protected: false,
        },
        cover: reference(media.freeCover, 'free-cover'),
        thumbnail: reference(media.freeThumbnail, 'free-thumbnail'),
        productIds: { apple: null, google: null },
      },
      {
        id: 'accents-and-impressions',
        order: 1,
        title: 'Paid Acceptance Deck',
        description: 'Protected cards are not requested.',
        tags: ['acceptance', 'paid'],
        access: 'paid',
        price: 1.99,
        status: 'active',
        deckVersion: 2,
        cardContentVersion: 1,
        cardCount: 86,
        content: {
          hash: 'f'.repeat(64),
          bytes: 100,
          url: null,
          protected: true,
        },
        cover: reference(media.paidCover, 'paid-cover'),
        thumbnail: reference(media.paidThumbnail, 'paid-thumbnail'),
        productIds: {
          apple: 'com.cadelawless.whatzit.deck.accents_and_impressions',
          google: null,
        },
      },
    ],
    bundles: [],
    deckOrders: {
      free: ['celebrity-shuffle'],
      paid: ['accents-and-impressions'],
    },
  };
  return {
    manifestUrl,
    paidContentUrl,
    manifest,
    artifacts: new Map<string, Uint8Array>([
      [freeContentUrl, freeContent],
      [manifest.decks[0].cover.url, media.freeCover],
      [manifest.decks[0].thumbnail.url, media.freeThumbnail],
      [manifest.decks[1].cover.url, media.paidCover],
      [manifest.decks[1].thumbnail.url, media.paidThumbnail],
    ]),
  };
}

function acceptanceRuntime(
  fixture: ReturnType<typeof acceptanceFixture>,
  storedFiles: Map<string, Uint8Array>,
  requested: string[] = [],
) {
  return {
    request: async (url: string) => {
      requested.push(url);
      if (url === fixture.manifestUrl) {
        return Response.json(fixture.manifest, {
          headers: { ETag: `"revision-${fixture.manifest.catalogRevision}"` },
        });
      }
      const bytes = fixture.artifacts.get(url);
      return bytes
        ? new Response(bytes.slice().buffer as ArrayBuffer)
        : new Response('missing', { status: 404 });
    },
    digestSha256: async (bytes: Uint8Array) => sha256(bytes),
    inspectLocalFile: async (uri: string) => ({
      exists: storedFiles.has(uri),
      size: storedFiles.get(uri)?.byteLength ?? 0,
    }),
    storeDownloadedMedia: async (
      references: CatalogManifest['decks'][number]['cover'][],
      downloads: Map<string, Uint8Array>,
    ) =>
      references.flatMap((reference) => {
        const bytes = downloads.get(reference.hash);
        if (!bytes) return [];
        const localUri = `file:///catalog-media/${reference.hash}.webp`;
        storedFiles.set(localUri, bytes);
        return [{ ...reference, localUri }];
      }),
  };
}

function corruptSuccessor(fixture: ReturnType<typeof acceptanceFixture>) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      deckId: 'celebrity-shuffle',
      cardContentVersion: 3,
      cards: [{ id: 'corrupt-card', text: 'Must never activate' }],
    }),
  );
  const manifest = structuredClone(fixture.manifest);
  manifest.catalogRevision += 1;
  manifest.updatedAt = '2026-08-13T22:05:00Z';
  manifest.decks[0].deckVersion += 1;
  manifest.decks[0].cardContentVersion += 1;
  manifest.decks[0].content.hash = '0'.repeat(64);
  manifest.decks[0].content.bytes = bytes.byteLength;
  return { manifest, bytes };
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
    getAllAsync: async (sql, ...parameters) => {
      const values =
        parameters.length === 1 && Array.isArray(parameters[0])
          ? (parameters[0] as unknown as SQLInputValue[])
          : parameters;
      return database.prepare(sql).all(...values);
    },
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

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

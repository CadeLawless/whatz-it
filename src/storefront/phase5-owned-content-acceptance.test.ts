import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, it } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { catalogSchemaSqlForTests } from '@/catalog/catalog-schema';

import type { CommerceEntitlements } from './commerce-api';
import { entitledCommerceState } from './commerce-state';
import { installEntitledDeck } from './entitled-deck-installer';
import {
  EntitledDeckPreparationError,
  EntitledDeckPreparationQueue,
} from './entitled-deck-preparation';

describe('Phase 5 owned-content acceptance', () => {
  it('resumes only the failed bundle member after an interrupted preparation and restart', async () => {
    const harness = createBundleHarness(['deck-a', 'deck-b', 'deck-c']);
    const requests = new Map<string, number>();
    let failDeckB = true;
    let refreshes = 0;
    const prepareQueue = () => new EntitledDeckPreparationQueue(
      async (deckId: string) => installEntitledDeck(
        harness.adapter,
        'https://example.test',
        identity,
        deckId,
        'bundle',
        {
          request: async () => {
            requests.set(deckId, (requests.get(deckId) ?? 0) + 1);
            if (deckId === 'deck-b' && failDeckB) {
              return new Response('offline', { status: 503 });
            }
            const artifact = harness.artifacts.get(deckId);
            if (!artifact) {
              throw new Error(`Missing fixture artifact for ${deckId}.`);
            }
            return new Response(artifact.buffer.slice(
              artifact.byteOffset,
              artifact.byteOffset + artifact.byteLength,
            ) as ArrayBuffer);
          },
          digestSha256: async () => 'a'.repeat(64),
        },
      ),
      async () => {
        refreshes += 1;
      },
    );

    try {
      await assert.rejects(
        prepareQueue().prepare(
          identity.installationId,
          entitlements,
          undefined,
        ),
        (error: unknown) => {
          assert.ok(error instanceof EntitledDeckPreparationError);
          assert.deepEqual(error.failures.map((failure) => failure.deckId), ['deck-b']);
          return true;
        },
      );

      assert.deepEqual(installationStatuses(harness.database), [
        { deck_id: 'deck-a', status: 'installed' },
        { deck_id: 'deck-b', status: 'failed' },
        { deck_id: 'deck-c', status: 'installed' },
      ]);
      assert.deepEqual(
        entitledCommerceState('purchase', ['installed', 'failed', 'installed']),
        { status: 'retry' },
      );

      failDeckB = false;
      await prepareQueue().prepare(
        identity.installationId,
        entitlements,
        undefined,
      );

      assert.deepEqual(installationStatuses(harness.database), [
        { deck_id: 'deck-a', status: 'installed' },
        { deck_id: 'deck-b', status: 'installed' },
        { deck_id: 'deck-c', status: 'installed' },
      ]);
      assert.deepEqual(
        entitledCommerceState('purchase', ['installed', 'installed', 'installed']),
        { status: 'owned', source: 'purchase' },
      );
      assert.deepEqual(Object.fromEntries(requests), {
        'deck-a': 1,
        'deck-b': 2,
        'deck-c': 1,
      });
      assert.equal(refreshes, 2);
    } finally {
      harness.database.close();
    }
  });
});

const identity = {
  version: 1 as const,
  installationId: '00000000-0000-4000-8000-000000000001',
  appAccountToken: '00000000-0000-4000-8000-000000000002',
  credential: 'test-credential',
};

const entitlements: CommerceEntitlements = {
  installationId: identity.installationId,
  products: [{ productId: 'bundle-product', kind: 'bundle', targetId: 'bundle-a' }],
  deckIds: ['deck-a', 'deck-b', 'deck-c'],
  verifiedAt: '2026-08-25T12:00:00Z',
};

function createBundleHarness(deckIds: string[]) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(catalogSchemaSqlForTests);
  const artifacts = new Map<string, Uint8Array>();
  for (const deckId of deckIds) {
    const artifact = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      deckId,
      cardContentVersion: 1,
      cards: [{ id: `${deckId}-card`, text: `${deckId} verified card` }],
    }));
    artifacts.set(deckId, artifact);
    database.prepare(
      `INSERT INTO decks (
        deck_id, deck_version, card_content_version, title, description,
        access, tags_json, card_count, content_hash, content_bytes,
        lifecycle_status
      ) VALUES (?, 1, 1, ?, 'Fixture', 'paid', '[]', 1, ?, ?, 'active')`,
    ).run(deckId, deckId, 'a'.repeat(64), artifact.byteLength);
    database.prepare(
      `INSERT INTO deck_installations (
        deck_id, ownership_source, desired_content_version,
        installed_content_version, status
      ) VALUES (?, 'none', 1, NULL, 'not_owned')`,
    ).run(deckId);
  }

  type Adapter = {
    getFirstAsync: (sql: string, ...parameters: SQLInputValue[]) => Promise<unknown>;
    runAsync: (sql: string, ...parameters: SQLInputValue[]) => Promise<unknown>;
    withExclusiveTransactionAsync: (
      operation: (transaction: Adapter) => Promise<void>,
    ) => Promise<void>;
  };
  const adapter: Adapter = {
    getFirstAsync: async (sql, ...parameters) => database.prepare(sql).get(...parameters),
    runAsync: async (sql, ...parameters) => database.prepare(sql).run(...parameters),
    withExclusiveTransactionAsync: async (operation) => {
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
  return {
    adapter: adapter as unknown as SQLiteDatabase,
    artifacts,
    database,
  };
}

function installationStatuses(database: DatabaseSync) {
  return database.prepare(
    'SELECT deck_id, status FROM deck_installations ORDER BY deck_id',
  ).all().map((row) => Object.fromEntries(Object.entries(row)));
}

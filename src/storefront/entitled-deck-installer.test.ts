import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, it } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { catalogSchemaSqlForTests } from '@/catalog/catalog-schema';

import { installEntitledDeck } from './entitled-deck-installer';

describe('owned deck installation recovery', () => {
  it('commits verified cards once and makes repeated preparation idempotent', async () => {
    const artifact = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      deckId: 'paid-deck',
      cardContentVersion: 2,
      cards: [{ id: 'card-2', text: 'Verified paid card' }],
    }));
    const harness = createHarness(null, artifact.byteLength);
    let requests = 0;
    const availableDownload = {
      request: async () => {
        requests += 1;
        return new Response(artifact);
      },
      digestSha256: async () => 'a'.repeat(64),
    };
    try {
      await installEntitledDeck(
        harness.adapter,
        'https://example.test',
        identity,
        'paid-deck',
        'bundle',
        availableDownload,
      );
      await installEntitledDeck(
        harness.adapter,
        'https://example.test',
        identity,
        'paid-deck',
        'bundle',
        availableDownload,
      );

      assert.deepEqual(installation(harness.database), {
        installed_content_version: 2,
        status: 'installed',
        last_error_code: null,
      });
      assert.equal(
        harness.database.prepare(
          "SELECT text FROM cards WHERE deck_id = 'paid-deck' AND card_content_version = 2",
        ).get()?.text,
        'Verified paid card',
      );
      assert.equal(requests, 1);
    } finally {
      harness.database.close();
    }
  });

  it('keeps the previous content playable when an update download fails', async () => {
    const harness = createHarness(1);
    try {
      await assert.rejects(() => installEntitledDeck(
        harness.adapter,
        'https://example.test',
        identity,
        'paid-deck',
        'purchase',
        unavailableDownload,
      ));
      assert.deepEqual(installation(harness.database), {
        installed_content_version: 1,
        status: 'installed',
        last_error_code: 'preparation_failed',
      });
      assert.equal(
        harness.database.prepare(
          "SELECT text FROM cards WHERE deck_id = 'paid-deck' AND card_content_version = 1",
        ).get()?.text,
        'Last known good card',
      );
    } finally {
      harness.database.close();
    }
  });

  it('rolls back a failed SQLite commit without deleting last-known-good cards', async () => {
    const artifact = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      deckId: 'paid-deck',
      cardContentVersion: 2,
      cards: [{ id: 'card-2', text: 'Replacement card' }],
    }));
    const harness = createHarness(1, artifact.byteLength, true);
    try {
      await assert.rejects(() => installEntitledDeck(
        harness.adapter,
        'https://example.test',
        identity,
        'paid-deck',
        'purchase',
        {
          request: async () => new Response(artifact),
          digestSha256: async () => 'a'.repeat(64),
        },
      ));
      assert.deepEqual(installation(harness.database), {
        installed_content_version: 1,
        status: 'installed',
        last_error_code: 'preparation_failed',
      });
      assert.equal(
        harness.database.prepare(
          "SELECT text FROM cards WHERE deck_id = 'paid-deck' AND card_content_version = 1",
        ).get()?.text,
        'Last known good card',
      );
      assert.equal(
        harness.database.prepare(
          "SELECT COUNT(*) AS count FROM cards WHERE deck_id = 'paid-deck' AND card_content_version = 2",
        ).get()?.count,
        0,
      );
    } finally {
      harness.database.close();
    }
  });

  it('marks a first installation failed when no playable version exists', async () => {
    const harness = createHarness(null);
    try {
      await assert.rejects(() => installEntitledDeck(
        harness.adapter,
        'https://example.test',
        identity,
        'paid-deck',
        'purchase',
        unavailableDownload,
      ));
      assert.deepEqual(installation(harness.database), {
        installed_content_version: null,
        status: 'failed',
        last_error_code: 'preparation_failed',
      });
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

const unavailableDownload = {
  request: async () => new Response('offline', { status: 503 }),
};

function createHarness(
  installedContentVersion: number | null,
  contentBytes = 100,
  failCardInsert = false,
) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(catalogSchemaSqlForTests);
  database.prepare(
    `INSERT INTO decks (
      deck_id, deck_version, card_content_version, title, description,
      access, tags_json, card_count, content_hash, content_bytes,
      lifecycle_status
    ) VALUES ('paid-deck', 2, 2, 'Paid Deck', 'Fixture', 'paid', '[]', 1,
      ?, ?, 'active')`,
  ).run('a'.repeat(64), contentBytes);
  database.prepare(
    `INSERT INTO deck_installations (
      deck_id, ownership_source, desired_content_version,
      installed_content_version, status
    ) VALUES ('paid-deck', 'purchase', 2, ?, ?)`,
  ).run(
    installedContentVersion,
    installedContentVersion === null ? 'not_owned' : 'installed',
  );
  if (installedContentVersion !== null) {
    database.prepare(
      `INSERT INTO cards (
        deck_id, card_content_version, card_id, position, text
      ) VALUES ('paid-deck', 1, 'card-1', 0, 'Last known good card')`,
    ).run();
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
        const transactionAdapter = failCardInsert
          ? {
              ...adapter,
              runAsync: async (sql: string, ...parameters: SQLInputValue[]) => {
                if (/INSERT INTO cards/i.test(sql)) {
                  throw new Error('simulated SQLite write interruption');
                }
                return database.prepare(sql).run(...parameters);
              },
            }
          : adapter;
        await operation(transactionAdapter);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { adapter: adapter as unknown as SQLiteDatabase, database };
}

function installation(database: DatabaseSync) {
  const row = database.prepare(
    `SELECT installed_content_version, status, last_error_code
       FROM deck_installations WHERE deck_id = 'paid-deck'`,
  ).get();
  return row ? Object.fromEntries(Object.entries(row)) : null;
}

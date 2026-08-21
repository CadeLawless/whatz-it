import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { catalogSchemaSqlForTests } from '@/catalog/catalog-schema';

import { resetLocalPaidOwnership } from './commerce-testing';

describe('staging commerce testing', () => {
  it('removes only paid content and local ownership state', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec(catalogSchemaSqlForTests);
      database.exec(`
        INSERT INTO decks (
          deck_id, deck_version, card_content_version, title, description,
          access, tags_json, card_count
        ) VALUES
          ('free-deck', 1, 1, 'Free', 'Free', 'free', '[]', 1),
          ('paid-deck', 1, 1, 'Paid', 'Paid', 'paid', '[]', 1);
        INSERT INTO cards (deck_id, card_content_version, card_id, position, text)
        VALUES
          ('free-deck', 1, 'free-card', 0, 'Free card'),
          ('paid-deck', 1, 'paid-card', 0, 'Paid card');
        INSERT INTO deck_installations (
          deck_id, ownership_source, desired_content_version,
          installed_content_version, status
        ) VALUES
          ('free-deck', 'free', 1, 1, 'installed'),
          ('paid-deck', 'purchase', 1, 1, 'installed');
        INSERT INTO commerce_entitlements (
          product_id, target_type, target_id, verified_at
        ) VALUES ('paid-product', 'deck', 'paid-deck', '2026-08-20T00:00:00Z');
        INSERT INTO commerce_state (singleton_id, last_synced_at)
        VALUES (1, '2026-08-20T00:00:00Z');
      `);

      const adapter = {
        withExclusiveTransactionAsync: async (
          operation: (transaction: { execAsync: (sql: string) => Promise<void> }) => Promise<void>,
        ) => operation({ execAsync: async (sql: string) => database.exec(sql) }),
      };
      await resetLocalPaidOwnership(
        adapter as unknown as Parameters<typeof resetLocalPaidOwnership>[0],
      );

      assert.deepEqual(
        database.prepare('SELECT deck_id FROM cards ORDER BY deck_id').all().map((row) => ({ ...row })),
        [{ deck_id: 'free-deck' }],
      );
      assert.deepEqual(
        { ...database.prepare(`
          SELECT ownership_source, installed_content_version, status
          FROM deck_installations WHERE deck_id = 'paid-deck'
        `).get() },
        {
          ownership_source: 'none',
          installed_content_version: null,
          status: 'not_owned',
        },
      );
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM commerce_entitlements').get()?.count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM commerce_state').get()?.count, 0);
    } finally {
      database.close();
    }
  });
});

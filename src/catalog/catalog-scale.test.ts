import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { INSTALLED_CARD_ROWS_SQL } from './catalog-queries';
import { catalogSchemaSqlForTests } from './catalog-schema';

const DECK_COUNT = 1_000;
const LARGE_BUNDLE_SIZE = 500;
const INSTALLED_DECK_INTERVAL = 5;
const CARDS_PER_INSTALLED_DECK = 120;

describe('Phase 6 catalog scale acceptance', () => {
  it('queries 1,000 decks, realistic installed cards, and a 500-deck bundle', () => {
    const database = createLargeCatalog();
    try {
      const deckCount = database.prepare(
        "SELECT COUNT(*) AS count FROM decks WHERE lifecycle_status = 'active'",
      ).get()?.count;
      const cards = database.prepare(INSTALLED_CARD_ROWS_SQL).all();
      const bundleMembers = database.prepare(
        `SELECT deck_id FROM bundle_decks
          WHERE bundle_id = 'large-bundle'
          ORDER BY position`,
      ).all();
      const cardQueryPlan = database.prepare(
        `EXPLAIN QUERY PLAN ${INSTALLED_CARD_ROWS_SQL}`,
      ).all();

      assert.equal(deckCount, DECK_COUNT);
      assert.equal(bundleMembers.length, LARGE_BUNDLE_SIZE);
      assert.equal(cards.length, (DECK_COUNT / INSTALLED_DECK_INTERVAL) * CARDS_PER_INSTALLED_DECK);
      assert.equal(cards.filter((card) => card.deck_id === 'deck-0000').length, CARDS_PER_INSTALLED_DECK);
      assert.equal(cards.some((card) => card.deck_id === 'deck-0001'), false);
      assert.equal(
        cards.some((card) => card.text === 'retained historical card'),
        false,
      );
      assert.equal(
        cardQueryPlan.some((step) =>
          String(step.detail).includes('idx_cards_deck_position')),
        true,
      );
    } finally {
      database.close();
    }
  });
});

function createLargeCatalog() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(catalogSchemaSqlForTests);
  database.exec('BEGIN');
  try {
    database.prepare(
      `INSERT INTO catalog_state (
        singleton_id, local_schema_version, catalog_schema_version,
        catalog_revision, source, catalog_updated_at
      ) VALUES (1, 4, 1, 1, 'bundled', '2026-08-25T12:00:00Z')`,
    ).run();
    const insertDeck = database.prepare(
      `INSERT INTO decks (
        deck_id, deck_version, card_content_version, title, description,
        access, tags_json, card_count, lifecycle_status
      ) VALUES (?, 1, 2, ?, 'Scale fixture', ?, '["scale"]', ?, 'active')`,
    );
    const insertInstallation = database.prepare(
      `INSERT INTO deck_installations (
        deck_id, ownership_source, desired_content_version,
        installed_content_version, status
      ) VALUES (?, ?, 2, ?, ?)`,
    );
    const insertOrder = database.prepare(
      'INSERT INTO deck_orders (scope, deck_id, position) VALUES (?, ?, ?)',
    );
    const insertCard = database.prepare(
      `INSERT INTO cards (
        deck_id, card_content_version, card_id, position, text
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    let freePosition = 0;
    let paidPosition = 0;
    for (let index = 0; index < DECK_COUNT; index += 1) {
      const deckId = `deck-${index.toString().padStart(4, '0')}`;
      const installed = index % INSTALLED_DECK_INTERVAL === 0;
      const access = installed ? 'free' : 'paid';
      insertDeck.run(
        deckId,
        `Scale Deck ${index.toString().padStart(4, '0')}`,
        access,
        CARDS_PER_INSTALLED_DECK,
      );
      insertInstallation.run(
        deckId,
        installed ? 'free' : 'none',
        installed ? 2 : null,
        installed ? 'installed' : 'not_owned',
      );
      insertOrder.run(
        access,
        deckId,
        access === 'free' ? freePosition++ : paidPosition++,
      );
      if (!installed) continue;
      insertCard.run(deckId, 1, `${deckId}-historical`, 0, 'retained historical card');
      for (let position = 0; position < CARDS_PER_INSTALLED_DECK; position += 1) {
        insertCard.run(
          deckId,
          2,
          `${deckId}-card-${position}`,
          position,
          `Playable scale card ${position}`,
        );
      }
    }

    database.prepare(
      `INSERT INTO bundles (
        bundle_id, bundle_version, title, description, access, sort_order,
        lifecycle_status
      ) VALUES ('large-bundle', 1, 'Large Bundle', 'Scale fixture', 'paid', 0, 'active')`,
    ).run();
    const insertMember = database.prepare(
      'INSERT INTO bundle_decks (bundle_id, deck_id, position) VALUES (?, ?, ?)',
    );
    for (let index = 0; index < LARGE_BUNDLE_SIZE; index += 1) {
      insertMember.run(
        'large-bundle',
        `deck-${index.toString().padStart(4, '0')}`,
        index,
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return database;
}

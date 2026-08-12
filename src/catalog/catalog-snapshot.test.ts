import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCatalogSnapshot, type CatalogDeck } from './catalog-snapshot';

const freeDeck: CatalogDeck = {
  id: 'free-one',
  order: 1,
  title: 'Free One',
  description: 'Starter deck',
  version: 2,
  access: 'free',
  cards: [{ id: 'free-card', text: 'Free card' }],
  tags: ['starter'],
  cardCount: 1,
  cardContentVersion: 2,
  installationStatus: 'installed',
};
const paidDeck: CatalogDeck = {
  id: 'paid-one',
  order: 1,
  title: 'Paid One',
  description: 'Discoverable deck',
  version: 1,
  access: 'paid',
  cards: [],
  tags: [],
  cardCount: 100,
  cardContentVersion: 1,
  installationStatus: 'not_owned',
};

describe('catalog snapshot', () => {
  it('provides synchronous indexed lookups after repository initialization', () => {
    const snapshot = buildCatalogSnapshot({
      schemaVersion: 5,
      revision: 38,
      source: 'sqlite',
      decks: [paidDeck, freeDeck],
      bundleRecords: [
        {
          id: 'free-bundle',
          order: 1,
          title: 'Free Bundle',
          description: 'Included decks',
          access: 'free',
          version: 2,
          deckIds: ['free-one'],
        },
      ],
      deckOrders: { free: ['free-one'], paid: ['paid-one'] },
    });

    assert.equal(snapshot.revision, 38);
    assert.equal(snapshot.source, 'sqlite');
    assert.equal(snapshot.freeDecks[0], freeDeck);
    assert.equal(snapshot.paidDecks[0], paidDeck);
    assert.equal(snapshot.getDeckById('free-one'), freeDeck);
    assert.equal(snapshot.getBundleById('free-bundle')?.decks[0], freeDeck);
    assert.deepEqual(
      snapshot.getBundlesForDeck('free-one').map((bundle) => bundle.id),
      ['free-bundle'],
    );
    assert.equal(snapshot.getDeckById(undefined), undefined);
  });

  it('rejects broken local references instead of exposing partial state', () => {
    assert.throws(
      () =>
        buildCatalogSnapshot({
          schemaVersion: 5,
          revision: 38,
          source: 'sqlite',
          decks: [freeDeck],
          bundleRecords: [],
          deckOrders: { free: ['missing'], paid: [] },
        }),
      /missing deck/,
    );
  });
});

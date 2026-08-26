import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogDeck, CatalogSnapshot } from '@/catalog/catalog-snapshot';

import { captureRoundDeck, resolveRoundDeck } from './round-deck-snapshot';

describe('active round deck snapshot', () => {
  it('keeps card text and metadata stable when the catalog changes', () => {
    const original = fixtureDeck('Original card', 1);
    const captured = captureRoundDeck(original);
    original.cards[0].text = 'Mutated source card';
    original.tags.push('new-tag');

    const updated = fixtureDeck('Published replacement', 2);
    const catalog = fixtureCatalog(updated);
    assert.equal(resolveRoundDeck(catalog, captured, original.id), captured);
    assert.equal(captured.cards[0].text, 'Original card');
    assert.deepEqual(captured.tags, ['party']);
    assert.equal(captured.cardContentVersion, 1);
  });

  it('uses the current catalog for decks outside the captured round', () => {
    const captured = captureRoundDeck(fixtureDeck('Round card', 1));
    const other = fixtureDeck('Other card', 3, 'other-deck');
    const catalog = fixtureCatalog(other);
    assert.equal(resolveRoundDeck(catalog, captured, other.id), other);
  });
});

function fixtureDeck(
  text: string,
  cardContentVersion: number,
  id = 'round-deck',
): CatalogDeck {
  return {
    id,
    order: 1,
    title: 'Round Deck',
    description: 'Snapshot fixture',
    version: cardContentVersion,
    access: 'paid',
    cards: [{ id: 'card-1', text }],
    tags: ['party'],
    cardCount: 1,
    cardContentVersion,
    installationStatus: 'installed',
    storeProducts: {
      apple: { productId: 'com.example.round', status: 'available' },
    },
  };
}

function fixtureCatalog(deck: CatalogDeck): CatalogSnapshot {
  return {
    schemaVersion: 5,
    revision: 2,
    source: 'sqlite',
    decks: [deck],
    bundles: [],
    freeDecks: [],
    paidDecks: [deck],
    getDeckById: (deckId) => (deckId === deck.id ? deck : undefined),
    getBundleById: () => undefined,
    getBundlesForDeck: () => [],
  };
}

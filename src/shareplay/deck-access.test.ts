import assert from 'node:assert/strict';
import test from 'node:test';
import { canShareDeck } from './deck-access';

test('a paid deck owner can supply an installed deck without requiring guest purchases', () => {
  const deck = { id: 'paid', access: 'paid' as const, installationStatus: 'installed' as const, cards: [{ id: 'c', text: 'Card' }] };
  assert.equal(canShareDeck(deck, new Set(['paid'])), true);
  assert.equal(canShareDeck(deck, new Set()), false);
  assert.equal(canShareDeck({ ...deck, access: 'free' }, new Set()), true);
});

test('ownership alone is not enough until playable content is installed', () => {
  const owned = new Set(['paid']);
  const deck = { id: 'paid', access: 'paid' as const, installationStatus: 'pending' as const, cards: [{ id: 'c', text: 'Card' }] };
  assert.equal(canShareDeck(deck, owned), false);
  assert.equal(canShareDeck({ ...deck, installationStatus: 'installed', cards: [] }, owned), false);
  assert.equal(canShareDeck(undefined, owned), false);
});

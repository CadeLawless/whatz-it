import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  alphabeticalStorefrontOrder,
  sortStorefrontItems,
} from './storefront-catalog-order';

describe('storefront catalog ordering', () => {
  it('keeps the requested source order within unowned and owned groups', () => {
    const items = [{ id: 'owned-first' }, { id: 'available-last' }, { id: 'available-first' }];
    const ownedIds = new Set(['owned-first']);

    assert.deepEqual(
      sortStorefrontItems(
        items,
        ['owned-first', 'available-first', 'available-last'],
        (item) => ownedIds.has(item.id),
      ).map(({ id }) => id),
      ['available-first', 'available-last', 'owned-first'],
    );
  });

  it('preserves discovery order for items missing from Deck Manager order', () => {
    const items = [{ id: 'known' }, { id: 'unknown-one' }, { id: 'unknown-two' }];

    assert.deepEqual(
      sortStorefrontItems(items, ['known'], () => false).map(({ id }) => id),
      ['known', 'unknown-one', 'unknown-two'],
    );
  });

  it('provides alphabetical order for the All Decks ownership groups', () => {
    assert.deepEqual(alphabeticalStorefrontOrder([
      { id: 'zulu', title: 'Same' },
      { id: 'alpha', title: 'Same' },
      { id: 'middle', title: 'Bravo' },
    ]), ['middle', 'alpha', 'zulu']);
  });
});

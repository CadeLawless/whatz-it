import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectBundleProduct } from './bundle-product-selection';

const bundle = {
  deckIds: ['a', 'b', 'c', 'd'],
  storeProducts: {
    apple: {
      productId: 'bundle.full',
      status: 'available' as const,
      ownedDeckCountProducts: {
        '1': { productId: 'bundle.owned_1', status: 'available' as const },
        '2': { productId: 'bundle.owned_2', status: 'draft' as const },
        '3': { productId: 'bundle.owned_3', status: 'available' as const },
      },
    },
    google: {
      productId: 'bundle_full',
      status: 'available' as const,
      ownedDeckCountProducts: {
        '1': { productId: 'bundle_owned_1', status: 'available' as const },
      },
    },
  },
};

describe('bundle product selection', () => {
  it('uses the full product when none are owned', () => {
    assert.deepEqual(selectBundleProduct(bundle, new Set(), 'apple'), {
      alreadyOwnedDeckCount: 0,
      productId: 'bundle.full',
      totalDeckCount: 4,
      usedFullPriceFallback: false,
    });
  });

  it('uses the exact available ownership tier', () => {
    assert.equal(selectBundleProduct(bundle, new Set(['a']), 'apple').productId, 'bundle.owned_1');
    assert.equal(selectBundleProduct(bundle, new Set(['a', 'b', 'c']), 'apple').productId, 'bundle.owned_3');
  });

  it('counts explicit deck entitlements regardless of which purchase granted them', () => {
    const restoredIndividualAndOtherBundleDecks = new Set(['a', 'c', 'unrelated']);
    assert.equal(
      selectBundleProduct(bundle, restoredIndividualAndOtherBundleDecks, 'apple').alreadyOwnedDeckCount,
      2,
    );
  });

  it('falls back to full price when the exact tier is absent or not available', () => {
    assert.deepEqual(selectBundleProduct(bundle, new Set(['a', 'b']), 'apple'), {
      alreadyOwnedDeckCount: 2,
      productId: 'bundle.full',
      totalDeckCount: 4,
      usedFullPriceFallback: true,
    });
  });

  it('selects platform-specific products', () => {
    assert.equal(selectBundleProduct(bundle, new Set(['a']), 'google').productId, 'bundle_owned_1');
  });

  it('returns no product when every current deck is owned', () => {
    assert.equal(selectBundleProduct(bundle, new Set(bundle.deckIds), 'apple').productId, null);
  });

  it('uses the localized price belonging to the selected checkout product', () => {
    const prices = new Map([
      ['bundle.full', '$6.99'],
      ['bundle.owned_1', '$4.99'],
    ]);
    const full = selectBundleProduct(bundle, new Set(), 'apple').productId;
    const discounted = selectBundleProduct(bundle, new Set(['a']), 'apple').productId;
    const fallback = selectBundleProduct(bundle, new Set(['a', 'b']), 'apple').productId;
    assert.equal(full && prices.get(full), '$6.99');
    assert.equal(discounted && prices.get(discounted), '$4.99');
    assert.equal(fallback && prices.get(fallback), '$6.99');
  });
});

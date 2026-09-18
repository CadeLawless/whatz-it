import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bundleOffer,
  bundlePurchaseHint,
  bundleRemainingDeckLabel,
  bundleRemainingDeckSavingsLabel,
} from './bundle-offer';

const deckIds = ['a', 'b', 'c', 'd'];
const bundle = {
  deckIds,
  decks: deckIds.map((id) => ({
    id,
    storeProducts: { apple: { productId: `deck.${id}`, status: 'available' as const } },
  })),
  storeProducts: {
    apple: {
      productId: 'bundle.full',
      status: 'available' as const,
      ownedDeckCountProducts: {
        '2': { productId: 'bundle.owned_2', status: 'available' as const },
      },
    },
  },
};
const prices = new Map<string, { currency: string; price: number }>([
  ...deckIds.map((id): [string, { currency: string; price: number }] => [
    `deck.${id}`, { currency: 'USD', price: 1.99 },
  ]),
  ['bundle.full', { currency: 'USD', price: 6.99 }],
  ['bundle.owned_2', { currency: 'USD', price: 2.99 }],
]);
const separateTotal = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
}).format(7.96);
const roundedSeparateTotal = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
}).format(7.99);
const fullBundlePrice = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
}).format(6.99);

describe('bundle offer', () => {
  it('describes the remaining decks only for a real ownership discount', () => {
    assert.equal(bundleRemainingDeckLabel(bundleOffer(bundle, new Set(), 'apple', prices)), null);
    assert.equal(
      bundleRemainingDeckLabel(bundleOffer(bundle, new Set(['a', 'b']), 'apple', prices)),
      'Buy the last 2 decks',
    );
    assert.equal(
      bundleRemainingDeckLabel({ ...bundleOffer(bundle, new Set(['a', 'b']), 'apple', prices), alreadyOwnedDeckCount: 3 }),
      'Buy the last deck',
    );
    assert.equal(bundleRemainingDeckLabel(bundleOffer(bundle, new Set(deckIds), 'apple', prices)), null);
    assert.equal(bundleRemainingDeckLabel({ ...bundleOffer(bundle, new Set(['a', 'b']), 'apple', prices), comparisonPrice: null }), null);
  });
  it('shows bundle savings copy for a new buyer with a comparison', () => {
    assert.equal(bundlePurchaseHint(bundleOffer(bundle, new Set(), 'apple', prices)), 'Save more by bundling!');
    assert.equal(bundlePurchaseHint(bundleOffer(bundle, new Set(['a', 'b']), 'apple', prices)), 'Buy the last 2 decks');
    const expensiveBundle = new Map(prices);
    expensiveBundle.set('bundle.full', { currency: 'USD', price: 9.99 });
    assert.equal(bundlePurchaseHint(bundleOffer(bundle, new Set(), 'apple', expensiveBundle)), null);
    assert.equal(bundlePurchaseHint(null), null);
  });
  it('claims savings on remaining decks only when the tier beats their separate prices', () => {
    assert.equal(bundleRemainingDeckSavingsLabel(bundleOffer(bundle, new Set(['a', 'b']), 'apple', prices)), 'Pay less for the last 2 decks!');
    assert.equal(bundleRemainingDeckSavingsLabel(bundleOffer(bundle, new Set(['a', 'b', 'c']), 'apple', prices)), null);

    const expensiveTier = new Map(prices);
    expensiveTier.set('bundle.owned_2', { currency: 'USD', price: 4.99 });
    assert.equal(bundleRemainingDeckSavingsLabel(bundleOffer(bundle, new Set(['a', 'b']), 'apple', expensiveTier)), null);

    const missingRemainingPrice = new Map(prices);
    missingRemainingPrice.delete('deck.c');
    assert.equal(bundleRemainingDeckSavingsLabel(bundleOffer(bundle, new Set(['a', 'b']), 'apple', missingRemainingPrice)), null);

    const missingTier = new Map(prices);
    missingTier.delete('bundle.owned_2');
    assert.equal(bundleRemainingDeckSavingsLabel(bundleOffer(bundle, new Set(['a', 'b']), 'apple', missingTier)), null);
  });
  it('compares the live bundle product with all individually priced decks', () => {
    assert.deepEqual(bundleOffer(bundle, new Set(), 'apple', prices), {
      alreadyOwnedDeckCount: 0,
      totalDeckCount: 4,
      comparisonPrice: roundedSeparateTotal,
      comparisonKind: 'individual-decks',
      savesVersusRemainingDecks: false,
    });
  });

  it('rounds comparisons up to .99 without a prefix and keeps exact .99 prices unchanged', () => {
    assert.notEqual(roundedSeparateTotal, separateTotal);
    assert.equal(bundleOffer(bundle, new Set(['a', 'b']), 'apple', prices).comparisonPrice, fullBundlePrice);

    const separateTotalAtSevenNinetyFive = new Map(prices);
    separateTotalAtSevenNinetyFive.set('deck.a', { currency: 'USD', price: 1.98 });
    assert.equal(
      bundleOffer(bundle, new Set(), 'apple', separateTotalAtSevenNinetyFive).comparisonPrice,
      roundedSeparateTotal,
    );

    const regularBundleAtOddCents = new Map(prices);
    regularBundleAtOddCents.set('bundle.full', { currency: 'USD', price: 6.95 });
    assert.equal(
      bundleOffer(bundle, new Set(['a', 'b']), 'apple', regularBundleAtOddCents).comparisonPrice,
      fullBundlePrice,
    );
  });

  it('compares a partial-owner discount with the regular bundle price', () => {
    assert.deepEqual(bundleOffer(bundle, new Set(['a', 'c']), 'apple', prices), {
      alreadyOwnedDeckCount: 2,
      totalDeckCount: 4,
      comparisonPrice: fullBundlePrice,
      comparisonKind: 'bundle',
      savesVersusRemainingDecks: true,
    });
  });

  it('does not cross out a lower individual total as if it were a saving', () => {
    const expensive = new Map(prices);
    expensive.set('bundle.full', { currency: 'USD', price: 12.99 });
    assert.equal(bundleOffer(bundle, new Set(), 'apple', expensive).comparisonPrice, null);
  });

  it('compares a partial-owner tier with the full bundle, not separate decks', () => {
    const expensiveTier = new Map(prices);
    expensiveTier.set('bundle.owned_2', { currency: 'USD', price: 3.99 });
    assert.equal(bundleOffer(bundle, new Set(['a', 'b']), 'apple', expensiveTier).comparisonPrice, fullBundlePrice);
  });

  it('does not show a discount when the tier is not cheaper than the regular bundle', () => {
    const expensiveTier = new Map(prices);
    expensiveTier.set('bundle.owned_2', { currency: 'USD', price: 6.99 });
    assert.equal(bundleOffer(bundle, new Set(['a', 'b']), 'apple', expensiveTier).comparisonPrice, null);
  });

  it('does not claim an ownership discount when checkout falls back to the full bundle', () => {
    const noTier = new Map(prices);
    noTier.delete('bundle.owned_2');
    const bundleWithoutTier = {
      ...bundle,
      storeProducts: {
        apple: {
          ...bundle.storeProducts.apple,
          ownedDeckCountProducts: {},
        },
      },
    };
    assert.equal(
      bundleOffer(bundleWithoutTier, new Set(['a', 'b']), 'apple', noTier).comparisonPrice,
      null,
    );
  });

  it('omits the comparison if an individual price is missing or in another currency', () => {
    const missing = new Map(prices);
    missing.delete('deck.a');
    assert.equal(bundleOffer(bundle, new Set(), 'apple', missing).comparisonPrice, null);

    const mixed = new Map(prices);
    mixed.set('deck.a', { currency: 'EUR', price: 1.99 });
    assert.equal(bundleOffer(bundle, new Set(), 'apple', mixed).comparisonPrice, null);
  });

  it('does not compare a partial-owner tier against a different-currency bundle price', () => {
    const mixed = new Map(prices);
    mixed.set('bundle.full', { currency: 'EUR', price: 6.99 });
    assert.equal(bundleOffer(bundle, new Set(['a', 'b']), 'apple', mixed).comparisonPrice, null);
  });

  it('shows the ownership count without a comparison when all decks are owned', () => {
    assert.deepEqual(bundleOffer(bundle, new Set(deckIds), 'apple', prices), {
      alreadyOwnedDeckCount: 4,
      totalDeckCount: 4,
      comparisonPrice: null,
      comparisonKind: null,
      savesVersusRemainingDecks: false,
    });
  });
});

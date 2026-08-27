import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commerceProductFingerprint,
  commerceProductIndexFromFingerprint,
} from './commerce-product-index';

describe('commerce product index', () => {
  it('stays stable when catalog installation state changes', () => {
    const before = fixtureCatalog('not_owned');
    const after = fixtureCatalog('installed');

    assert.equal(
      commerceProductFingerprint(before),
      commerceProductFingerprint(after),
    );
  });

  it('changes when the published StoreKit mapping changes', () => {
    const before = fixtureCatalog('not_owned');
    const after = fixtureCatalog('not_owned');
    after.decks[0].storeProducts!.apple!.productId = 'deck-product-2';

    assert.notEqual(
      commerceProductFingerprint(before),
      commerceProductFingerprint(after),
    );
  });

  it('reconstructs deck and bundle targets', () => {
    const fingerprint = commerceProductFingerprint(fixtureCatalog('not_owned'));
    const index = commerceProductIndexFromFingerprint(fingerprint);

    assert.deepEqual(index.get('deck-product'), { kind: 'deck', id: 'deck-a' });
    assert.deepEqual(index.get('bundle-product'), { kind: 'bundle', id: 'bundle-a' });
  });
});

function fixtureCatalog(installationStatus: 'not_owned' | 'installed') {
  const deck = {
    id: 'deck-a',
    installationStatus,
    storeProducts: { apple: { productId: 'deck-product' } },
  };
  return {
    decks: [deck],
    bundles: [
      {
        id: 'bundle-a',
        decks: [deck],
        storeProducts: { apple: { productId: 'bundle-product' } },
      },
    ],
  };
}

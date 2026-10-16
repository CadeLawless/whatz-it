import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectBundleProduct } from './bundle-product-selection';
import {
  commerceListingVisible,
  productsForCurrentCatalog,
  refreshCommerceSession,
  unownedCommerceState,
} from './commerce-availability';
import { commercePresentation } from './commerce-state';
import { commerceStateFixtures } from './commerce-state.fixtures';

const ready = {
  configured: true,
  networkOffline: false,
  serviceState: 'ready' as const,
  storeState: 'complete' as const,
};
const target = { access: 'paid' as const, id: 'fall-favorites', kind: 'deck' as const, title: 'Fall Favorites' };

describe('purchase availability', () => {
  it('hides a mapped product omitted from a successful store response without claiming offline', () => {
    const state = unownedCommerceState(ready);
    assert.deepEqual(state, { status: 'unavailable', reason: 'product_unavailable' });
    assert.equal(commerceListingVisible(state), false);
    assert.equal(commercePresentation(state, target).action, 'none');
  });

  it('separates server and store failures from a disconnected device, even with a cached price', () => {
    for (const serviceState of ['ready', 'error'] as const) {
      const state = unownedCommerceState({ ...ready, serviceState, storeState: 'error', localizedPrice: '$1.99' });
      assert.equal(state.status, 'unavailable');
      assert.equal(commerceListingVisible(state), false);
      assert.doesNotMatch(commercePresentation(state, target).copy, /internet|last seen|\$1\.99/i);
    }
    assert.deepEqual(unownedCommerceState({ ...ready, serviceState: 'error' }), {
      status: 'unavailable', reason: 'service_unavailable',
    });
    assert.deepEqual(unownedCommerceState({ ...ready, networkOffline: true }), { status: 'offline' });
  });

  it('waits for both the current store response and a working purchase service', () => {
    for (const storeState of ['waiting', 'loading'] as const) {
      const state = unownedCommerceState({ ...ready, storeState, localizedPrice: '$1.99' });
      assert.equal(state.status, 'loading');
      assert.equal(commerceListingVisible(state), false);
    }
    assert.equal(unownedCommerceState({ ...ready, serviceState: 'loading', localizedPrice: '$1.99' }).status, 'loading');
    assert.equal(unownedCommerceState({ ...ready, configured: false, localizedPrice: '$1.99' }).status, 'unavailable');
    assert.deepEqual(unownedCommerceState({ ...ready, localizedPrice: '$1.99' }), { status: 'available', localizedPrice: '$1.99' });
  });

  it('discards stale prices when a deck/product ID changes or a refresh fails', () => {
    const snapshot = { fingerprint: 'old-id', status: 'complete' as const, products: [{ id: 'old-product', displayPrice: '$1.99' }] };
    assert.deepEqual(productsForCurrentCatalog(snapshot, 'new-id'), []);
    assert.deepEqual(productsForCurrentCatalog({ ...snapshot, status: 'error' }, 'old-id'), []);
    assert.deepEqual(productsForCurrentCatalog({ ...snapshot, products: [] }, 'old-id'), []);
    assert.deepEqual(productsForCurrentCatalog(snapshot, 'old-id'), snapshot.products);
  });

  it('checks the selected bundle discount tier instead of treating its full price as proof', () => {
    const bundle = {
      deckIds: ['deck-a', 'deck-b'],
      storeProducts: { apple: { productId: 'full', status: 'available' as const,
        ownedDeckCountProducts: { '1': { productId: 'discount', status: 'available' as const } } } },
    };
    const selection = selectBundleProduct(bundle, new Set(['deck-a']), 'apple');
    const prices = new Map([['full', '$3.99']]);
    const state = unownedCommerceState({ ...ready, localizedPrice: prices.get(selection.productId!) });
    assert.equal(selection.productId, 'discount');
    assert.equal(commerceListingVisible(state), false);
  });

  it('keeps owned content and purchase recovery visible', () => {
    for (const key of ['owned', 'preparing', 'retry', 'purchasing', 'pending', 'verifying'] as const) {
      assert.equal(commerceListingVisible(commerceStateFixtures[key]), true, key);
    }
  });

  it('keeps purchases available when an old renamed entitlement cannot download', async () => {
    let serviceState: 'loading' | 'ready' = 'loading';
    const failures: unknown[] = [];
    const missingDeck = new Error('Deck fall-favorties has no published content artifact.');
    await refreshCommerceSession({
      connect: async () => ({ deckIds: ['fall-favorties'] }),
      ready: () => { serviceState = 'ready'; },
      prepare: async () => { throw missingDeck; },
      preparationFailed: (error) => { failures.push(error); },
    });
    assert.deepEqual(failures, [missingDeck]);
    assert.equal(unownedCommerceState({ ...ready, serviceState, localizedPrice: '$1.99' }).status, 'available');
  });

  it('propagates an entitlement service error without starting a download', async () => {
    let markedReady = false;
    let prepared = false;
    await assert.rejects(refreshCommerceSession({
      connect: async () => { throw new Error('HTTP 503'); },
      ready: () => { markedReady = true; },
      prepare: async () => { prepared = true; },
      preparationFailed: () => assert.fail('Not a download failure'),
    }), /HTTP 503/);
    assert.equal(markedReady, false);
    assert.equal(prepared, false);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commercePresentation,
  fallbackCommerceState,
  type CommerceTarget,
} from './commerce-state';
import { commerceStateFixtures } from './commerce-state.fixtures';

const paidDeck: CommerceTarget = {
  access: 'paid',
  id: 'test-deck',
  kind: 'deck',
  title: 'Test Deck',
};

describe('storefront commerce state', () => {
  it('provides copy and a control label for every fixture state', () => {
    assert.deepEqual(Object.keys(commerceStateFixtures), [
      'loading',
      'unavailable',
      'offline',
      'available',
      'purchasing',
      'pending',
      'verifying',
      'preparing',
      'retry',
      'owned',
    ]);

    for (const fixture of Object.values(commerceStateFixtures)) {
      const presentation = commercePresentation(fixture, paidDeck);
      assert.ok(presentation.title.length > 0);
      assert.ok(presentation.copy.length > 0);
      assert.ok(presentation.buttonLabel.length > 0);
    }
  });

  it('keeps the pre-commerce production fallback non-transactional', () => {
    const state = fallbackCommerceState(paidDeck);
    const presentation = commercePresentation(state, paidDeck);

    assert.deepEqual(state, {
      status: 'unavailable',
      reason: 'not_configured',
    });
    assert.equal(presentation.action, 'none');
    assert.equal(presentation.buttonLabel, 'COMING SOON');
  });

  it('lets users retry when the App Store product request fails', () => {
    const presentation = commercePresentation(
      { status: 'unavailable', reason: 'store_unavailable' },
      paidDeck,
    );

    assert.equal(presentation.action, 'retry');
    assert.equal(presentation.buttonLabel, 'TRY AGAIN');
    assert.equal(presentation.busy, false);
  });

  it('maps local installation state without inventing entitlements', () => {
    assert.deepEqual(
      fallbackCommerceState({
        ...paidDeck,
        installationStatus: 'pending',
      }),
      { status: 'preparing' },
    );
    assert.deepEqual(
      fallbackCommerceState({
        ...paidDeck,
        installationStatus: 'failed',
      }),
      { status: 'retry' },
    );
    assert.deepEqual(
      fallbackCommerceState({
        ...paidDeck,
        access: 'free',
        installationStatus: 'installed',
      }),
      { status: 'owned', source: 'included' },
    );
  });

  it('clamps preparation progress for stable accessible labels', () => {
    assert.equal(
      commercePresentation(
        { status: 'preparing', progress: 1.8 },
        paidDeck,
      ).buttonLabel,
      'PREPARING • 100%',
    );
  });
});

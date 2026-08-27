import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commercePresentation,
  entitledCommerceState,
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
      'waitingForStore',
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

  it('explains a delayed App Store prompt without enabling a duplicate purchase', () => {
    const presentation = commercePresentation(
      commerceStateFixtures.waitingForStore,
      paidDeck,
    );

    assert.equal(presentation.action, 'none');
    assert.equal(presentation.busy, true);
    assert.equal(presentation.buttonLabel, 'WAITING FOR APP STORE…');
    assert.match(presentation.copy, /taking longer than usual/i);
  });

  it('labels disabled commerce as unavailable without implying launch timing', () => {
    const state = fallbackCommerceState(paidDeck);
    const presentation = commercePresentation(state, paidDeck);

    assert.deepEqual(state, {
      status: 'unavailable',
      reason: 'not_configured',
    });
    assert.equal(presentation.action, 'none');
    assert.equal(presentation.buttonLabel, 'PURCHASING DISABLED');
    assert.equal(presentation.title, 'Purchasing disabled');
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

  it('lets users retry the commerce service after reconnecting', () => {
    const presentation = commercePresentation(
      { status: 'offline', lastKnownPrice: '$1.99' },
      paidDeck,
    );

    assert.equal(presentation.action, 'retry');
    assert.equal(presentation.buttonLabel, 'TRY AGAIN');
    assert.match(presentation.copy, /\$1\.99/);
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

  it('reconstructs aggregate preparation state from entitled deck installations', () => {
    assert.deepEqual(
      entitledCommerceState('purchase', ['installed', 'pending']),
      { status: 'preparing' },
    );
    assert.deepEqual(
      entitledCommerceState('purchase', ['installed', 'failed']),
      { status: 'retry' },
    );
    assert.deepEqual(
      entitledCommerceState('bundle', ['installed', 'installed']),
      { status: 'owned', source: 'bundle' },
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

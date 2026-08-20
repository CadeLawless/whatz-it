import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Purchase } from 'expo-iap';

import type { CommerceEntitlements } from './commerce-api';
import { reconcileApplePurchases } from './apple-purchase-restore';

const entitlements: CommerceEntitlements = {
  installationId: 'installation-1',
  products: [
    {
      productId: 'com.cadelawless.whatzit.deck.worship_icons',
      kind: 'deck',
      targetId: 'worship-icons',
    },
  ],
  deckIds: ['worship-icons'],
  verifiedAt: '2026-08-20T12:00:00Z',
};

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 'transaction-1',
    productId: 'com.cadelawless.whatzit.deck.worship_icons',
    purchaseState: 'purchased',
    purchaseToken: 'signed-transaction-1',
    transactionId: 'transaction-1',
    ...overrides,
  } as Purchase;
}

describe('Apple purchase restoration', () => {
  it('verifies each known transaction once before repairing local content', async () => {
    const calls: string[] = [];
    const result = await reconcileApplePurchases({
      purchases: [
        purchase(),
        purchase(),
        purchase({
          id: 'unknown-transaction',
          productId: 'com.example.unknown',
          transactionId: 'unknown-transaction',
        }),
      ],
      knownProductIds: new Set([
        'com.cadelawless.whatzit.deck.worship_icons',
      ]),
      verify: async (signedTransaction) => {
        calls.push(`verify:${signedTransaction}`);
        return entitlements;
      },
      finish: async (candidate) => {
        calls.push(`finish:${candidate.transactionId}`);
      },
      fetchEntitlements: async () => {
        calls.push('fetch-entitlements');
        return entitlements;
      },
      persistEntitlements: async () => {
        calls.push('persist-entitlements');
      },
      prepareEntitledDecks: async () => {
        calls.push('prepare-decks');
      },
    });

    assert.equal(result.verifiedTransactionCount, 1);
    assert.equal(result.entitlements, entitlements);
    assert.deepEqual(calls, [
      'verify:signed-transaction-1',
      'finish:transaction-1',
      'fetch-entitlements',
      'persist-entitlements',
      'prepare-decks',
    ]);
  });

  it('still repairs existing server entitlements when StoreKit returns no purchases', async () => {
    const calls: string[] = [];
    const result = await reconcileApplePurchases({
      purchases: [],
      knownProductIds: new Set(),
      verify: async () => {
        throw new Error('No transaction should be verified.');
      },
      finish: async () => {
        throw new Error('No transaction should be finished.');
      },
      fetchEntitlements: async () => entitlements,
      persistEntitlements: async () => {
        calls.push('persist-entitlements');
      },
      prepareEntitledDecks: async () => {
        calls.push('prepare-decks');
      },
    });

    assert.equal(result.verifiedTransactionCount, 0);
    assert.deepEqual(calls, ['persist-entitlements', 'prepare-decks']);
  });
});

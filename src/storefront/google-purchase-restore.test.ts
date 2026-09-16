import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Purchase } from 'expo-iap';

import { reconcileGooglePurchases } from './google-purchase-restore';

const entitlements = {
  installationId: 'installation',
  products: [{ productId: 'bundle-owned-1', kind: 'bundle' as const, targetId: 'bundle' }],
  deckIds: ['a', 'b'],
  verifiedAt: '2026-09-14T00:00:00Z',
};

describe('Google purchase restoration', () => {
  it('verifies known purchased tokens once and then refreshes durable entitlements', async () => {
    const calls: string[] = [];
    const purchase = {
      id: 'purchase', productId: 'bundle-owned-1', purchaseState: 'purchased', purchaseToken: 'token',
    } as Purchase;
    const result = await reconcileGooglePurchases({
      purchases: [purchase, purchase, { ...purchase, productId: 'unknown', purchaseToken: 'other' }],
      knownProductIds: new Set(['bundle-owned-1']),
      verify: async () => { calls.push('verify'); return entitlements; },
      finish: async () => { calls.push('finish'); },
      fetchEntitlements: async () => { calls.push('fetch'); return entitlements; },
      persistEntitlements: async () => { calls.push('persist'); },
      prepareEntitledDecks: async () => { calls.push('prepare'); },
    });
    assert.deepEqual(calls, ['verify', 'finish', 'fetch', 'persist', 'prepare']);
    assert.equal(result.verifiedTransactionCount, 1);
  });
});

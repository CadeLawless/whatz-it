import type { Purchase } from 'expo-iap';

import type { CommerceEntitlements } from './commerce-api';

type ReconcileGooglePurchasesOptions = {
  purchases: Purchase[];
  knownProductIds: ReadonlySet<string>;
  verify: (purchase: Purchase) => Promise<CommerceEntitlements>;
  finish: (purchase: Purchase) => Promise<unknown>;
  fetchEntitlements: () => Promise<CommerceEntitlements>;
  persistEntitlements: (entitlements: CommerceEntitlements) => Promise<unknown>;
  prepareEntitledDecks: (entitlements: CommerceEntitlements) => Promise<void>;
};

export async function reconcileGooglePurchases({
  purchases,
  knownProductIds,
  verify,
  finish,
  fetchEntitlements,
  persistEntitlements,
  prepareEntitledDecks,
}: ReconcileGooglePurchasesOptions) {
  let verifiedTransactionCount = 0;
  let finishFailureCount = 0;
  const seenTokens = new Set<string>();
  for (const purchase of purchases) {
    const token = purchase.purchaseToken;
    if (
      purchase.purchaseState !== 'purchased'
      || !token
      || seenTokens.has(token)
      || !knownProductIds.has(purchase.productId)
    ) continue;
    seenTokens.add(token);
    await verify(purchase);
    verifiedTransactionCount += 1;
    try {
      await finish(purchase);
    } catch {
      finishFailureCount += 1;
    }
  }
  const entitlements = await fetchEntitlements();
  await persistEntitlements(entitlements);
  await prepareEntitledDecks(entitlements);
  return { entitlements, finishFailureCount, verifiedTransactionCount };
}

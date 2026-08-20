import type { Purchase } from 'expo-iap';

import type { CommerceEntitlements } from './commerce-api';

export type AppleRestoreResult = {
  entitlements: CommerceEntitlements;
  verifiedTransactionCount: number;
};

export async function reconcileApplePurchases({
  purchases,
  knownProductIds,
  verify,
  finish,
  fetchEntitlements,
  persistEntitlements,
  prepareEntitledDecks,
}: {
  purchases: readonly Purchase[];
  knownProductIds: ReadonlySet<string>;
  verify: (signedTransaction: string) => Promise<CommerceEntitlements>;
  finish: (purchase: Purchase) => Promise<void>;
  fetchEntitlements: () => Promise<CommerceEntitlements>;
  persistEntitlements: (entitlements: CommerceEntitlements) => Promise<unknown>;
  prepareEntitledDecks: (entitlements: CommerceEntitlements) => Promise<void>;
}): Promise<AppleRestoreResult> {
  const processedTransactions = new Set<string>();
  let verifiedTransactionCount = 0;

  for (const purchase of purchases) {
    const transactionKey = purchase.transactionId ?? purchase.id;
    if (
      purchase.purchaseState !== 'purchased'
      || !purchase.purchaseToken
      || !knownProductIds.has(purchase.productId)
      || processedTransactions.has(transactionKey)
    ) {
      continue;
    }

    processedTransactions.add(transactionKey);
    await verify(purchase.purchaseToken);
    await finish(purchase);
    verifiedTransactionCount += 1;
  }

  const entitlements = await fetchEntitlements();
  await persistEntitlements(entitlements);
  await prepareEntitledDecks(entitlements);

  return { entitlements, verifiedTransactionCount };
}

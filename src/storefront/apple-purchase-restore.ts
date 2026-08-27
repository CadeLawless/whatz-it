import type { Purchase } from 'expo-iap';

import type { CommerceEntitlements } from './commerce-api';

export type AppleRestoreResult = {
  entitlements: CommerceEntitlements;
  finishFailureCount: number;
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
  let finishFailureCount = 0;
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
    try {
      await finish(purchase);
    } catch {
      // Ownership has already been verified. A future app session can retry
      // acknowledgement without turning a valid restore into failure.
      finishFailureCount += 1;
    }
    verifiedTransactionCount += 1;
  }

  const entitlements = await fetchEntitlements();
  await persistEntitlements(entitlements);
  await prepareEntitledDecks(entitlements);

  return { entitlements, finishFailureCount, verifiedTransactionCount };
}

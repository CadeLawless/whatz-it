import type { StoreProductMappings } from '@/types/deck';

export type StorePlatform = 'apple' | 'google';

type SelectableBundle = {
  deckIds: readonly string[];
  storeProducts?: StoreProductMappings;
};

export type BundleProductSelection = {
  alreadyOwnedDeckCount: number;
  productId: string | null;
  totalDeckCount: number;
  usedFullPriceFallback: boolean;
};

export function selectBundleProduct(
  bundle: SelectableBundle,
  ownedDeckIds: ReadonlySet<string>,
  platform: StorePlatform,
): BundleProductSelection {
  const totalDeckCount = bundle.deckIds.length;
  const alreadyOwnedDeckCount = bundle.deckIds.reduce(
    (count, deckId) => count + (ownedDeckIds.has(deckId) ? 1 : 0),
    0,
  );
  if (totalDeckCount > 0 && alreadyOwnedDeckCount === totalDeckCount) {
    return {
      alreadyOwnedDeckCount,
      productId: null,
      totalDeckCount,
      usedFullPriceFallback: false,
    };
  }

  const mapping = bundle.storeProducts?.[platform];
  const fullPriceProductId = mapping?.status === 'available'
    ? mapping.productId
    : null;
  const tier = alreadyOwnedDeckCount > 0
    ? mapping?.ownedDeckCountProducts?.[String(alreadyOwnedDeckCount)]
    : undefined;
  const tierProductId = tier?.status === 'available' ? tier.productId : null;

  return {
    alreadyOwnedDeckCount,
    productId: tierProductId ?? fullPriceProductId,
    totalDeckCount,
    usedFullPriceFallback: alreadyOwnedDeckCount > 0 && tierProductId === null,
  };
}

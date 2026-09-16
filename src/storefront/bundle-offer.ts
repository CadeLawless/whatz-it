import { selectBundleProduct, type StorePlatform } from './bundle-product-selection';
import type { StoreProductMappings } from '@/types/deck';

type PricedDeck = { id: string; storeProducts?: StoreProductMappings };
type PricedBundle = {
  deckIds: readonly string[];
  decks: readonly PricedDeck[];
  storeProducts?: StoreProductMappings;
};
type StorePrice = { currency: string; price?: number | null };

export type BundleOffer = {
  alreadyOwnedDeckCount: number;
  totalDeckCount: number;
  /** The regular bundle price for an ownership discount, or the separate-deck total for a new buyer. */
  comparisonPrice: string | null;
  comparisonKind: 'bundle' | 'individual-decks' | null;
};

export function bundleOwnershipLabel(offer: BundleOffer | null): string | null {
  if (
    !offer
    || offer.alreadyOwnedDeckCount <= 0
    || offer.alreadyOwnedDeckCount >= offer.totalDeckCount
  ) return null;
  return `${offer.alreadyOwnedDeckCount}/${offer.totalDeckCount} decks owned`;
}

export function bundleRemainingDeckLabel(offer: BundleOffer | null): string | null {
  if (
    !offer
    || offer.comparisonKind !== 'bundle'
    || !offer.comparisonPrice
    || offer.alreadyOwnedDeckCount <= 0
    || offer.alreadyOwnedDeckCount >= offer.totalDeckCount
  ) return null;
  const remaining = offer.totalDeckCount - offer.alreadyOwnedDeckCount;
  return remaining === 1 ? 'Buy the last deck' : `Buy the last ${remaining} decks`;
}

export function bundleOffer(
  bundle: PricedBundle,
  ownedDeckIds: ReadonlySet<string>,
  platform: StorePlatform | null,
  storePrices: ReadonlyMap<string, StorePrice>,
): BundleOffer {
  const selection = platform
    ? selectBundleProduct(bundle, ownedDeckIds, platform)
    : null;
  const alreadyOwnedDeckCount = selection?.alreadyOwnedDeckCount
    ?? bundle.deckIds.filter((deckId) => ownedDeckIds.has(deckId)).length;
  const base = {
    alreadyOwnedDeckCount,
    totalDeckCount: bundle.deckIds.length,
    comparisonPrice: null,
    comparisonKind: null,
  };
  if (!platform || !selection?.productId || bundle.decks.length !== bundle.deckIds.length) {
    return base;
  }

  const selected = storePrices.get(selection.productId);
  if (!selected || !validPrice(selected.price)) return base;

  if (alreadyOwnedDeckCount > 0) {
    if (selection.usedFullPriceFallback) return base;
    const fullProduct = bundle.storeProducts?.[platform];
    const fullPrice = fullProduct?.status === 'available'
      ? storePrices.get(fullProduct.productId)
      : undefined;
    if (
      !fullPrice
      || fullPrice.currency !== selected.currency
      || !validPrice(fullPrice.price)
      || fullPrice.price <= selected.price + 0.0001
    ) return base;
    try {
      return {
        ...base,
        comparisonPrice: formatComparisonPrice(fullPrice.price, selected.currency),
        comparisonKind: 'bundle',
      };
    } catch {
      return base;
    }
  }

  let separateTotal = 0;
  for (const deck of bundle.decks) {
    const mapping = deck.storeProducts?.[platform];
    const individual = mapping?.status === 'available'
      ? storePrices.get(mapping.productId)
      : undefined;
    if (!individual || individual.currency !== selected.currency || !validPrice(individual.price)) {
      return base;
    }
    separateTotal += individual.price;
  }
  if (separateTotal <= selected.price + 0.0001) return base;

  try {
    return {
      ...base,
      comparisonPrice: formatComparisonPrice(separateTotal, selected.currency),
      comparisonKind: 'individual-decks',
    };
  } catch {
    return base;
  }
}

function validPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function formatComparisonPrice(price: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  if (formatter.resolvedOptions().maximumFractionDigits !== 2) return formatter.format(price);

  const cents = Math.ceil(price * 100 - 0.0000001);
  const nextNinetyNine = Math.floor(cents / 100) * 100 + 99;
  const roundedCents = cents > nextNinetyNine ? nextNinetyNine + 100 : nextNinetyNine;
  return formatter.format(roundedCents / 100);
}

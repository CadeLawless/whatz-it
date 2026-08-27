export type CommerceProductTarget = {
  kind: 'deck' | 'bundle';
  id: string;
};

type SerializedProductEntry = [string, CommerceProductTarget];

type CommerceProductRecord = {
  id: string;
  storeProducts?: {
    apple?: { productId: string };
  };
};

type CommerceProductCatalog = {
  decks: CommerceProductRecord[];
  bundles: CommerceProductRecord[];
};

export function commerceProductFingerprint(
  catalog: CommerceProductCatalog,
) {
  const entries: SerializedProductEntry[] = [];
  for (const deck of catalog.decks) {
    const productId = deck.storeProducts?.apple?.productId;
    if (productId) entries.push([productId, { kind: 'deck', id: deck.id }]);
  }
  for (const bundle of catalog.bundles) {
    const productId = bundle.storeProducts?.apple?.productId;
    if (productId) entries.push([productId, { kind: 'bundle', id: bundle.id }]);
  }
  return JSON.stringify(entries);
}

export function commerceProductIndexFromFingerprint(fingerprint: string) {
  return new Map<string, CommerceProductTarget>(
    JSON.parse(fingerprint) as SerializedProductEntry[],
  );
}

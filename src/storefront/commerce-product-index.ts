export type CommerceProductTarget = {
  kind: 'deck' | 'bundle';
  id: string;
};

type SerializedProductEntry = [string, CommerceProductTarget];

type CommerceProductRecord = {
  id: string;
  storeProducts?: {
    apple?: {
      productId: string;
      status?: string;
      ownedDeckCountProducts?: Record<string, { productId: string; status?: string }>;
    };
    google?: {
      productId: string;
      status?: string;
      ownedDeckCountProducts?: Record<string, { productId: string; status?: string }>;
    };
  };
};

type CommerceProductCatalog = {
  decks: CommerceProductRecord[];
  bundles: CommerceProductRecord[];
};

export function commerceProductFingerprint(
  catalog: CommerceProductCatalog,
  platform: 'apple' | 'google' = 'apple',
) {
  const entries: SerializedProductEntry[] = [];
  for (const deck of catalog.decks) {
    const productId = deck.storeProducts?.[platform]?.productId;
    if (productId && deck.storeProducts?.[platform]?.status !== 'draft'
      && deck.storeProducts?.[platform]?.status !== 'retired') {
      entries.push([productId, { kind: 'deck', id: deck.id }]);
    }
  }
  for (const bundle of catalog.bundles) {
    const mapping = bundle.storeProducts?.[platform];
    if (mapping?.productId && mapping.status !== 'draft' && mapping.status !== 'retired') {
      entries.push([mapping.productId, { kind: 'bundle', id: bundle.id }]);
    }
    for (const tier of Object.values(mapping?.ownedDeckCountProducts ?? {})) {
      if (tier.productId && tier.status !== 'draft' && tier.status !== 'retired') {
        entries.push([tier.productId, { kind: 'bundle', id: bundle.id }]);
      }
    }
  }
  return JSON.stringify(entries);
}

export function commerceProductIndexFromFingerprint(fingerprint: string) {
  return new Map<string, CommerceProductTarget>(
    JSON.parse(fingerprint) as SerializedProductEntry[],
  );
}

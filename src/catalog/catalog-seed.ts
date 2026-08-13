import type { Card, DeckAccess } from '@/types/deck';

export type CatalogSeedSource = {
  schemaVersion: 5;
  revision: number;
  updatedAt: string;
  decks: {
    id: string;
    order: number;
    title: string;
    description: string;
    coverImage?: string;
    version: number;
    cardCount?: number;
    cardContentVersion?: number;
    tags: string[];
    access: DeckAccess;
    price?: number;
    cards: Card[];
  }[];
  bundles: {
    id: string;
    order: number;
    title: string;
    description: string;
    access: DeckAccess;
    price?: number;
    version?: number;
    deckIds: string[];
  }[];
  deckOrders: { free: string[]; paid: string[] };
};

export type CatalogSeed = ReturnType<typeof createCatalogSeed>;

export function createCatalogSeed(catalog: CatalogSeedSource) {
  const deckIds = new Set<string>();
  const bundleIds = new Set<string>();

  const decks = catalog.decks.map((deck) => {
    if (deckIds.has(deck.id)) throw new Error(`Duplicate deck ID: ${deck.id}`);
    deckIds.add(deck.id);
    return {
      deckId: deck.id,
      deckVersion: deck.version,
      cardContentVersion: deck.cardContentVersion ?? 1,
      title: deck.title,
      description: deck.description,
      access: deck.access,
      priceMinorUnits: toMinorUnits(deck.price),
      tagsJson: JSON.stringify(deck.tags),
      cardCount: deck.cardCount ?? deck.cards.length,
      coverPath: deck.coverImage || null,
    };
  });

  const bundles = catalog.bundles.map((bundle) => {
    if (bundleIds.has(bundle.id)) throw new Error(`Duplicate bundle ID: ${bundle.id}`);
    bundleIds.add(bundle.id);
    return {
      bundleId: bundle.id,
      bundleVersion: bundle.version ?? 1,
      title: bundle.title,
      description: bundle.description,
      access: bundle.access,
      priceMinorUnits: toMinorUnits(bundle.price),
      sortOrder: bundle.order,
    };
  });

  const bundleDecks = catalog.bundles.flatMap((bundle) =>
    bundle.deckIds.map((deckId, position) => {
      if (!deckIds.has(deckId)) {
        throw new Error(`Bundle ${bundle.id} references unknown deck ${deckId}.`);
      }
      return { bundleId: bundle.id, deckId, position };
    }),
  );

  const deckOrders = (['free', 'paid'] as const).flatMap((scope) =>
    catalog.deckOrders[scope].map((deckId, position) => {
      if (!deckIds.has(deckId)) {
        throw new Error(`${scope} order references unknown deck ${deckId}.`);
      }
      return { scope, deckId, position };
    }),
  );

  const cards = catalog.decks
    .filter((deck) => deck.access === 'free')
    .flatMap((deck) =>
      deck.cards.map((card, position) => ({
        deckId: deck.id,
        cardContentVersion: deck.cardContentVersion ?? 1,
        cardId: card.id,
        position,
        text: card.text,
        byline: card.byline ?? null,
      })),
    );

  const installations = catalog.decks.map((deck) => ({
    deckId: deck.id,
    ownershipSource: deck.access === 'free' ? ('free' as const) : ('none' as const),
    desiredContentVersion: deck.cardContentVersion ?? 1,
    installedContentVersion: deck.access === 'free' ? (deck.cardContentVersion ?? 1) : null,
    status: deck.access === 'free' ? ('installed' as const) : ('not_owned' as const),
  }));

  return {
    state: {
      localSchemaVersion: 2,
      catalogSchemaVersion: catalog.schemaVersion,
      catalogRevision: catalog.revision,
      source: 'bundled' as const,
      catalogUpdatedAt: catalog.updatedAt,
    },
    decks,
    bundles,
    bundleDecks,
    deckOrders,
    cards,
    installations,
  };
}

function toMinorUnits(price: number | undefined) {
  if (price === undefined) return null;
  const minorUnits = Math.round(price * 100);
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new Error(`Invalid catalog price: ${price}`);
  }
  return minorUnits;
}

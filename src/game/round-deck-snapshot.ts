import type { CatalogDeck, CatalogSnapshot } from '@/catalog/catalog-snapshot';

export function captureRoundDeck(deck: CatalogDeck): CatalogDeck {
  return {
    ...deck,
    cards: deck.cards.map((card) => ({ ...card })),
    tags: [...deck.tags],
    ...(deck.storeProducts
      ? {
          storeProducts: {
            ...(deck.storeProducts.apple
              ? { apple: { ...deck.storeProducts.apple } }
              : {}),
            ...(deck.storeProducts.google
              ? { google: { ...deck.storeProducts.google } }
              : {}),
          },
        }
      : {}),
  };
}

export function resolveRoundDeck(
  catalog: CatalogSnapshot,
  capturedDeck: CatalogDeck | null,
  deckId: string | undefined,
) {
  if (deckId && capturedDeck?.id === deckId) return capturedDeck;
  return catalog.getDeckById(deckId);
}

import type { Bundle, Deck } from '@/types/deck';

import type { CatalogRuntimeSource } from './catalog-feature';

export type CatalogDeck = Deck & {
  tags: string[];
  cardCount: number;
  cardContentVersion: number;
  coverPath?: string;
  coverUri?: string;
  installationStatus: 'installed' | 'not_owned' | 'pending' | 'failed';
};

export type CatalogBundle = Omit<Bundle, 'decks'> & {
  version: number;
  decks: CatalogDeck[];
};

export type CatalogSnapshot = {
  schemaVersion: number;
  revision: number;
  source: CatalogRuntimeSource;
  decks: CatalogDeck[];
  bundles: CatalogBundle[];
  freeDecks: CatalogDeck[];
  paidDecks: CatalogDeck[];
  getDeckById: (deckId: string | undefined) => CatalogDeck | undefined;
  getBundleById: (bundleId: string | undefined) => CatalogBundle | undefined;
  getBundlesForDeck: (deckId: string | undefined) => CatalogBundle[];
};

export type CatalogSnapshotInput = {
  schemaVersion: number;
  revision: number;
  source: CatalogRuntimeSource;
  decks: CatalogDeck[];
  bundleRecords: (Omit<CatalogBundle, 'decks'> & { deckIds: string[] })[];
  deckOrders: { free: string[]; paid: string[] };
};

export function buildCatalogSnapshot(
  input: CatalogSnapshotInput,
): CatalogSnapshot {
  const decksById = new Map(input.decks.map((deck) => [deck.id, deck]));
  const bundles = input.bundleRecords.map<CatalogBundle>((bundle) => ({
    ...bundle,
    decks: bundle.deckIds.map((deckId) => {
      const deck = decksById.get(deckId);
      if (!deck) throw new Error(`Bundle ${bundle.id} references missing deck ${deckId}.`);
      return deck;
    }),
  }));
  const bundlesById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const orderedDecks = (ids: string[]) =>
    ids.map((deckId) => {
      const deck = decksById.get(deckId);
      if (!deck) throw new Error(`Catalog order references missing deck ${deckId}.`);
      return deck;
    });

  return {
    schemaVersion: input.schemaVersion,
    revision: input.revision,
    source: input.source,
    decks: input.decks,
    bundles,
    freeDecks: orderedDecks(input.deckOrders.free),
    paidDecks: orderedDecks(input.deckOrders.paid),
    getDeckById: (deckId) => (deckId ? decksById.get(deckId) : undefined),
    getBundleById: (bundleId) =>
      bundleId ? bundlesById.get(bundleId) : undefined,
    getBundlesForDeck: (deckId) =>
      deckId ? bundles.filter((bundle) => bundle.deckIds.includes(deckId)) : [],
  };
}

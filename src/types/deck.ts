export type Card = {
  id: string;
  text: string;
  byline?: string;
  featuredOrder?: number;
};

export type DeckAccess = 'free' | 'paid';

export type StoreProductStatus = 'draft' | 'available' | 'retired';

export type StoreProductMapping = {
  productId: string;
  status: StoreProductStatus;
};

export type StoreProductMappings = {
  apple?: StoreProductMapping;
  google?: StoreProductMapping;
};

export type Deck = {
  id: string;
  order: number;
  title: string;
  description: string;
  coverImage?: number;
  version: number;
  access: DeckAccess;
  price?: number;
  storeProducts?: StoreProductMappings;
  cards: Card[];
  featuredCards?: Card[];
};

export type Bundle = {
  id: string;
  order: number;
  title: string;
  description: string;
  access: DeckAccess;
  price?: number;
  storeProducts?: StoreProductMappings;
  deckIds: string[];
  decks: Deck[];
};

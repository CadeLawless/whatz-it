export type Card = {
  id: string;
  text: string;
  byline?: string;
};

export type DeckAccess = 'free' | 'paid';

export type Deck = {
  id: string;
  order: number;
  title: string;
  description: string;
  coverImage?: number;
  version: number;
  packId: string;
  access: DeckAccess;
  price?: number;
  cards: Card[];
};

export type DeckPack = {
  id: string;
  order: number;
  title: string;
  access: DeckAccess;
  price?: number;
  decks: Deck[];
};

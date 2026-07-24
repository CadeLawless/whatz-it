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
  access: DeckAccess;
  price?: number;
  cards: Card[];
};

export type Bundle = {
  id: string;
  order: number;
  title: string;
  access: DeckAccess;
  price?: number;
  deckIds: string[];
  decks: Deck[];
};

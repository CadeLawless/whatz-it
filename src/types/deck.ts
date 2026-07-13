export type Card = {
  id: string;
  text: string;
};

export type Deck = {
  id: string;
  title: string;
  description: string;
  coverImage?: number;
  version: number;
  cards: Card[];
};

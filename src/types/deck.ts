export type Card = {
  id: string;
  text: string;
};

export type Deck = {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  version: number;
  cards: Card[];
};

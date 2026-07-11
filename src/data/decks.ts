import type { Deck } from '@/types/deck';

export const decks: Deck[] = [
  {
    id: 'animal-antics',
    title: 'Animal Antics',
    description: 'Wild, woolly, tiny, and enormous creatures from around the world.',
    color: '#B8E986',
    icon: '🦊',
    version: 1,
    cards: [
      { id: 'animal-01', text: 'Penguin' },
      { id: 'animal-02', text: 'Giraffe' },
      { id: 'animal-03', text: 'Octopus' },
      { id: 'animal-04', text: 'Kangaroo' },
      { id: 'animal-05', text: 'Sloth' },
      { id: 'animal-06', text: 'Peacock' },
      { id: 'animal-07', text: 'Hedgehog' },
      { id: 'animal-08', text: 'Dolphin' },
      { id: 'animal-09', text: 'Chameleon' },
      { id: 'animal-10', text: 'Goose' },
    ],
  },
  {
    id: 'snack-attack',
    title: 'Snack Attack',
    description: 'Favorite foods, questionable cravings, and treats worth fighting over.',
    color: '#FFCB69',
    icon: '🍕',
    version: 1,
    cards: [
      { id: 'food-01', text: 'Popcorn' },
      { id: 'food-02', text: 'Tacos' },
      { id: 'food-03', text: 'Cotton Candy' },
      { id: 'food-04', text: 'Pancakes' },
      { id: 'food-05', text: 'Sushi' },
      { id: 'food-06', text: 'Cheeseburger' },
      { id: 'food-07', text: 'Ice Cream' },
      { id: 'food-08', text: 'Pretzel' },
      { id: 'food-09', text: 'Watermelon' },
      { id: 'food-10', text: 'Nachos' },
    ],
  },
  {
    id: 'screen-stars',
    title: 'Screen Stars',
    description: 'Iconic characters and familiar faces from movies and television.',
    color: '#B9C6FF',
    icon: '🎬',
    version: 1,
    cards: [
      { id: 'screen-01', text: 'The Wizard of Oz' },
      { id: 'screen-02', text: 'Sherlock Holmes' },
      { id: 'screen-03', text: 'Cinderella' },
      { id: 'screen-04', text: 'King Kong' },
      { id: 'screen-05', text: 'Peter Pan' },
      { id: 'screen-06', text: 'Frankenstein' },
      { id: 'screen-07', text: 'Robin Hood' },
      { id: 'screen-08', text: 'Godzilla' },
      { id: 'screen-09', text: 'Dracula' },
      { id: 'screen-10', text: 'Alice in Wonderland' },
    ],
  },
];

export function getDeckById(deckId: string | undefined) {
  return decks.find((deck) => deck.id === deckId);
}

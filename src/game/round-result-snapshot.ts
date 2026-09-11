import type { CatalogDeck } from '@/catalog/catalog-snapshot';
import type { CardResult, RoundState } from '@/game/game-types';

export type StoredCardResult = CardResult & {
  text: string;
  byline?: string;
};

export type RoundResultSnapshot = {
  version: 1;
  deckId: string;
  deckTitle: string;
  durationSeconds: number;
  results: StoredCardResult[];
};

export function captureRoundResultSnapshot(
  round: Pick<RoundState, 'deckId' | 'durationSeconds' | 'results'>,
  deck: CatalogDeck | null,
): RoundResultSnapshot | undefined {
  if (!round.deckId || !deck || deck.id !== round.deckId) return undefined;

  return {
    version: 1,
    deckId: round.deckId,
    deckTitle: deck.title,
    durationSeconds: round.durationSeconds,
    results: round.results.map((result) => {
      const card = deck.cards.find((candidate) => candidate.id === result.cardId);
      return {
        ...result,
        text: card?.text ?? 'Unknown card',
        ...(card?.byline ? { byline: card.byline } : {}),
      };
    }),
  };
}

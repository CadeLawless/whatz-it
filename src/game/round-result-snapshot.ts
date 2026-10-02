import type { CatalogDeck } from '@/catalog/catalog-snapshot';
import { parseGameMode } from '@/game/game-mode';
import type { CardResult, GameMode, RoundState } from '@/game/game-types';

export type StoredCardResult = CardResult & {
  text: string;
  byline?: string;
};

export type RoundResultSnapshot = {
  version: 1;
  // Older version-1 recordings omit mode and replay as Classic.
  mode?: GameMode;
  deckId: string;
  deckTitle: string;
  durationSeconds: number;
  results: StoredCardResult[];
};

export function captureRoundResultSnapshot(
  round: Pick<RoundState, 'deckId' | 'durationSeconds' | 'results'> & Partial<Pick<RoundState, 'mode'>>,
  deck: CatalogDeck | null,
): RoundResultSnapshot | undefined {
  if (!round.deckId || !deck || deck.id !== round.deckId) return undefined;

  return {
    version: 1,
    mode: parseGameMode(round.mode),
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

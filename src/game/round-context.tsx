import { createContext, type PropsWithChildren, useContext, useMemo, useReducer, useRef } from 'react';

import { getDeckById } from '@/data/decks';
import { initialRoundState, roundReducer } from '@/game/game-reducer';
import type { CardOutcome, RoundState } from '@/game/game-types';
import { clampRoundDuration } from '@/game/round-duration';
import { shuffle } from '@/game/shuffle';
import { getSessionCardPool } from '@/game/session-card-memory';

type RoundContextValue = {
  round: RoundState;
  configureRound: (deckId: string, durationSeconds: number) => boolean;
  startRound: () => void;
  answerCard: (outcome: CardOutcome) => void;
  advanceCard: () => void;
  finishRound: () => void;
  resetRound: () => void;
};

const RoundContext = createContext<RoundContextValue | null>(null);

export function RoundProvider({ children }: PropsWithChildren) {
  const [round, dispatch] = useReducer(roundReducer, initialRoundState);
  const seenCardsByDeck = useRef(new Map<string, Set<string>>());

  const rememberCard = (deckId: string | null, cardId: string | undefined) => {
    if (!deckId || !cardId) return;
    const seenCards = seenCardsByDeck.current.get(deckId) ?? new Set<string>();
    seenCards.add(cardId);
    seenCardsByDeck.current.set(deckId, seenCards);
  };

  const value = useMemo<RoundContextValue>(
    () => ({
      round,
      configureRound: (deckId, durationSeconds) => {
        const deck = getDeckById(deckId);
        if (!deck) return false;
        const seenCards = seenCardsByDeck.current.get(deckId) ?? new Set<string>();
        const pool = getSessionCardPool(
          deck.cards.map((card) => card.id),
          seenCards,
        );
        if (pool.resetMemory) seenCards.clear();
        seenCardsByDeck.current.set(deckId, seenCards);
        dispatch({
          type: 'CONFIGURE',
          deckId,
          durationSeconds: clampRoundDuration(durationSeconds),
          cardOrder: shuffle(pool.cardIds),
        });
        return true;
      },
      startRound: () => {
        rememberCard(round.deckId, round.cardOrder[round.currentCardIndex]);
        dispatch({ type: 'START', now: Date.now() });
      },
      answerCard: (outcome) => dispatch({ type: 'ANSWER', outcome, now: Date.now() }),
      advanceCard: () => {
        if (round.status === 'feedback') {
          rememberCard(round.deckId, round.cardOrder[round.currentCardIndex + 1]);
        }
        dispatch({ type: 'ADVANCE' });
      },
      finishRound: () => dispatch({ type: 'FINISH', now: Date.now() }),
      resetRound: () => dispatch({ type: 'RESET' }),
    }),
    [round],
  );

  return <RoundContext.Provider value={value}>{children}</RoundContext.Provider>;
}

export function useRound() {
  const context = useContext(RoundContext);
  if (!context) throw new Error('useRound must be used inside RoundProvider');
  return context;
}

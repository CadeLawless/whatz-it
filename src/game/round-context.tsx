import { createContext, type PropsWithChildren, useContext, useMemo, useReducer } from 'react';

import { getDeckById } from '@/data/decks';
import { initialRoundState, roundReducer } from '@/game/game-reducer';
import type { CardOutcome, RoundState } from '@/game/game-types';
import { shuffle } from '@/game/shuffle';

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

  const value = useMemo<RoundContextValue>(
    () => ({
      round,
      configureRound: (deckId, durationSeconds) => {
        const deck = getDeckById(deckId);
        if (!deck) return false;
        dispatch({
          type: 'CONFIGURE',
          deckId,
          durationSeconds,
          cardOrder: shuffle(deck.cards.map((card) => card.id)),
        });
        return true;
      },
      startRound: () => dispatch({ type: 'START', now: Date.now() }),
      answerCard: (outcome) => dispatch({ type: 'ANSWER', outcome, now: Date.now() }),
      advanceCard: () => dispatch({ type: 'ADVANCE' }),
      finishRound: () => dispatch({ type: 'FINISH' }),
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

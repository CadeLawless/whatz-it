import { roundReducer } from '@/game/game-reducer';
import type { RoundAction, RoundState } from '@/game/game-types';

export function resolveRoundTransition(state: RoundState, action: RoundAction) {
  const round = roundReducer(state, action);
  const revealedCardId = round !== state && round.status === 'playing' &&
    (state.status === 'ready' || round.currentCardIndex !== state.currentCardIndex)
    ? round.cardOrder[round.currentCardIndex]
    : undefined;
  return { round, revealedCardId };
}

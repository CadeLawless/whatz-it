import type { RoundAction, RoundState } from '@/game/game-types';

export const initialRoundState: RoundState = {
  status: 'idle',
  deckId: null,
  durationSeconds: 60,
  cardOrder: [],
  currentCardIndex: 0,
  results: [],
  startedAt: null,
  endsAt: null,
  latestOutcome: null,
};

export function roundReducer(state: RoundState, action: RoundAction): RoundState {
  switch (action.type) {
    case 'CONFIGURE':
      return {
        ...initialRoundState,
        status: 'ready',
        deckId: action.deckId,
        durationSeconds: action.durationSeconds,
        cardOrder: action.cardOrder,
      };
    case 'START':
      if (state.status !== 'ready') return state;
      return {
        ...state,
        status: 'playing',
        startedAt: action.now,
        endsAt: action.now + state.durationSeconds * 1000,
      };
    case 'ANSWER': {
      if (state.status !== 'playing') return state;
      const cardId = state.cardOrder[state.currentCardIndex];
      if (!cardId) return { ...state, status: 'finished' };
      return {
        ...state,
        status: 'feedback',
        latestOutcome: action.outcome,
        results: [
          ...state.results,
          { cardId, outcome: action.outcome, answeredAt: action.now },
        ],
      };
    }
    case 'ADVANCE': {
      if (state.status !== 'feedback') return state;
      const nextIndex = state.currentCardIndex + 1;
      if (nextIndex >= state.cardOrder.length) {
        return { ...state, status: 'finished', latestOutcome: null };
      }
      return {
        ...state,
        status: 'playing',
        currentCardIndex: nextIndex,
        latestOutcome: null,
      };
    }
    case 'FINISH': {
      if (state.status === 'idle' || state.status === 'finished') return state;
      const cardId = state.cardOrder[state.currentCardIndex];
      const shouldRecordNeutral =
        (state.status === 'ready' || state.status === 'playing') &&
        cardId !== undefined &&
        !state.results.some((result) => result.cardId === cardId);
      return {
        ...state,
        status: 'finished',
        latestOutcome: null,
        results: shouldRecordNeutral
          ? [...state.results, { cardId, outcome: 'neutral', answeredAt: action.now }]
          : state.results,
      };
    }
    case 'RESET':
      return initialRoundState;
    default:
      return state;
  }
}

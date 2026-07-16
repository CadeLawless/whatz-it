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
  pausedStatus: null,
  remainingMs: null,
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
    case 'PAUSE': {
      if (state.status !== 'playing' && state.status !== 'feedback') return state;
      return {
        ...state,
        status: 'paused',
        pausedStatus: state.status,
        remainingMs: Math.max(0, (state.endsAt ?? action.now) - action.now),
        endsAt: null,
      };
    }
    case 'RESUME': {
      if (state.status !== 'paused' || !state.pausedStatus) return state;
      const remainingMs = Math.max(0, state.remainingMs ?? 0);
      if (remainingMs === 0) {
        return {
          ...state,
          status: 'finished',
          pausedStatus: null,
          remainingMs: null,
          latestOutcome: null,
        };
      }
      if (state.pausedStatus === 'feedback') {
        const nextIndex = state.currentCardIndex + 1;
        if (nextIndex >= state.cardOrder.length) {
          return {
            ...state,
            status: 'finished',
            pausedStatus: null,
            remainingMs: null,
            latestOutcome: null,
          };
        }
        return {
          ...state,
          status: 'playing',
          currentCardIndex: nextIndex,
          endsAt: action.now + remainingMs,
          pausedStatus: null,
          remainingMs: null,
          latestOutcome: null,
        };
      }
      return {
        ...state,
        status: state.pausedStatus,
        endsAt: action.now + remainingMs,
        pausedStatus: null,
        remainingMs: null,
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

import type { RoundAction, RoundState } from '@/game/game-types';

export const initialRoundState: RoundState = {
  mode: 'classic',
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
        mode: action.mode ?? 'classic',
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
      if (state.mode === 'pass-n-play' && state.endsAt !== null && action.now >= state.endsAt) {
        return roundReducer(state, { type: 'FINISH', now: action.now });
      }
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
      if (state.mode === 'pass-n-play') {
        if (action.now === undefined) return state;
        if (state.endsAt !== null && action.now >= state.endsAt) {
          return roundReducer(state, { type: 'FINISH', now: action.now });
        }
        if (state.latestOutcome === 'correct') {
          return { ...state, status: 'handoff', latestOutcome: null };
        }
      }
      const nextIndex = state.currentCardIndex + 1;
      if (nextIndex >= state.cardOrder.length) {
        if (!action.replenishedCardOrder?.length) {
          return { ...state, status: 'finished', latestOutcome: null };
        }
        return {
          ...state,
          status: 'playing',
          cardOrder: [...state.cardOrder, ...action.replenishedCardOrder],
          currentCardIndex: nextIndex,
          latestOutcome: null,
        };
      }
      return {
        ...state,
        status: 'playing',
        currentCardIndex: nextIndex,
        latestOutcome: null,
      };
    }
    case 'REVEAL': {
      if (state.mode !== 'pass-n-play' || state.status !== 'handoff') return state;
      if (state.endsAt === null || action.now >= state.endsAt) {
        return roundReducer(state, { type: 'FINISH', now: action.now });
      }
      const nextIndex = state.currentCardIndex + 1;
      const cardOrder = nextIndex < state.cardOrder.length
        ? state.cardOrder
        : [...state.cardOrder, ...(action.replenishedCardOrder ?? [])];
      if (!cardOrder[nextIndex]) return roundReducer(state, { type: 'FINISH', now: action.now });
      return {
        ...state,
        status: 'playing',
        cardOrder,
        currentCardIndex: nextIndex,
        latestOutcome: null,
      };
    }
    case 'EXPIRE':
      // A callback scheduled before a manual pause cannot expire a new clock.
      if ((state.status !== 'playing' && state.status !== 'feedback' && state.status !== 'handoff') ||
          state.endsAt !== action.endsAt || action.now < action.endsAt) return state;
      return roundReducer(state, { type: 'FINISH', now: action.now });
    case 'PAUSE': {
      if (state.status !== 'playing' && state.status !== 'feedback' && state.status !== 'handoff') return state;
      if (state.mode === 'pass-n-play' && state.endsAt !== null && action.now >= state.endsAt) {
        return roundReducer(state, { type: 'FINISH', now: action.now });
      }
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
      if (state.pausedStatus === 'handoff') {
        return { ...state, status: 'handoff', endsAt: action.now + remainingMs,
          remainingMs: null, pausedStatus: null };
      }
      if (state.pausedStatus === 'feedback') {
        if (state.mode === 'pass-n-play' && state.latestOutcome === 'correct') {
          return { ...state, status: 'handoff', endsAt: action.now + remainingMs,
            remainingMs: null, pausedStatus: null, latestOutcome: null };
        }
        const nextIndex = state.currentCardIndex + 1;
        if (nextIndex >= state.cardOrder.length) {
          if (!action.replenishedCardOrder?.length) {
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
            cardOrder: [...state.cardOrder, ...action.replenishedCardOrder],
            currentCardIndex: nextIndex,
            endsAt: action.now + remainingMs,
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
        (state.status === 'playing' || (state.mode === 'classic' && state.status === 'ready') ||
          (state.mode === 'pass-n-play' && state.status === 'paused' && state.pausedStatus === 'playing')) &&
        cardId !== undefined;
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

export const PASS_N_PLAY_INTRO_MS = 2410;
const COUNTDOWN_MS = 3000;

type ReadyPhase = 'intro' | 'countdown';
export type PassNPlayReadyState = {
  phase: 'waiting' | ReadyPhase | 'paused' | 'complete' | 'cancelled';
  endsAt: number | null;
  pausedPhase: ReadyPhase | null;
  remainingMs: number | null;
};

export const initialPassNPlayReadyState: PassNPlayReadyState = {
  phase: 'waiting', endsAt: null, pausedPhase: null, remainingMs: null,
};

export type PassNPlayReadyAction =
  | { type: 'BEGIN'; now: number }
  | { type: 'TICK'; now: number; endsAt: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'CANCEL' };

export function passNPlayReadyReducer(
  state: PassNPlayReadyState, action: PassNPlayReadyAction,
): PassNPlayReadyState {
  switch (action.type) {
    case 'BEGIN':
      return state.phase === 'waiting'
        ? { ...state, phase: 'intro', endsAt: action.now + PASS_N_PLAY_INTRO_MS }
        : state;
    case 'TICK':
      if (state.endsAt !== action.endsAt || action.now < action.endsAt) return state;
      if (state.phase === 'intro') {
        return { ...state, phase: 'countdown', endsAt: action.now + COUNTDOWN_MS };
      }
      return state.phase === 'countdown' ? { ...state, phase: 'complete', endsAt: null } : state;
    case 'PAUSE':
      return state.phase === 'intro' || state.phase === 'countdown'
        ? { ...state, phase: 'paused', pausedPhase: state.phase,
          remainingMs: Math.max(0, (state.endsAt ?? action.now) - action.now), endsAt: null }
        : state;
    case 'RESUME':
      return state.phase === 'paused' && state.pausedPhase
        ? { ...state, phase: state.pausedPhase, endsAt: action.now + (state.remainingMs ?? 0),
          pausedPhase: null, remainingMs: null }
        : state;
    case 'CANCEL':
      return { ...initialPassNPlayReadyState, phase: 'cancelled' };
  }
}

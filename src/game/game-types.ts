export type ActiveRoundStatus = 'playing' | 'feedback';
export type RoundStatus = 'idle' | 'ready' | ActiveRoundStatus | 'paused' | 'finished';

export type CardOutcome = 'correct' | 'passed';
export type CardResultOutcome = CardOutcome | 'neutral';

export type CardResult = {
  cardId: string;
  outcome: CardResultOutcome;
  answeredAt: number;
};

export type RoundState = {
  status: RoundStatus;
  deckId: string | null;
  durationSeconds: number;
  cardOrder: string[];
  currentCardIndex: number;
  results: CardResult[];
  startedAt: number | null;
  endsAt: number | null;
  pausedStatus: ActiveRoundStatus | null;
  remainingMs: number | null;
  latestOutcome: CardOutcome | null;
};

export type RoundAction =
  | { type: 'CONFIGURE'; deckId: string; durationSeconds: number; cardOrder: string[] }
  | { type: 'START'; now: number }
  | { type: 'ANSWER'; outcome: CardOutcome; now: number }
  | { type: 'ADVANCE' }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'FINISH'; now: number }
  | { type: 'RESET' };

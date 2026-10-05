export type GameMode = 'classic' | 'pass-n-play';
export type ActiveRoundStatus = 'playing' | 'feedback' | 'handoff';
export type RoundStatus = 'idle' | 'ready' | ActiveRoundStatus | 'paused' | 'finished';

export type CardOutcome = 'correct' | 'passed';
export type CardResultOutcome = CardOutcome | 'neutral';

export type CardResult = {
  cardId: string;
  outcome: CardResultOutcome;
  answeredAt: number;
};

export type RoundState = {
  mode: GameMode;
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
  | { type: 'CONFIGURE'; deckId: string; durationSeconds: number; cardOrder: string[]; mode?: GameMode }
  | { type: 'START'; now: number }
  | { type: 'ANSWER'; outcome: CardOutcome; now: number }
  | { type: 'ADVANCE'; now?: number; replenishedCardOrder?: string[] }
  | { type: 'REVEAL'; now: number; replenishedCardOrder?: string[] }
  | { type: 'EXPIRE'; now: number; endsAt: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number; replenishedCardOrder?: string[] }
  | { type: 'FINISH'; now: number }
  | { type: 'RESET' };

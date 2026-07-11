export type RoundStatus = 'idle' | 'ready' | 'playing' | 'feedback' | 'finished';

export type CardOutcome = 'correct' | 'passed';

export type CardResult = {
  cardId: string;
  outcome: CardOutcome;
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
  latestOutcome: CardOutcome | null;
};

export type RoundAction =
  | { type: 'CONFIGURE'; deckId: string; durationSeconds: number; cardOrder: string[] }
  | { type: 'START'; now: number }
  | { type: 'ANSWER'; outcome: CardOutcome; now: number }
  | { type: 'ADVANCE' }
  | { type: 'FINISH' }
  | { type: 'RESET' };

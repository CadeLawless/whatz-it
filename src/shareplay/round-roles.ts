import type { GameMode } from '../game/game-types';

// The existing wire field guesserId identifies the active turn owner: the
// guesser in Classic, and the clue giver in Pass n Play.
export function canSeeSharePlayAnswer(mode: GameMode | undefined, participantId: string, turnOwnerId: string) {
  return mode === 'pass-n-play' ? participantId === turnOwnerId : participantId !== turnOwnerId;
}

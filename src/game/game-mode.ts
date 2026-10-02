import type { GameMode } from '@/game/game-types';

export function parseGameMode(value: unknown): GameMode {
  return value === 'pass-n-play' ? 'pass-n-play' : 'classic';
}

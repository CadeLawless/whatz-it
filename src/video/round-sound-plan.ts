export type RoundSoundId =
  | 'get-ready'
  | 'count-3'
  | 'count-2'
  | 'count-1'
  | 'round-start'
  | 'final-tick'
  | 'correct'
  | 'pass'
  | 'flip'
  | 'round-end';

export type RoundSoundPlayerKey =
  | 'get-ready'
  | 'count-3'
  | 'count-2'
  | 'count-1'
  | 'round-start'
  | 'final-tick-a'
  | 'final-tick-b'
  | 'correct'
  | 'pass'
  | 'flip'
  | 'round-end';

export const CRITICAL_ROUND_SOUNDS = [
  'get-ready',
  'count-3',
  'round-start',
] as const satisfies readonly RoundSoundId[];

export const GAMEPLAY_ROUND_SOUNDS = [
  'final-tick',
  'correct',
  'pass',
  'flip',
  'round-end',
] as const satisfies readonly RoundSoundId[];

export function playerKeyForRoundSound(sound: RoundSoundId): RoundSoundPlayerKey {
  return sound === 'final-tick' ? 'final-tick-a' : sound;
}

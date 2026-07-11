export const DEFAULT_ROUND_DURATION = 60;
export const MIN_ROUND_DURATION = 30;
export const MAX_ROUND_DURATION = 300;

export function clampRoundDuration(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_ROUND_DURATION;
  return Math.min(MAX_ROUND_DURATION, Math.max(MIN_ROUND_DURATION, Math.round(value)));
}

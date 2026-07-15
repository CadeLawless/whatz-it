export const DEFAULT_ROUND_DURATION = 60;
export const MIN_ROUND_DURATION = 30;
export const MAX_ROUND_DURATION = 300;

export function clampRoundDuration(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_ROUND_DURATION;
  return Math.min(MAX_ROUND_DURATION, Math.max(MIN_ROUND_DURATION, Math.round(value)));
}

export function parseStoredRoundDuration(value: string | null) {
  if (value === null || value.trim() === '') return DEFAULT_ROUND_DURATION;
  return clampRoundDuration(Number(value));
}

export function formatRoundClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

import AsyncStorage from '@react-native-async-storage/async-storage';

const ROUND_DURATION_KEY = 'goose-what:round-duration';
export const DEFAULT_ROUND_DURATION = 60;
export const MIN_ROUND_DURATION = 30;
export const MAX_ROUND_DURATION = 300;

export async function loadRoundDuration() {
  try {
    const value = Number(await AsyncStorage.getItem(ROUND_DURATION_KEY));
    return clampRoundDuration(value);
  } catch {
    return DEFAULT_ROUND_DURATION;
  }
}

export async function saveRoundDuration(durationSeconds: number) {
  await AsyncStorage.setItem(ROUND_DURATION_KEY, String(clampRoundDuration(durationSeconds)));
}

export function clampRoundDuration(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_ROUND_DURATION;
  return Math.min(MAX_ROUND_DURATION, Math.max(MIN_ROUND_DURATION, Math.round(value)));
}

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clampRoundDuration,
  DEFAULT_ROUND_DURATION,
  parseStoredRoundDuration,
} from '@/game/round-duration';

const ROUND_DURATION_KEY = 'whatz-it:round-duration';

export async function loadRoundDuration() {
  try {
    const value = await AsyncStorage.getItem(ROUND_DURATION_KEY);
    return parseStoredRoundDuration(value);
  } catch {
    return DEFAULT_ROUND_DURATION;
  }
}

export async function saveRoundDuration(durationSeconds: number) {
  await AsyncStorage.setItem(ROUND_DURATION_KEY, String(clampRoundDuration(durationSeconds)));
}

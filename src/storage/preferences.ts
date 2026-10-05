import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseGameMode } from '@/game/game-mode';
import type { GameMode } from '@/game/game-types';

import {
  DEFAULT_ROUND_DURATION,
  parseStoredRoundDuration,
  serializeRoundDurationPreference,
} from '@/game/round-duration';

const ROUND_DURATION_KEY = 'whatz-it:round-duration';
const ROUND_MODE_KEY = 'whatz-it:round-mode';
let modeWriteQueue: Promise<void> = Promise.resolve();

export async function loadRoundMode(): Promise<GameMode> {
  try {
    await modeWriteQueue.catch(() => undefined);
    return parseGameMode(await AsyncStorage.getItem(ROUND_MODE_KEY));
  } catch {
    return 'classic';
  }
}

export function saveRoundMode(mode: GameMode): Promise<void> {
  modeWriteQueue = modeWriteQueue.catch(() => undefined)
    .then(() => AsyncStorage.setItem(ROUND_MODE_KEY, mode));
  return modeWriteQueue;
}

export async function loadRoundDuration() {
  try {
    const value = await AsyncStorage.getItem(ROUND_DURATION_KEY);
    return parseStoredRoundDuration(value);
  } catch {
    return DEFAULT_ROUND_DURATION;
  }
}

export async function saveRoundDuration(durationSeconds: number) {
  await AsyncStorage.setItem(
    ROUND_DURATION_KEY,
    serializeRoundDurationPreference(durationSeconds),
  );
}

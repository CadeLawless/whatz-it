import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GameMode } from '@/game/game-types';

export type VideoPreferences = Record<GameMode, boolean> & { microphone: boolean };
export const DEFAULT_VIDEO_PREFERENCES: VideoPreferences = { classic: true, 'pass-n-play': true, microphone: true };
const STORAGE_KEY = 'whatz-it:video-preferences:v1';
let writes: Promise<void> = Promise.resolve();

export async function loadVideoPreferences(): Promise<VideoPreferences> {
  await writes.catch(() => undefined);
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  try {
    const value = stored ? JSON.parse(stored) : null;
    return {
      classic: typeof value?.classic === 'boolean' ? value.classic : true,
      'pass-n-play': typeof value?.['pass-n-play'] === 'boolean' ? value['pass-n-play'] : true,
      microphone: typeof value?.microphone === 'boolean' ? value.microphone : true,
    };
  } catch {
    return { ...DEFAULT_VIDEO_PREFERENCES };
  }
}

export function saveVideoPreferences(preferences: VideoPreferences): Promise<void> {
  const serialized = JSON.stringify(preferences);
  writes = writes.catch(() => undefined).then(() => AsyncStorage.setItem(STORAGE_KEY, serialized));
  return writes;
}

import AsyncStorage from '@react-native-async-storage/async-storage';

export type FeedbackPreferences = { sound: boolean; haptics: boolean };
export const DEFAULT_FEEDBACK_PREFERENCES: FeedbackPreferences = { sound: true, haptics: true };
const STORAGE_KEY = 'whatz-it:feedback-preferences:v1';
let current = DEFAULT_FEEDBACK_PREFERENCES;
let loaded = false;
let loading: Promise<FeedbackPreferences> | null = null;
let writes: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

// Cue dispatch reads this cached value without storage or a native round trip.
export function getFeedbackPreferences(): FeedbackPreferences { return current; }

export function subscribeToFeedbackPreferences(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(preferences: FeedbackPreferences) {
  current = preferences;
  loaded = true;
  for (const listener of listeners) {
    try { listener(); } catch { /* Feedback consumers must not interrupt saved settings. */ }
  }
}

export async function loadFeedbackPreferences(): Promise<FeedbackPreferences> {
  await writes.catch(() => undefined);
  if (loaded) return current;
  return loading ??= (async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    let value: Partial<FeedbackPreferences> | null = null;
    try { value = stored ? JSON.parse(stored) : null; } catch { /* Use the existing feedback defaults. */ }
    // A saved change made during hydration takes precedence over the old read.
    if (!loaded) publish({
      sound: typeof value?.sound === 'boolean' ? value.sound : true,
      haptics: typeof value?.haptics === 'boolean' ? value.haptics : true,
    });
    return current;
  })().finally(() => { loading = null; });
}

export function saveFeedbackPreferences(preferences: FeedbackPreferences): Promise<void> {
  const next = { ...preferences };
  writes = writes.catch(() => undefined).then(async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    publish(next);
  });
  return writes;
}

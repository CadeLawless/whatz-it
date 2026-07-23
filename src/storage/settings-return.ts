import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_RETURN_DECK_KEY = 'settings-return-deck-id';

export async function saveSettingsReturnDeckId(deckId: string) {
  await AsyncStorage.setItem(SETTINGS_RETURN_DECK_KEY, deckId);
}

export async function clearSettingsReturnDeckId() {
  await AsyncStorage.removeItem(SETTINGS_RETURN_DECK_KEY);
}

export async function consumeSettingsReturnDeckId() {
  let deckId: string | null = null;

  try {
    deckId = await AsyncStorage.getItem(SETTINGS_RETURN_DECK_KEY);
  } finally {
    await clearSettingsReturnDeckId().catch(() => undefined);
  }

  return deckId;
}

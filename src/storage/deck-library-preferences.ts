import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_DECK_LIBRARY_SORT,
  isDeckLibrarySort,
  type DeckLibrarySort,
} from '@/catalog/deck-library-sort';

const PLAY_HISTORY_KEY = 'whatz-it:deck-play-history';
const SORT_KEY = 'whatz-it:deck-library-sort';

export async function loadDeckPlayHistory(): Promise<Record<string, number>> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(PLAY_HISTORY_KEY)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          entry[0] !== '' && typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export async function rememberDeckPlayed(deckId: string, playedAt = Date.now()) {
  const history = await loadDeckPlayHistory();
  history[deckId] = playedAt;
  await AsyncStorage.setItem(PLAY_HISTORY_KEY, JSON.stringify(history));
}

export async function loadDeckLibrarySort(): Promise<DeckLibrarySort> {
  const value = await AsyncStorage.getItem(SORT_KEY).catch(() => null);
  return value && isDeckLibrarySort(value)
    ? value
    : DEFAULT_DECK_LIBRARY_SORT;
}

export async function saveDeckLibrarySort(sort: DeckLibrarySort) {
  await AsyncStorage.setItem(SORT_KEY, sort);
}

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  cardContentKey,
  getRoundCardPool,
  migrateDailyCardMemory,
  parseCardMemory,
  type StoredCardMemory,
} from '@/game/daily-card-memory';
import type { Card, Deck } from '@/types/deck';

const STORAGE_KEY = 'whatz-it:card-memory:v2';
const LEGACY_STORAGE_KEY = 'whatz-it:daily-card-memory:v1';

let memory: StoredCardMemory | null = null;
let loadingPromise: Promise<StoredCardMemory> | null = null;
let saveQueue: Promise<void> = Promise.resolve();

export async function loadRoundCardIds(
  cards: readonly Card[],
  decks: readonly Pick<Deck, 'id' | 'cards'>[],
): Promise<string[]> {
  const currentMemory = await loadMemory(decks);
  return getRoundCardPool(cards, currentMemory, new Set(), Date.now());
}

export function replenishRoundCardIds(
  cards: readonly Card[],
  shownThisRound: ReadonlySet<string>,
): string[] {
  return getRoundCardPool(cards, memory ?? {}, shownThisRound, Date.now());
}

export function rememberCard(card: Pick<Card, 'text' | 'byline'>): void {
  if (!memory) return;
  memory[cardContentKey(card)] = Date.now();
  void persistMemory(memory);
}

async function loadMemory(decks: readonly Pick<Deck, 'id' | 'cards'>[]): Promise<StoredCardMemory> {
  if (memory) return memory;
  if (loadingPromise) return loadingPromise;

  const request = AsyncStorage.getItem(STORAGE_KEY)
    .then(async (storedValue) => {
      if (storedValue !== null) return parseCardMemory(storedValue, Date.now());
      const legacyValue = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      const migrated = migrateDailyCardMemory(legacyValue, decks, new Date());
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    })
    .catch(() => ({} as StoredCardMemory))
    .then((loadedMemory) => {
      memory = loadedMemory;
      return loadedMemory;
    })
    .finally(() => {
      if (loadingPromise === request) loadingPromise = null;
    });
  loadingPromise = request;
  return request;
}

function persistMemory(currentMemory: StoredCardMemory): Promise<void> {
  const snapshot = JSON.stringify(parseCardMemory(JSON.stringify(currentMemory), Date.now()));
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot))
    .catch(() => undefined);
  return saveQueue;
}

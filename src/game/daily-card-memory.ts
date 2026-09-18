import type { Card, Deck } from '@/types/deck';

export const CARD_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000;

export type StoredCardMemory = Record<string, number>;

export function cardContentKey(card: Pick<Card, 'text' | 'byline'>): string {
  return JSON.stringify([card.text, card.byline ?? null]);
}

export function parseCardMemory(storedValue: string | null, now: number): StoredCardMemory {
  if (!storedValue) return {};
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!isRecord(parsed)) return {};
    const active: StoredCardMemory = {};
    for (const [key, seenAt] of Object.entries(parsed)) {
      if (
        isCardContentKey(key) &&
        typeof seenAt === 'number' &&
        Number.isFinite(seenAt) &&
        seenAt <= now &&
        now - seenAt < CARD_COOLDOWN_MS
      ) active[key] = seenAt;
    }
    return active;
  } catch {
    return {};
  }
}

export function getAvailableCardIds(
  cards: readonly Card[],
  memory: Readonly<StoredCardMemory>,
  now: number,
): string[] {
  return cards
    .filter((card) => {
      const seenAt = memory[cardContentKey(card)];
      return seenAt === undefined || now - seenAt >= CARD_COOLDOWN_MS;
    })
    .map((card) => card.id);
}

export function getRoundCardPool(
  cards: readonly Card[],
  memory: Readonly<StoredCardMemory>,
  shownThisRound: ReadonlySet<string>,
  now: number,
): string[] {
  const uniqueCards: Card[] = [];
  const keys = new Set(shownThisRound);
  for (const card of cards) {
    const key = cardContentKey(card);
    if (keys.has(key)) continue;
    keys.add(key);
    uniqueCards.push(card);
  }
  const available = getAvailableCardIds(uniqueCards, memory, now);
  // Once no eligible cards remain, begin a fresh pass through this deck.
  return available.length > 0 ? available : uniqueCards.map((card) => card.id);
}

// The previous release kept only today's card IDs. Preserve those observations
// when upgrading by resolving them against the current catalog content.
export function migrateDailyCardMemory(
  storedValue: string | null,
  decks: readonly Pick<Deck, 'id' | 'cards'>[],
  now: Date,
): StoredCardMemory {
  if (!storedValue) return {};
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!isRecord(parsed) || parsed.day !== localDayKey(now) || !isRecord(parsed.seenCardIdsByDeck)) {
      return {};
    }
    const migrated: StoredCardMemory = {};
    for (const deck of decks) {
      const ids = parsed.seenCardIdsByDeck[deck.id];
      if (!Array.isArray(ids)) continue;
      const seenIds = new Set(ids.filter((id): id is string => typeof id === 'string'));
      for (const card of deck.cards) {
        if (seenIds.has(card.id)) migrated[cardContentKey(card)] = now.getTime();
      }
    }
    return migrated;
  } catch {
    return {};
  }
}

function localDayKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isCardContentKey(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      (parsed[1] === null || typeof parsed[1] === 'string');
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

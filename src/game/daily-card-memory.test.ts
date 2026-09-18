import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CARD_COOLDOWN_MS,
  cardContentKey,
  getAvailableCardIds,
  getRoundCardPool,
  migrateDailyCardMemory,
  parseCardMemory,
} from '@/game/daily-card-memory';

describe('card cooldown memory', () => {
  const now = new Date(2026, 6, 16, 12).getTime();
  const cards = [
    { id: 'one', text: 'Same value' },
    { id: 'two', text: 'Song', byline: 'Artist A' },
    { id: 'three', text: 'Song', byline: 'Artist B' },
    { id: 'four', text: 'Song' },
  ];

  it('hides exact content across card IDs and decks for five full days', () => {
    const memory = { [cardContentKey(cards[0])]: now };
    assert.deepEqual(getAvailableCardIds([{ id: 'other-deck-id', text: 'Same value' }], memory, now + CARD_COOLDOWN_MS - 1), []);
    assert.deepEqual(getAvailableCardIds([{ id: 'other-deck-id', text: 'Same value' }], memory, now + CARD_COOLDOWN_MS), ['other-deck-id']);
  });

  it('requires both the value and byline to match exactly', () => {
    const memory = { [cardContentKey(cards[1])]: now };
    assert.deepEqual(getAvailableCardIds(cards, memory, now + 1), ['one', 'three', 'four']);
    assert.deepEqual(getAvailableCardIds([{ id: 'other-deck', text: 'Song', byline: 'Artist A' }], memory, now + 1), []);
    assert.deepEqual(getAvailableCardIds([{ id: 'case', text: 'Song', byline: 'artist A' }], memory, now + 1), ['case']);
    assert.deepEqual(getAvailableCardIds([{ id: 'spacing', text: 'Song ', byline: 'Artist A' }], memory, now + 1), ['spacing']);
  });

  it('recycles cooling cards only after the eligible pool is exhausted', () => {
    const memory = {
      [cardContentKey(cards[0])]: now,
      [cardContentKey(cards[1])]: now,
    };
    assert.deepEqual(getRoundCardPool(cards, memory, new Set(), now + 1), ['three', 'four']);
    assert.deepEqual(getRoundCardPool(cards, memory, new Set([cardContentKey(cards[2]), cardContentKey(cards[3])]), now + 1), ['one', 'two']);
    assert.deepEqual(getRoundCardPool(cards, memory, new Set(cards.map(cardContentKey)), now + 1), []);
    assert.deepEqual(getRoundCardPool(cards.slice(0, 2), memory, new Set(), now + 1), ['one', 'two']);
    assert.deepEqual(getRoundCardPool([cards[0], { id: 'duplicate', text: cards[0].text }], {}, new Set(), now + 1), ['one']);
  });

  it('keeps only valid, unexpired persisted observations', () => {
    const stored = JSON.stringify({
      [cardContentKey(cards[0])]: now - CARD_COOLDOWN_MS,
      [cardContentKey(cards[1])]: now - CARD_COOLDOWN_MS + 1,
      [cardContentKey(cards[2])]: 'invalid',
      invalid: now,
    });
    assert.deepEqual(parseCardMemory(stored, now), {
      [cardContentKey(cards[1])]: now - CARD_COOLDOWN_MS + 1,
    });
  });

  it('migrates current-day IDs to content shared across decks', () => {
    const legacy = JSON.stringify({
      day: '2026-07-16',
      seenCardIdsByDeck: { first: ['one', 'two'] },
    });
    const decks = [{ id: 'first', cards }, { id: 'second', cards: [{ id: 'elsewhere', text: 'Same value' }] }];
    const migrated = migrateDailyCardMemory(legacy, decks, new Date(2026, 6, 16, 12));
    assert.deepEqual(getAvailableCardIds(decks[1].cards, migrated, now), []);
    assert.deepEqual(migrateDailyCardMemory(legacy, decks, new Date(2026, 6, 17, 12)), {});
  });
});

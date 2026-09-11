import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogDeck } from '@/catalog/catalog-snapshot';

import { captureRoundResultSnapshot } from './round-result-snapshot';

const deck: CatalogDeck = {
  id: 'party',
  order: 1,
  title: 'Party Time',
  description: 'A test deck',
  version: 1,
  access: 'free',
  cards: [
    { id: 'one', text: 'First card', byline: 'Tester' },
    { id: 'two', text: 'Second card' },
  ],
  tags: [],
  cardCount: 2,
  cardContentVersion: 1,
  installationStatus: 'installed',
};

describe('captureRoundResultSnapshot', () => {
  it('stores the played card copy with each result', () => {
    const snapshot = captureRoundResultSnapshot(
      {
        deckId: deck.id,
        durationSeconds: 60,
        results: [
          { cardId: 'one', outcome: 'correct', answeredAt: 1_000 },
          { cardId: 'two', outcome: 'passed', answeredAt: 2_000 },
        ],
      },
      deck,
    );

    assert.deepEqual(snapshot, {
      version: 1,
      deckId: 'party',
      deckTitle: 'Party Time',
      durationSeconds: 60,
      results: [
        {
          cardId: 'one',
          outcome: 'correct',
          answeredAt: 1_000,
          text: 'First card',
          byline: 'Tester',
        },
        {
          cardId: 'two',
          outcome: 'passed',
          answeredAt: 2_000,
          text: 'Second card',
        },
      ],
    });
  });

  it('does not attach results to a different deck', () => {
    assert.equal(
      captureRoundResultSnapshot(
        { deckId: 'different', durationSeconds: 60, results: [] },
        deck,
      ),
      undefined,
    );
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDeckLibrarySections, sortLibraryDecks } from './deck-library-sort';

const decks = [
  { id: 'zoo', title: 'Zoo' },
  { id: 'animals', title: 'Animals' },
  { id: 'movies', title: 'Movies' },
];
const playedAt = { animals: 100, movies: 200 };

describe('My Decks sorting', () => {
  it('defaults played decks to newest first and leaves unplayed decks afterward', () => {
    assert.deepEqual(
      sortLibraryDecks(decks, playedAt, 'recently-played').map(({ id }) => id),
      ['movies', 'animals', 'zoo'],
    );
  });

  it('can put unplayed decks first', () => {
    assert.deepEqual(
      sortLibraryDecks(decks, playedAt, 'unplayed-first').map(({ id }) => id),
      ['zoo', 'movies', 'animals'],
    );
  });

  it('can sort alphabetically', () => {
    assert.deepEqual(
      sortLibraryDecks(decks, playedAt, 'alphabetical').map(({ id }) => id),
      ['animals', 'movies', 'zoo'],
    );
  });

  it('keeps unplayed decks in Deck Manager order after recently played decks', () => {
    assert.deepEqual(
      buildDeckLibrarySections(decks, playedAt, 'recently-played'),
      [{ id: 'all', decks: [decks[2], decks[1], decks[0]] }],
    );
  });

  it('creates Deck Manager ordered unplayed and recency ordered played sections', () => {
    assert.deepEqual(
      buildDeckLibrarySections(decks, playedAt, 'unplayed-first'),
      [
        { id: 'unplayed', title: 'UNPLAYED', decks: [decks[0]] },
        {
          id: 'recently-played',
          title: 'RECENTLY PLAYED',
          decks: [decks[2], decks[1]],
        },
      ],
    );
  });
});

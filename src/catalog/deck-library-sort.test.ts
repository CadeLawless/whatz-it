import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sortLibraryDecks } from './deck-library-sort';

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
});

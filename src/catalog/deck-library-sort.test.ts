import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDeckLibrarySections,
  DECK_LIBRARY_SORTS,
  sortLibraryDecks,
} from './deck-library-sort';

const decks = [
  { id: 'zoo', title: 'Zoo' },
  { id: 'animals', title: 'Animals' },
  { id: 'movies', title: 'Movies' },
];
const playedAt = { animals: 100, movies: 200 };
const purchasedDecks = [
  { id: 'free-new', title: 'Alpha Free', access: 'free' as const, installationStatus: 'installed' as const },
  { id: 'paid-played', title: 'Bravo Paid', access: 'paid' as const, installationStatus: 'installed' as const },
  { id: 'paid-new', title: 'Charlie Paid', access: 'paid' as const, installationStatus: 'installed' as const },
  { id: 'free-played', title: 'Delta Free', access: 'free' as const, installationStatus: 'installed' as const },
];
const purchasedPlayedAt = { 'paid-played': 100, 'free-played': 200 };

describe('My Decks sorting', () => {
  it('orders sort options for the library control', () => {
    assert.deepEqual(DECK_LIBRARY_SORTS, [
      'recently-played',
      'alphabetical',
      'unplayed-first',
    ]);
  });

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

  it('puts purchased unplayed decks first on recency-based sorts', () => {
    assert.deepEqual(
      sortLibraryDecks(purchasedDecks, purchasedPlayedAt, 'recently-played').map(({ id }) => id),
      ['paid-new', 'free-played', 'paid-played', 'free-new'],
    );

    assert.deepEqual(
      sortLibraryDecks(purchasedDecks, purchasedPlayedAt, 'unplayed-first').map(({ id }) => id),
      ['paid-new', 'free-new', 'free-played', 'paid-played'],
    );
  });

  it('keeps alphabetical sorting truly alphabetical', () => {
    assert.deepEqual(
      sortLibraryDecks(purchasedDecks, purchasedPlayedAt, 'alphabetical').map(({ id }) => id),
      ['free-new', 'paid-played', 'paid-new', 'free-played'],
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

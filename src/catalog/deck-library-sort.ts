export type DeckLibrarySort = 'recently-played' | 'unplayed-first' | 'alphabetical';

export const DEFAULT_DECK_LIBRARY_SORT: DeckLibrarySort = 'recently-played';
export const DECK_LIBRARY_SORTS: readonly DeckLibrarySort[] = [
  'recently-played',
  'unplayed-first',
  'alphabetical',
];

export const DECK_LIBRARY_SORT_LABELS: Record<DeckLibrarySort, string> = {
  'recently-played': 'Recently Played',
  'unplayed-first': 'Unplayed First',
  alphabetical: 'Alphabetical',
};

export function isDeckLibrarySort(value: string): value is DeckLibrarySort {
  return DECK_LIBRARY_SORTS.some((sort) => sort === value);
}

type SortableDeck = { id: string; title: string };

export function sortLibraryDecks<T extends SortableDeck>(
  decks: readonly T[],
  playedAt: Readonly<Record<string, number>>,
  sort: DeckLibrarySort,
): T[] {
  return [...decks].sort((left, right) => {
    const leftPlayedAt = playedAt[left.id];
    const rightPlayedAt = playedAt[right.id];

    if (sort === 'alphabetical') return compareDeckTitles(left, right);

    if (sort === 'unplayed-first') {
      const leftUnplayed = leftPlayedAt === undefined;
      const rightUnplayed = rightPlayedAt === undefined;
      if (leftUnplayed !== rightUnplayed) return leftUnplayed ? -1 : 1;
    }

    if (leftPlayedAt !== rightPlayedAt) {
      return (rightPlayedAt ?? Number.NEGATIVE_INFINITY)
        - (leftPlayedAt ?? Number.NEGATIVE_INFINITY);
    }
    return compareDeckTitles(left, right);
  });
}

function compareDeckTitles(left: SortableDeck, right: SortableDeck) {
  return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    || left.id.localeCompare(right.id);
}

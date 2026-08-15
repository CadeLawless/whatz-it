export type DeckLibrarySort = 'recently-played' | 'unplayed-first' | 'alphabetical';

export const DEFAULT_DECK_LIBRARY_SORT: DeckLibrarySort = 'recently-played';
export const DECK_LIBRARY_SORTS: readonly DeckLibrarySort[] = [
  'recently-played',
  'alphabetical',
  'unplayed-first',
];

export const DECK_LIBRARY_SORT_LABELS: Record<DeckLibrarySort, string> = {
  'recently-played': 'Recently Played',
  'unplayed-first': 'Unplayed First',
  alphabetical: 'Alphabetical',
};

export function isDeckLibrarySort(value: string): value is DeckLibrarySort {
  return DECK_LIBRARY_SORTS.some((sort) => sort === value);
}

type SortableDeck = {
  id: string;
  title: string;
  access?: 'free' | 'paid';
  installationStatus?: 'installed' | 'not_owned' | 'pending' | 'failed';
};

export type DeckLibrarySection<T extends SortableDeck> = {
  id: 'all' | 'unplayed' | 'recently-played';
  title?: string;
  decks: T[];
};

export function sortLibraryDecks<T extends SortableDeck>(
  decks: readonly T[],
  playedAt: Readonly<Record<string, number>>,
  sort: DeckLibrarySort,
): T[] {
  return decks
    .map((deck, index) => ({ deck, index }))
    .sort((leftItem, rightItem) => {
      const left = leftItem.deck;
      const right = rightItem.deck;
      const leftPlayedAt = playedAt[left.id];
      const rightPlayedAt = playedAt[right.id];

      if (sort === 'alphabetical') return compareDeckTitles(left, right);

      const leftPurchasedUnplayed = isPurchasedUnplayed(left, playedAt);
      const rightPurchasedUnplayed = isPurchasedUnplayed(right, playedAt);
      if (leftPurchasedUnplayed !== rightPurchasedUnplayed) {
        return leftPurchasedUnplayed ? -1 : 1;
      }

      if (sort === 'unplayed-first') {
        const leftUnplayed = leftPlayedAt === undefined;
        const rightUnplayed = rightPlayedAt === undefined;
        if (leftUnplayed !== rightUnplayed) return leftUnplayed ? -1 : 1;
      }

      if (leftPlayedAt !== rightPlayedAt) {
        return (rightPlayedAt ?? Number.NEGATIVE_INFINITY)
          - (leftPlayedAt ?? Number.NEGATIVE_INFINITY);
      }
      if (leftPlayedAt !== undefined && rightPlayedAt !== undefined) {
        return compareDeckTitles(left, right);
      }
      return leftItem.index - rightItem.index;
    })
    .map(({ deck }) => deck);
}

export function buildDeckLibrarySections<T extends SortableDeck>(
  decks: readonly T[],
  playedAt: Readonly<Record<string, number>>,
  sort: DeckLibrarySort,
): DeckLibrarySection<T>[] {
  if (sort === 'alphabetical') {
    return [{ id: 'all', decks: [...decks].sort(compareDeckTitles) }];
  }

  const unplayed = decks.filter((deck) => playedAt[deck.id] === undefined);
  const recentlyPlayed = decks
    .filter((deck) => playedAt[deck.id] !== undefined)
    .sort((left, right) =>
      (playedAt[right.id] ?? 0) - (playedAt[left.id] ?? 0),
    );

  if (sort === 'recently-played') {
    return [{ id: 'all', decks: [...recentlyPlayed, ...unplayed] }];
  }

  return [
    ...(unplayed.length > 0
      ? [{ id: 'unplayed' as const, title: 'UNPLAYED', decks: unplayed }]
      : []),
    ...(recentlyPlayed.length > 0
      ? [{
          id: 'recently-played' as const,
          title: 'RECENTLY PLAYED',
          decks: recentlyPlayed,
        }]
      : []),
  ];
}

function compareDeckTitles(left: SortableDeck, right: SortableDeck) {
  return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
    || left.id.localeCompare(right.id);
}

function isPurchasedUnplayed(
  deck: SortableDeck,
  playedAt: Readonly<Record<string, number>>,
) {
  return deck.access === 'paid'
    && deck.installationStatus === 'installed'
    && playedAt[deck.id] === undefined;
}

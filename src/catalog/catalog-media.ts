export type CatalogCoverSource = string | number;

export type CatalogCoverRecord = {
  coverImage?: number;
  coverUri?: string;
  coverUrl?: string;
  thumbnailUri?: string;
  thumbnailUrl?: string;
};

export function catalogCoverSources(
  deck: CatalogCoverRecord,
  preference: 'cover' | 'thumbnail' = 'cover',
): CatalogCoverSource[] {
  const ordered =
    preference === 'thumbnail'
      ? [
          deck.thumbnailUri,
          deck.coverUri,
          deck.coverImage,
          deck.thumbnailUrl,
          deck.coverUrl,
        ]
      : [
          deck.coverUri,
          deck.coverImage,
          deck.coverUrl,
          deck.thumbnailUri,
          deck.thumbnailUrl,
        ];

  return ordered.filter(
    (source, index, sources): source is CatalogCoverSource =>
      (typeof source === 'number' || (typeof source === 'string' && source !== '')) &&
      sources.indexOf(source) === index,
  );
}

export function catalogLocalCoverSources(
  deck: CatalogCoverRecord,
  preference: 'cover' | 'thumbnail' = 'cover',
): CatalogCoverSource[] {
  const ordered =
    preference === 'thumbnail'
      ? [deck.thumbnailUri, deck.coverUri, deck.coverImage]
      : [deck.coverUri, deck.coverImage, deck.thumbnailUri];

  return ordered.filter(
    (source, index, sources): source is CatalogCoverSource =>
      (typeof source === 'number' || (typeof source === 'string' && source !== '')) &&
      sources.indexOf(source) === index,
  );
}

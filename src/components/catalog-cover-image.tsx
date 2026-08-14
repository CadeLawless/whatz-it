import { Image, type ImageProps } from 'expo-image';
import { type ReactNode, useState } from 'react';

import {
  catalogCoverSources,
  type CatalogCoverRecord,
} from '@/catalog/catalog-media';

type CatalogCoverImageProps = Omit<ImageProps, 'onError' | 'source'> & {
  deck: CatalogCoverRecord;
  fallback?: ReactNode;
  preference?: 'cover' | 'thumbnail';
};

export function CatalogCoverImage({
  deck,
  fallback = null,
  preference = 'cover',
  ...imageProps
}: CatalogCoverImageProps) {
  const sources = catalogCoverSources(deck, preference);
  const sourceKey = sources.join('|');

  return (
    <CatalogCoverAttempt
      {...imageProps}
      fallback={fallback}
      key={sourceKey}
      sources={sources}
    />
  );
}

function CatalogCoverAttempt({
  fallback,
  sources,
  ...imageProps
}: Omit<ImageProps, 'onError' | 'source'> & {
  fallback: ReactNode;
  sources: ReturnType<typeof catalogCoverSources>;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  if (source === undefined) return fallback;

  return (
    <Image
      {...imageProps}
      onError={() => setSourceIndex((current) => current + 1)}
      source={source}
    />
  );
}

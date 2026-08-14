import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { catalogCoverSources, catalogLocalCoverSources } from './catalog-media';

describe('catalog cover sources', () => {
  it('prefers durable local cover media before its verified remote fallback', () => {
    assert.deepEqual(
      catalogCoverSources({
        coverUri: 'file:///catalog-media/cover.webp',
        coverUrl: 'https://api.example.test/content/covers/cover.webp',
        thumbnailUri: 'file:///catalog-media/thumb.webp',
        thumbnailUrl: 'https://api.example.test/content/thumbnails/thumb.webp',
      }),
      [
        'file:///catalog-media/cover.webp',
        'https://api.example.test/content/covers/cover.webp',
        'file:///catalog-media/thumb.webp',
        'https://api.example.test/content/thumbnails/thumb.webp',
      ],
    );
  });

  it('falls back from an unavailable local source to bundled and remote media', () => {
    assert.deepEqual(
      catalogCoverSources({
        coverImage: 42,
        coverUrl: 'https://api.example.test/content/covers/cover.webp',
      }),
      [42, 'https://api.example.test/content/covers/cover.webp'],
    );
  });
});

describe('local catalog cover sources', () => {
  it('never falls back to a network URL', () => {
    assert.deepEqual(
      catalogLocalCoverSources({
        coverUri: 'file:///cover.webp',
        coverUrl: 'https://example.test/cover.webp',
        thumbnailUrl: 'https://example.test/thumbnail.webp',
      }),
      ['file:///cover.webp'],
    );
  });
});

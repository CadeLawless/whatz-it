import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertAppVersionCompatible,
  assertMonotonicVersions,
  parseCatalogManifest,
  parseDeckContentArtifact,
} from './catalog-wire';

const hash = 'a'.repeat(64);

function manifestFixture() {
  return {
    schemaVersion: 1,
    catalogSchemaVersion: 5,
    catalogRevision: 39,
    updatedAt: '2026-08-12T22:00:00Z',
    minimumAppVersion: null as string | null,
    supportedContentSchemaVersions: [1],
    decks: [
      {
        id: 'starter-deck',
        order: 1,
        title: 'Starter Deck',
        description: 'Available offline after synchronization.',
        tags: ['starter'],
        access: 'free',
        price: null,
        status: 'active',
        deckVersion: 2,
        cardContentVersion: 3,
        cardCount: 1,
        content: {
          hash,
          bytes: 123,
          url: 'https://api.example.test/decks/starter-deck/3',
          protected: false,
        },
        cover: {
          hash,
          bytes: 456,
          url: 'https://api.example.test/content/covers/a.webp',
        },
        thumbnail: {
          hash,
          bytes: 78,
          url: 'https://api.example.test/content/thumbnails/a.webp',
        },
        productIds: { apple: null, google: null },
      },
      {
        id: 'paid-deck',
        order: 1,
        title: 'Paid Deck',
        description: 'Visible but protected.',
        tags: [],
        access: 'paid',
        price: 1.99,
        status: 'active',
        deckVersion: 1,
        cardContentVersion: 1,
        cardCount: 100,
        content: { hash, bytes: 1234, url: null, protected: true },
        cover: {
          hash,
          bytes: 456,
          url: 'https://api.example.test/content/covers/b.webp',
        },
        thumbnail: {
          hash,
          bytes: 78,
          url: 'https://api.example.test/content/thumbnails/b.webp',
        },
        productIds: {
          apple: 'com.cadelawless.whatzit.deck.paid_deck',
          google: null,
        },
      },
    ],
    bundles: [],
    deckOrders: { free: ['starter-deck'], paid: ['paid-deck'] },
  };
}

describe('catalog wire validation', () => {
  it('accepts public free content and protected paid content', () => {
    const manifest = parseCatalogManifest(manifestFixture());
    assert.equal(manifest.catalogRevision, 39);
    assert.equal(manifest.minimumAppVersion, null);
    assert.equal(manifest.decks[0].content.url?.startsWith('https://'), true);
    assert.equal(manifest.decks[1].content.url, null);
    assert.equal(
      manifest.decks[1].productIds.apple,
      'com.cadelawless.whatzit.deck.paid_deck',
    );
  });

  it('validates and enforces an optional minimum app version', () => {
    const fixture = manifestFixture();
    fixture.minimumAppVersion = '1.2.0';
    const manifest = parseCatalogManifest(fixture);

    assert.doesNotThrow(() => assertAppVersionCompatible(manifest, '1.2.0'));
    assert.doesNotThrow(() => assertAppVersionCompatible(manifest, '1.3.0'));
    assert.throws(
      () => assertAppVersionCompatible(manifest, '1.1.9'),
      /older than required version 1.2.0/,
    );

    fixture.minimumAppVersion = 'version-one';
    assert.throws(
      () => parseCatalogManifest(fixture),
      /major\.minor\.patch/,
    );
  });

  it('rejects a public paid card-content URL', () => {
    const fixture = manifestFixture();
    fixture.decks[1].content.url = 'https://api.example.test/paid-content';
    assert.throws(() => parseCatalogManifest(fixture), /must not expose/);
  });

  it('accepts authenticated paid content only in explicit development preview mode', () => {
    const fixture = manifestFixture();
    fixture.decks[1].content.url = 'https://api.example.test/dev-preview/paid-content';
    fixture.decks[1].content.protected = false;
    assert.throws(() => parseCatalogManifest(fixture), /must not expose/);
    const manifest = parseCatalogManifest(fixture, { allowDevelopmentPreview: true });
    assert.equal(manifest.decks[1].content.url, fixture.decks[1].content.url);
  });

  it('rejects incomplete deck ordering', () => {
    const fixture = manifestFixture();
    fixture.deckOrders.free = [];
    assert.throws(() => parseCatalogManifest(fixture), /every active free deck/);
  });

  it('validates card-content identity, version, and count', () => {
    const deck = parseCatalogManifest(manifestFixture()).decks[0];
    const artifact = parseDeckContentArtifact(
      {
        schemaVersion: 1,
        deckId: 'starter-deck',
        cardContentVersion: 3,
        cards: [{ id: 'card-one', text: 'Card one' }],
      },
      deck,
    );
    assert.equal(artifact.cards[0].text, 'Card one');
    assert.throws(
      () =>
        parseDeckContentArtifact(
          {
            schemaVersion: 1,
            deckId: 'starter-deck',
            cardContentVersion: 3,
            cards: [],
          },
          deck,
        ),
      /card count/,
    );
  });

  it('rejects deck or content version regression in a newer catalog', () => {
    const manifest = parseCatalogManifest(manifestFixture());
    assert.throws(
      () =>
        assertMonotonicVersions(
          manifest,
          [{ deck_id: 'starter-deck', deck_version: 3, card_content_version: 3 }],
          [],
        ),
      /older than the local catalog/,
    );
  });
});

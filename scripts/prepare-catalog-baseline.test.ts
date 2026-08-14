import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseCatalogManifest, type DeckContentArtifact } from '../src/catalog/catalog-wire';
import {
  baselineIsCurrent,
  buildBaselineCatalog,
  fetchPreparedBaseline,
  renderBundledCatalogSource,
  writePreparedBaseline,
} from './prepare-catalog-baseline';

const placeholderHash = 'a'.repeat(64);

describe('release catalog baseline preparation', () => {
  it('embeds verified free cards while retaining paid metadata only', () => {
    const manifest = parseCatalogManifest(manifestFixture());
    const artifact = freeArtifact();
    const catalog = buildBaselineCatalog(
      manifest,
      new Map([['starter-deck', artifact]]),
      new Map([['starter-deck', `assets/images/decks/baseline/${placeholderHash}.webp`]]),
    );

    assert.equal(catalog.revision, 41);
    assert.deepEqual(catalog.decks[0].cards, artifact.cards);
    assert.equal(catalog.decks[0].cardCount, 1);
    assert.equal(catalog.decks[0].cardContentVersion, 3);
    assert.equal(catalog.decks[1].access, 'paid');
    assert.equal(catalog.decks[1].cardCount, 100);
    assert.deepEqual(catalog.decks[1].cards, []);
    assert.equal(catalog.decks[1].coverImage, undefined);
    assert.equal(catalog.bundles[0].version, 4);
    assert.equal(JSON.stringify(catalog).includes('protected card text'), false);
  });

  it('rejects any attempt to package paid card content', () => {
    const manifest = parseCatalogManifest(manifestFixture());
    const paidArtifact: DeckContentArtifact = {
      schemaVersion: 1,
      deckId: 'paid-deck',
      cardContentVersion: 8,
      cards: [{ id: 'paid-one', text: 'protected card text' }],
    };
    assert.throws(
      () =>
        buildBaselineCatalog(
          manifest,
          new Map([
            ['starter-deck', freeArtifact()],
            ['paid-deck', paidArtifact],
          ]),
          new Map([
            [
              'starter-deck',
              `assets/images/decks/baseline/${placeholderHash}.webp`,
            ],
          ]),
        ),
      /Paid deck paid-deck must not be included/,
    );
  });

  it('downloads and verifies only public starter artifacts', async () => {
    const contentBytes = new TextEncoder().encode(JSON.stringify(freeArtifact()));
    const coverBytes = webpFixture();
    const fixture = manifestFixture();
    fixture.decks[0].content.hash = sha256(contentBytes);
    fixture.decks[0].content.bytes = contentBytes.byteLength;
    fixture.decks[0].cover.hash = sha256(coverBytes);
    fixture.decks[0].cover.bytes = coverBytes.byteLength;
    const requested: string[] = [];
    const request = (async (input: URL | RequestInfo) => {
      const url = String(input);
      requested.push(url);
      if (url === 'https://api.example.test/manifest') {
        return Response.json(fixture);
      }
      if (url === fixture.decks[0].content.url) return new Response(contentBytes);
      if (url === fixture.decks[0].cover.url) return new Response(coverBytes);
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    const prepared = await fetchPreparedBaseline(
      'https://api.example.test/manifest',
      request,
    );

    assert.equal(prepared.catalog.decks[0].cards.length, 1);
    assert.equal(prepared.catalog.decks[1].cards.length, 0);
    assert.equal(prepared.covers.size, 1);
    assert.equal(requested.length, 3);
    assert.equal(requested.some((url) => url.includes('paid-content')), false);
  });

  it('rejects an artifact whose bytes do not match its manifest hash', async () => {
    const contentBytes = new TextEncoder().encode(JSON.stringify(freeArtifact()));
    const coverBytes = webpFixture();
    const fixture = manifestFixture();
    fixture.decks[0].content.bytes = contentBytes.byteLength;
    fixture.decks[0].cover.hash = sha256(coverBytes);
    fixture.decks[0].cover.bytes = coverBytes.byteLength;
    const request = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url === 'https://api.example.test/manifest') return Response.json(fixture);
      if (url === fixture.decks[0].content.url) return new Response(contentBytes);
      if (url === fixture.decks[0].cover.url) return new Response(coverBytes);
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      fetchPreparedBaseline('https://api.example.test/manifest', request),
      /failed SHA-256 verification/,
    );
  });

  it('renders deterministically and writes covers before marking the source current', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'whatzit-baseline-'));
    try {
      await mkdir(join(repositoryRoot, 'src/data'), { recursive: true });
      const source = sourceFixture();
      await writeFile(join(repositoryRoot, 'src/data/bundles.ts'), source);
      const catalog = buildBaselineCatalog(
        parseCatalogManifest(manifestFixture()),
        new Map([['starter-deck', freeArtifact()]]),
        new Map([['starter-deck', `assets/images/decks/baseline/${placeholderHash}.webp`]]),
      );
      const prepared = {
        catalog,
        covers: new Map([
          [`assets/images/decks/baseline/${placeholderHash}.webp`, webpFixture()],
        ]),
      };
      const obsoleteCover = join(
        repositoryRoot,
        'assets/images/decks/baseline',
        `${'b'.repeat(64)}.webp`,
      );
      await mkdir(join(repositoryRoot, 'assets/images/decks/baseline'), {
        recursive: true,
      });
      await writeFile(obsoleteCover, webpFixture());

      const rendered = renderBundledCatalogSource(source, catalog);
      assert.equal(renderBundledCatalogSource(rendered, catalog), rendered);
      assert.match(rendered, /require\("\.\.\/\.\.\/assets\/images\/decks\/baseline\//);
      assert.equal(rendered.includes('paid-content'), false);
      assert.equal(await baselineIsCurrent(repositoryRoot, prepared), false);

      await writePreparedBaseline(repositoryRoot, prepared);

      assert.equal(await baselineIsCurrent(repositoryRoot, prepared), true);
      await assert.rejects(stat(obsoleteCover), { code: 'ENOENT' });
      assert.equal(
        new Uint8Array(
          await readFile(
            join(
              repositoryRoot,
              'assets/images/decks/baseline',
              `${placeholderHash}.webp`,
            ),
          ),
        ).byteLength,
        webpFixture().byteLength,
      );
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });
});

function manifestFixture() {
  return {
    schemaVersion: 1,
    catalogSchemaVersion: 5,
    catalogRevision: 41,
    updatedAt: '2026-08-13T17:00:00Z',
    supportedContentSchemaVersions: [1],
    decks: [
      {
        id: 'starter-deck',
        order: 1,
        title: 'Starter Deck',
        description: 'Ships with the app.',
        tags: ['starter'],
        access: 'free' as const,
        price: null,
        status: 'active' as const,
        deckVersion: 7,
        cardContentVersion: 3,
        cardCount: 1,
        content: {
          hash: placeholderHash,
          bytes: 123,
          url: 'https://api.example.test/content/starter-deck.json',
          protected: false,
        },
        cover: {
          hash: placeholderHash,
          bytes: 456,
          url: 'https://api.example.test/content/starter-deck.webp',
        },
        thumbnail: {
          hash: placeholderHash,
          bytes: 78,
          url: 'https://api.example.test/content/starter-deck-thumbnail.webp',
        },
        productIds: { apple: null, google: null },
      },
      {
        id: 'paid-deck',
        order: 1,
        title: 'Paid Deck',
        description: 'Metadata remains browsable.',
        tags: ['premium'],
        access: 'paid' as const,
        price: 1.99,
        status: 'active' as const,
        deckVersion: 9,
        cardContentVersion: 8,
        cardCount: 100,
        content: {
          hash: placeholderHash,
          bytes: 1234,
          url: null,
          protected: true,
        },
        cover: {
          hash: placeholderHash,
          bytes: 456,
          url: 'https://api.example.test/content/paid-deck.webp',
        },
        thumbnail: {
          hash: placeholderHash,
          bytes: 78,
          url: 'https://api.example.test/content/paid-deck-thumbnail.webp',
        },
        productIds: {
          apple: 'com.cadelawless.whatzit.deck.paid_deck',
          google: null,
        },
      },
    ],
    bundles: [
      {
        id: 'all-decks',
        order: 1,
        title: 'All Decks',
        description: 'A mixed bundle.',
        access: 'paid' as const,
        price: 2.99,
        status: 'active' as const,
        bundleVersion: 4,
        deckIds: ['starter-deck', 'paid-deck'],
        productIds: {
          apple: 'com.cadelawless.whatzit.bundle.all_decks',
          google: null,
        },
      },
    ],
    deckOrders: { free: ['starter-deck'], paid: ['paid-deck'] },
  };
}

function freeArtifact(): DeckContentArtifact {
  return {
    schemaVersion: 1,
    deckId: 'starter-deck',
    cardContentVersion: 3,
    cards: [{ id: 'starter-one', text: 'Starter card text' }],
  };
}

function webpFixture() {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
}

function sourceFixture() {
  return `const bundleCatalog =\n/* DECK_MANAGER_CATALOG_START */\n{}\n/* DECK_MANAGER_CATALOG_END */;\nconst deckCoverImages =\n/* DECK_MANAGER_COVERS_START */\n{}\n/* DECK_MANAGER_COVERS_END */;\n`;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

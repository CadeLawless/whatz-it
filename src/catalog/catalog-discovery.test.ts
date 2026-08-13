import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, it } from 'node:test';

import {
  MemoryCatalogDiscoveryRepository,
  SqliteCatalogDiscoveryRepository,
  type CatalogDeckCursor,
  type CatalogDeckPage,
  type CatalogDeckSummary,
  type CatalogBundleSummary,
} from './catalog-discovery';
import { catalogSchemaSqlForTests } from './catalog-schema';

const fixtureDecks: CatalogDeckSummary[] = [
  deck('alpha', 'Alpha', 'A literal 100% party.', 'free', 'installed', ['party', 'family']),
  deck('alpha-two', 'alpha', 'Same title for cursor testing.', 'paid', 'not_owned', ['party']),
  deck('faith', 'Faith Stories', 'Stories for everyone.', 'paid', 'not_owned', ['faith', 'family']),
  deck('movie', 'Movie Night', 'Cinema favorites.', 'free', 'installed', ['movies', 'family']),
  deck('voices', 'Voices', 'Accents and impressions.', 'paid', 'not_owned', ['voices']),
];
const fixtureBundles: CatalogBundleSummary[] = [
  {
    id: 'family-pack',
    title: 'Family Pack',
    description: 'Play together.',
    access: 'paid',
    price: 3.99,
    bundleVersion: 1,
    deckIds: ['faith', 'movie'],
  },
  {
    id: 'party-pack',
    title: 'Party Pack',
    description: 'Party favorites.',
    access: 'free',
    bundleVersion: 1,
    deckIds: ['alpha', 'voices'],
  },
];

describe('local catalog discovery', () => {
  it('pages deterministically without duplicates when titles are equal', async () => {
    await withRepositories(async (repository) => {
      const first = await repository.queryDecks({ limit: 1 });
      const second = await repository.queryDecks({ limit: 1, after: first.nextCursor! });
      assert.deepEqual(first.decks.map(({ id }) => id), ['alpha']);
      assert.deepEqual(second.decks.map(({ id }) => id), ['alpha-two']);
      assert.notEqual(first.nextCursor, null);
      assert.notEqual(second.nextCursor, null);
    });
  });

  it('searches title, description, and tags while treating wildcards literally', async () => {
    await withRepositories(async (repository) => {
      assert.deepEqual(
        (await repository.queryDecks({ search: 'cinema' })).decks.map(({ id }) => id),
        ['movie'],
      );
      assert.deepEqual(
        (await repository.queryDecks({ search: 'faith' })).decks.map(({ id }) => id),
        ['faith'],
      );
      assert.deepEqual(
        (await repository.queryDecks({ search: '%' })).decks.map(({ id }) => id),
        ['alpha'],
      );
    });
  });

  it('composes access, installation, and exact tag filters', async () => {
    await withRepositories(async (repository) => {
      const allTags = await repository.queryDecks({
        access: 'paid',
        installationStatus: 'not_owned',
        tags: ['family', 'faith'],
      });
      assert.deepEqual(allTags.decks.map(({ id }) => id), ['faith']);

      const anyTag = await repository.queryDecks({
        tags: ['movies', 'voices'],
        tagMode: 'any',
      });
      assert.deepEqual(anyTag.decks.map(({ id }) => id), ['movie', 'voices']);
    });
  });

  it('returns normalized tag facets and optional access counts', async () => {
    await withRepositories(async (repository) => {
      assert.deepEqual(await repository.listTags('free'), [
        { tag: 'family', deckCount: 2 },
        { tag: 'movies', deckCount: 1 },
        { tag: 'party', deckCount: 1 },
      ]);
    });
  });

  it('pages bundles and searches their member deck metadata', async () => {
    await withRepositories(async (repository) => {
      const first = await repository.queryBundles({ limit: 1 });
      const second = await repository.queryBundles({
        limit: 1,
        after: first.nextCursor!,
      });
      assert.deepEqual(first.bundles.map(({ id }) => id), ['family-pack']);
      assert.deepEqual(second.bundles.map(({ id }) => id), ['party-pack']);
      assert.deepEqual(
        (await repository.queryBundles({ search: 'voices' })).bundles.map(
          ({ id }) => id,
        ),
        ['party-pack'],
      );
    });
  });

  it('pages a thousand-deck catalog without gaps or duplicates', async () => {
    const largeCatalog = Array.from({ length: 1_000 }, (_, index) =>
      deck(
        `deck-${index.toString().padStart(4, '0')}`,
        `Catalog Deck ${(index % 50).toString().padStart(2, '0')}`,
        `Synthetic deck ${index}`,
        index % 3 === 0 ? 'free' : 'paid',
        index % 3 === 0 ? 'installed' : 'not_owned',
        [index % 2 === 0 ? 'even' : 'odd', `group-${index % 10}`],
      ),
    );
    await withCatalog(largeCatalog, [], async (repository) => {
      const ids: string[] = [];
      let after: CatalogDeckCursor | undefined;
      do {
        const page: CatalogDeckPage = await repository.queryDecks({ limit: 37, after });
        assert.equal(page.decks.length <= 37, true);
        ids.push(...page.decks.map(({ id }) => id));
        after = page.nextCursor ?? undefined;
      } while (after);
      assert.equal(ids.length, 1_000);
      assert.equal(new Set(ids).size, 1_000);

      const evenIds: string[] = [];
      after = undefined;
      do {
        const page: CatalogDeckPage = await repository.queryDecks({
          tags: ['even'],
          limit: 100,
          after,
        });
        evenIds.push(...page.decks.map(({ id }) => id));
        after = page.nextCursor ?? undefined;
      } while (after);
      assert.equal(evenIds.length, 500);
      assert.equal(new Set(evenIds).size, 500);
    });
  });
});

async function withRepositories(
  operation: (
    repository:
      | MemoryCatalogDiscoveryRepository
      | SqliteCatalogDiscoveryRepository,
  ) => Promise<void>,
) {
  return withCatalog(fixtureDecks, fixtureBundles, operation);
}

async function withCatalog(
  decks: CatalogDeckSummary[],
  bundles: CatalogBundleSummary[],
  operation: (
    repository:
      | MemoryCatalogDiscoveryRepository
      | SqliteCatalogDiscoveryRepository,
  ) => Promise<void>,
) {
  await operation(new MemoryCatalogDiscoveryRepository(decks, bundles));
  const database = createDatabase(decks, bundles);
  try {
    await operation(
      new SqliteCatalogDiscoveryRepository({
        getAllAsync: async <T>(sql: string, parameters: SQLInputValue[] = []) =>
          database.prepare(sql).all(...parameters) as T[],
      } as never),
    );
  } finally {
    database.close();
  }
}

function createDatabase(
  decks: CatalogDeckSummary[] = fixtureDecks,
  bundles: CatalogBundleSummary[] = fixtureBundles,
) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(catalogSchemaSqlForTests);
  for (const item of decks) {
    database
      .prepare(
        `INSERT INTO decks (
          deck_id, deck_version, card_content_version, title, description,
          access, price_minor_units, tags_json, card_count, cover_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.deckVersion,
        item.cardContentVersion,
        item.title,
        item.description,
        item.access,
        item.price ? Math.round(item.price * 100) : null,
        JSON.stringify(item.tags),
        item.cardCount,
        item.coverPath ?? null,
      );
    database
      .prepare(
        `INSERT INTO deck_installations (
          deck_id, ownership_source, desired_content_version,
          installed_content_version, status
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.access === 'free' ? 'free' : 'none',
        item.cardContentVersion,
        item.installationStatus === 'installed' ? item.cardContentVersion : null,
        item.installationStatus,
      );
  }
  for (const bundle of bundles) {
    database
      .prepare(
        `INSERT INTO bundles (
          bundle_id, bundle_version, title, description, access,
          price_minor_units, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        bundle.id,
        bundle.bundleVersion,
        bundle.title,
        bundle.description,
        bundle.access,
        bundle.price ? Math.round(bundle.price * 100) : null,
        bundles.indexOf(bundle),
      );
    for (const [position, deckId] of bundle.deckIds.entries()) {
      database
        .prepare(
          'INSERT INTO bundle_decks (bundle_id, deck_id, position) VALUES (?, ?, ?)',
        )
        .run(bundle.id, deckId, position);
    }
  }
  return database;
}

function deck(
  id: string,
  title: string,
  description: string,
  access: 'free' | 'paid',
  installationStatus: 'installed' | 'not_owned',
  tags: string[],
): CatalogDeckSummary {
  return {
    id,
    title,
    description,
    deckVersion: 1,
    access,
    ...(access === 'paid' ? { price: 1.99 } : {}),
    tags,
    cardCount: 10,
    cardContentVersion: 1,
    installationStatus,
  };
}

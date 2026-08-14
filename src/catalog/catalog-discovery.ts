import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

import type { DeckAccess } from '@/types/deck';

import type { CatalogDeck } from './catalog-snapshot';
import { configuredCatalogSource, type CatalogRuntimeSource } from './catalog-feature';
import { openCatalogDatabase } from './catalog-database';

export type CatalogInstallationStatus = CatalogDeck['installationStatus'];

export type CatalogDeckSummary = Omit<CatalogDeck, 'cards' | 'order' | 'version'> & {
  deckVersion: number;
  thumbnailUri?: string;
};

export type CatalogDeckCursor = {
  title: string;
  deckId: string;
};

export type CatalogDeckQuery = {
  search?: string;
  access?: DeckAccess;
  installationStatus?: CatalogInstallationStatus;
  tags?: string[];
  tagMode?: 'all' | 'any';
  limit?: number;
  after?: CatalogDeckCursor;
};

export type CatalogDeckPage = {
  decks: CatalogDeckSummary[];
  nextCursor: CatalogDeckCursor | null;
};

export type CatalogTagFacet = {
  tag: string;
  deckCount: number;
};

export type CatalogBundleSummary = {
  id: string;
  title: string;
  description: string;
  access: DeckAccess;
  price?: number;
  bundleVersion: number;
  deckIds: string[];
};

export type CatalogBundleCursor = { title: string; bundleId: string };

export type CatalogBundleQuery = {
  search?: string;
  access?: DeckAccess;
  limit?: number;
  after?: CatalogBundleCursor;
};

export type CatalogBundlePage = {
  bundles: CatalogBundleSummary[];
  nextCursor: CatalogBundleCursor | null;
};

export interface CatalogDiscoveryRepository {
  queryDecks(query?: CatalogDeckQuery): Promise<CatalogDeckPage>;
  queryBundles(query?: CatalogBundleQuery): Promise<CatalogBundlePage>;
  listTags(access?: DeckAccess): Promise<CatalogTagFacet[]>;
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

export class SqliteCatalogDiscoveryRepository
  implements CatalogDiscoveryRepository
{
  public constructor(
    private readonly database: Pick<SQLiteDatabase, 'getAllAsync'>,
  ) {}

  async queryDecks(query: CatalogDeckQuery = {}): Promise<CatalogDeckPage> {
    const normalized = normalizeQuery(query);
    const filters: string[] = ["d.lifecycle_status = 'active'"];
    const parameters: SQLiteBindValue[] = [];

    if (normalized.search) {
      const search = `%${escapeLike(normalized.search)}%`;
      filters.push(`(
        d.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        d.description LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        EXISTS (
          SELECT 1 FROM json_each(d.tags_json) search_tag
          WHERE CAST(search_tag.value AS TEXT) LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
      )`);
      parameters.push(search, search, search);
    }
    if (normalized.access) {
      filters.push('d.access = ?');
      parameters.push(normalized.access);
    }
    if (normalized.installationStatus) {
      filters.push('i.status = ?');
      parameters.push(normalized.installationStatus);
    }
    if (normalized.tags.length > 0) {
      if (normalized.tagMode === 'all') {
        for (const tag of normalized.tags) {
          filters.push(`EXISTS (
            SELECT 1 FROM json_each(d.tags_json) filter_tag
            WHERE lower(CAST(filter_tag.value AS TEXT)) = ?
          )`);
          parameters.push(tag);
        }
      } else {
        filters.push(`EXISTS (
          SELECT 1 FROM json_each(d.tags_json) filter_tag
          WHERE lower(CAST(filter_tag.value AS TEXT)) IN (${placeholders(normalized.tags.length)})
        )`);
        parameters.push(...normalized.tags);
      }
    }
    if (normalized.after) {
      filters.push(`(
        d.title > ? COLLATE NOCASE OR
        (d.title = ? COLLATE NOCASE AND d.deck_id > ?)
      )`);
      parameters.push(
        normalized.after.title,
        normalized.after.title,
        normalized.after.deckId,
      );
    }

    parameters.push(normalized.limit + 1);
    const rows = await this.database.getAllAsync<DeckSummaryRow>(
      `SELECT d.deck_id, d.deck_version, d.card_content_version,
              d.title, d.description, d.access, d.price_minor_units,
              d.tags_json, d.card_count, d.cover_path, d.cover_url,
              d.thumbnail_url,
              i.status AS installation_status,
              cover_media.local_uri AS cover_uri,
              thumbnail_media.local_uri AS thumbnail_uri
         FROM decks d
         JOIN deck_installations i ON i.deck_id = d.deck_id
         LEFT JOIN media_files cover_media
           ON cover_media.content_hash = d.cover_hash
          AND cover_media.status = 'ready'
         LEFT JOIN media_files thumbnail_media
           ON thumbnail_media.content_hash = d.thumbnail_hash
          AND thumbnail_media.status = 'ready'
        WHERE ${filters.join('\n AND ')}
        ORDER BY d.title COLLATE NOCASE, d.deck_id
        LIMIT ?`,
      parameters,
    );
    const hasMore = rows.length > normalized.limit;
    const pageRows = hasMore ? rows.slice(0, normalized.limit) : rows;
    const decks = pageRows.map(toDeckSummary);
    const last = pageRows.at(-1);
    return {
      decks,
      nextCursor:
        hasMore && last ? { title: last.title, deckId: last.deck_id } : null,
    };
  }

  async listTags(access?: DeckAccess): Promise<CatalogTagFacet[]> {
    const parameters: SQLiteBindValue[] = [];
    const accessFilter = access ? 'AND d.access = ?' : '';
    if (access) parameters.push(access);
    const rows = await this.database.getAllAsync<TagFacetRow>(
      `SELECT lower(trim(CAST(tag.value AS TEXT))) AS tag,
              COUNT(DISTINCT d.deck_id) AS deck_count
         FROM decks d, json_each(d.tags_json) tag
        WHERE d.lifecycle_status = 'active'
          AND trim(CAST(tag.value AS TEXT)) <> ''
          ${accessFilter}
        GROUP BY lower(trim(CAST(tag.value AS TEXT)))
        ORDER BY tag COLLATE NOCASE`,
      parameters,
    );
    return rows.map((row) => ({
      tag: row.tag,
      deckCount: Number(row.deck_count),
    }));
  }

  async queryBundles(query: CatalogBundleQuery = {}): Promise<CatalogBundlePage> {
    const limit = normalizeLimit(query.limit);
    const search = query.search?.trim().toLocaleLowerCase() ?? '';
    const filters: string[] = ["b.lifecycle_status = 'active'"];
    const parameters: SQLiteBindValue[] = [];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(`(
        b.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        b.description LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        EXISTS (
          SELECT 1
            FROM bundle_decks search_membership
            JOIN decks search_deck
              ON search_deck.deck_id = search_membership.deck_id
           WHERE search_membership.bundle_id = b.bundle_id
             AND search_deck.lifecycle_status = 'active'
             AND (
               search_deck.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR
               EXISTS (
                 SELECT 1 FROM json_each(search_deck.tags_json) search_tag
                 WHERE CAST(search_tag.value AS TEXT)
                   LIKE ? ESCAPE '\\' COLLATE NOCASE
               )
             )
        )
      )`);
      parameters.push(pattern, pattern, pattern, pattern);
    }
    if (query.access) {
      filters.push('b.access = ?');
      parameters.push(query.access);
    }
    if (query.after) {
      filters.push(`(
        b.title > ? COLLATE NOCASE OR
        (b.title = ? COLLATE NOCASE AND b.bundle_id > ?)
      )`);
      parameters.push(query.after.title, query.after.title, query.after.bundleId);
    }
    parameters.push(limit + 1);
    const rows = await this.database.getAllAsync<BundleSummaryRow>(
      `SELECT b.bundle_id, b.bundle_version, b.title, b.description,
              b.access, b.price_minor_units
         FROM bundles b
        WHERE ${filters.join('\n AND ')}
        ORDER BY b.title COLLATE NOCASE, b.bundle_id
        LIMIT ?`,
      parameters,
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const memberships = new Map<string, string[]>();
    if (pageRows.length > 0) {
      const membershipRows = await this.database.getAllAsync<BundleMembershipRow>(
        `SELECT bundle_id, deck_id
           FROM bundle_decks
          WHERE bundle_id IN (${placeholders(pageRows.length)})
          ORDER BY bundle_id, position`,
        pageRows.map((row) => row.bundle_id),
      );
      for (const row of membershipRows) {
        const deckIds = memberships.get(row.bundle_id) ?? [];
        deckIds.push(row.deck_id);
        memberships.set(row.bundle_id, deckIds);
      }
    }
    const bundles = pageRows.map((row) => ({
      id: row.bundle_id,
      title: row.title,
      description: row.description,
      access: row.access,
      ...(row.price_minor_units === null
        ? {}
        : { price: row.price_minor_units / 100 }),
      bundleVersion: row.bundle_version,
      deckIds: memberships.get(row.bundle_id) ?? [],
    }));
    const last = pageRows.at(-1);
    return {
      bundles,
      nextCursor:
        hasMore && last
          ? { title: last.title, bundleId: last.bundle_id }
          : null,
    };
  }
}

export class MemoryCatalogDiscoveryRepository
  implements CatalogDiscoveryRepository
{
  public constructor(
    private readonly decks: CatalogDeckSummary[],
    private readonly bundles: CatalogBundleSummary[] = [],
  ) {}

  async queryDecks(query: CatalogDeckQuery = {}): Promise<CatalogDeckPage> {
    return queryCatalogDecksInMemory(this.decks, query);
  }

  async listTags(access?: DeckAccess): Promise<CatalogTagFacet[]> {
    const counts = new Map<string, number>();
    for (const deck of this.decks) {
      if (access && deck.access !== access) continue;
      for (const tag of new Set(deck.tags.map(normalizeTag).filter(Boolean))) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([tag, deckCount]) => ({ tag, deckCount }))
      .sort((left, right) => compareText(left.tag, right.tag));
  }

  async queryBundles(query: CatalogBundleQuery = {}): Promise<CatalogBundlePage> {
    const search = query.search?.trim().toLocaleLowerCase() ?? '';
    const decksById = new Map(this.decks.map((deck) => [deck.id, deck]));
    const matches = this.bundles
      .filter((bundle) => {
        if (query.access && bundle.access !== query.access) return false;
        if (search) {
          const memberMetadata = bundle.deckIds.flatMap((deckId) => {
            const deck = decksById.get(deckId);
            return deck ? [deck.title, ...deck.tags] : [];
          });
          if (
            ![bundle.title, bundle.description, ...memberMetadata]
              .join('\n')
              .toLocaleLowerCase()
              .includes(search)
          ) {
            return false;
          }
        }
        if (query.after && compareBundleCursor(bundle, query.after) <= 0) {
          return false;
        }
        return true;
      })
      .sort(
        (left, right) =>
          compareText(left.title, right.title) || left.id.localeCompare(right.id),
      );
    const limit = normalizeLimit(query.limit);
    const page = matches.slice(0, limit);
    const last = page.at(-1);
    return {
      bundles: page,
      nextCursor:
        matches.length > limit && last
          ? { title: last.title, bundleId: last.id }
          : null,
    };
  }
}

export async function createCatalogDiscoveryRepository(
  source: CatalogRuntimeSource = configuredCatalogSource(),
): Promise<CatalogDiscoveryRepository> {
  if (source === 'sqlite') {
    return new SqliteCatalogDiscoveryRepository(await openCatalogDatabase());
  }
  const { BundledCatalogRepository } = await import('./catalog-repository');
  const snapshot = await new BundledCatalogRepository().load();
  return new MemoryCatalogDiscoveryRepository(
    snapshot.decks.map(({ cards: _cards, order: _order, version, ...deck }) => ({
      ...deck,
      deckVersion: version,
    })),
    snapshot.bundles.map(({ decks: _decks, deckIds, version, order: _order, ...bundle }) => ({
      ...bundle,
      bundleVersion: version,
      deckIds: [...deckIds],
    })),
  );
}

export function queryCatalogDecksInMemory(
  decks: CatalogDeckSummary[],
  query: CatalogDeckQuery = {},
): CatalogDeckPage {
  const normalized = normalizeQuery(query);
  const matches = decks
    .filter((deck) => {
      if (normalized.access && deck.access !== normalized.access) return false;
      if (
        normalized.installationStatus &&
        deck.installationStatus !== normalized.installationStatus
      ) {
        return false;
      }
      if (normalized.search) {
        const haystack = [deck.title, deck.description, ...deck.tags]
          .join('\n')
          .toLocaleLowerCase();
        if (!haystack.includes(normalized.search)) return false;
      }
      if (normalized.tags.length > 0) {
        const tags = new Set(deck.tags.map(normalizeTag));
        const matchingTags = normalized.tags.filter((tag) => tags.has(tag));
        if (
          normalized.tagMode === 'all'
            ? matchingTags.length !== normalized.tags.length
            : matchingTags.length === 0
        ) {
          return false;
        }
      }
      if (normalized.after && compareCursor(deck, normalized.after) <= 0) {
        return false;
      }
      return true;
    })
    .sort(compareDecks);
  const page = matches.slice(0, normalized.limit);
  const last = page.at(-1);
  return {
    decks: page,
    nextCursor:
      matches.length > normalized.limit && last
        ? { title: last.title, deckId: last.id }
        : null,
  };
}

function normalizeQuery(query: CatalogDeckQuery) {
  const tags = [...new Set((query.tags ?? []).map(normalizeTag).filter(Boolean))];
  return {
    search: query.search?.trim().toLocaleLowerCase() ?? '',
    access: query.access,
    installationStatus: query.installationStatus,
    tags,
    tagMode: query.tagMode ?? ('all' as const),
    limit: normalizeLimit(query.limit),
    after: query.after,
  };
}

function toDeckSummary(row: DeckSummaryRow): CatalogDeckSummary {
  return {
    id: row.deck_id,
    title: row.title,
    description: row.description,
    deckVersion: row.deck_version,
    access: row.access,
    ...(row.price_minor_units === null
      ? {}
      : { price: row.price_minor_units / 100 }),
    tags: parseTags(row.tags_json),
    cardCount: row.card_count,
    cardContentVersion: row.card_content_version,
    ...(row.cover_path ? { coverPath: row.cover_path } : {}),
    ...(row.cover_uri ? { coverUri: row.cover_uri } : {}),
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    ...(row.thumbnail_uri ? { thumbnailUri: row.thumbnail_uri } : {}),
    ...(row.thumbnail_url ? { thumbnailUrl: row.thumbnail_url } : {}),
    installationStatus: row.installation_status,
  };
}

function parseTags(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (Array.isArray(parsed) && parsed.every((tag) => typeof tag === 'string')) {
    return parsed;
  }
  throw new Error('The local catalog contains invalid deck tags.');
}

function normalizeTag(tag: string) {
  return tag.trim().toLocaleLowerCase();
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function compareDecks(left: CatalogDeckSummary, right: CatalogDeckSummary) {
  return compareText(left.title, right.title) || left.id.localeCompare(right.id);
}

function compareCursor(deck: CatalogDeckSummary, cursor: CatalogDeckCursor) {
  return compareText(deck.title, cursor.title) || deck.id.localeCompare(cursor.deckId);
}

function compareBundleCursor(
  bundle: CatalogBundleSummary,
  cursor: CatalogBundleCursor,
) {
  return compareText(bundle.title, cursor.title) || bundle.id.localeCompare(cursor.bundleId);
}

function normalizeLimit(limit?: number) {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit ?? DEFAULT_PAGE_SIZE)));
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

type DeckSummaryRow = {
  deck_id: string;
  deck_version: number;
  card_content_version: number;
  title: string;
  description: string;
  access: DeckAccess;
  price_minor_units: number | null;
  tags_json: string;
  card_count: number;
  cover_path: string | null;
  cover_url: string | null;
  installation_status: CatalogInstallationStatus;
  cover_uri: string | null;
  thumbnail_url: string | null;
  thumbnail_uri: string | null;
};

type TagFacetRow = { tag: string; deck_count: number };
type BundleSummaryRow = {
  bundle_id: string;
  bundle_version: number;
  title: string;
  description: string;
  access: DeckAccess;
  price_minor_units: number | null;
};
type BundleMembershipRow = { bundle_id: string; deck_id: string };

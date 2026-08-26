import type { SQLiteDatabase } from 'expo-sqlite';

import {
  bundledCatalog,
  decks as bundledDecks,
} from '@/data/bundles';
import type { Card, DeckAccess } from '@/types/deck';

import { configuredCatalogSource } from './catalog-feature';
import { openCatalogDatabase } from './catalog-database';
import { INSTALLED_CARD_ROWS_SQL } from './catalog-queries';
import {
  buildCatalogSnapshot,
  type CatalogDeck,
  type CatalogSnapshot,
} from './catalog-snapshot';

export type { CatalogBundle, CatalogDeck, CatalogSnapshot } from './catalog-snapshot';

export interface CatalogRepository {
  load(): Promise<CatalogSnapshot>;
}

export class BundledCatalogRepository implements CatalogRepository {
  async load() {
    const metadataById = new Map(
      bundledCatalog.decks.map((deck) => [deck.id, deck]),
    );
    const decks: CatalogDeck[] = bundledDecks.map((deck) => {
      const metadata = metadataById.get(deck.id);
      return {
        ...deck,
        tags: [...(metadata?.tags ?? [])],
        cardCount: metadata?.cardCount ?? deck.cards.length,
        cardContentVersion: metadata?.cardContentVersion ?? 1,
        ...(deck.access === 'free'
          ? { installedContentVersion: metadata?.cardContentVersion ?? 1 }
          : {}),
        ...(metadata?.coverImage ? { coverPath: metadata.coverImage } : {}),
        ...(metadata?.storeProducts ? { storeProducts: metadata.storeProducts } : {}),
        installationStatus: deck.access === 'free' ? 'installed' : 'not_owned',
      };
    });
    return buildCatalogSnapshot({
      schemaVersion: bundledCatalog.schemaVersion,
      revision: bundledCatalog.revision,
      source: 'bundled',
      decks,
      bundleRecords: bundledCatalog.bundles.map((bundle) => ({
        id: bundle.id,
        order: bundle.order,
        title: bundle.title,
        description: bundle.description,
        access: bundle.access,
        price: bundle.price,
        version: bundle.version ?? 1,
        ...(bundle.storeProducts ? { storeProducts: bundle.storeProducts } : {}),
        deckIds: [...bundle.deckIds],
      })),
      deckOrders: bundledCatalog.deckOrders,
    });
  }
}

export class SqliteCatalogRepository implements CatalogRepository {
  public constructor(private readonly database: SQLiteDatabase) {}

  async load() {
    const state = await this.database.getFirstAsync<CatalogStateRow>(
      `SELECT catalog_schema_version, catalog_revision
       FROM catalog_state WHERE singleton_id = 1`,
    );
    if (!state) throw new Error('The local catalog has not been initialized.');

    const [deckRows, cardRows, bundleRows, membershipRows, orderRows] =
      await Promise.all([
        this.database.getAllAsync<DeckRow>(
          `SELECT d.*, i.status AS installation_status,
                  i.installed_content_version,
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
           WHERE d.lifecycle_status = 'active'
           ORDER BY d.title COLLATE NOCASE, d.deck_id`,
        ),
        this.database.getAllAsync<CardRow>(
          INSTALLED_CARD_ROWS_SQL,
        ),
        this.database.getAllAsync<BundleRow>(
          `SELECT * FROM bundles WHERE lifecycle_status = 'active'
           ORDER BY sort_order, bundle_id`,
        ),
        this.database.getAllAsync<MembershipRow>(
          `SELECT bundle_id, deck_id, position FROM bundle_decks
           ORDER BY bundle_id, position`,
        ),
        this.database.getAllAsync<OrderRow>(
          `SELECT scope, deck_id, position FROM deck_orders
           ORDER BY scope, position`,
        ),
      ]);

    const bundledImages = new Map(
      bundledDecks.map((deck) => [deck.id, deck.coverImage]),
    );
    const cardsByDeck = groupCards(cardRows);
    const orderPosition = new Map(
      orderRows.map((row) => [`${row.scope}:${row.deck_id}`, row.position]),
    );
    const decks: CatalogDeck[] = deckRows.map((row) => ({
      id: row.deck_id,
      order:
        (orderPosition.get(`${row.access}:${row.deck_id}`) ?? row.deck_version - 1) + 1,
      title: row.title,
      description: row.description,
      version: row.deck_version,
      access: row.access,
      ...(row.price_minor_units === null
        ? {}
        : { price: row.price_minor_units / 100 }),
      cards: row.installed_content_version === null
        ? []
        : cardsByDeck.get(`${row.deck_id}:${row.installed_content_version}`) ?? [],
      ...(bundledImages.get(row.deck_id)
        ? { coverImage: bundledImages.get(row.deck_id) }
        : {}),
      tags: parseTags(row.tags_json),
      cardCount: row.card_count,
      cardContentVersion: row.card_content_version,
      ...(row.installed_content_version === null
        ? {}
        : { installedContentVersion: row.installed_content_version }),
      ...(row.cover_path ? { coverPath: row.cover_path } : {}),
      ...(row.cover_uri ? { coverUri: row.cover_uri } : {}),
      ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
      ...(row.thumbnail_uri ? { thumbnailUri: row.thumbnail_uri } : {}),
      ...(row.thumbnail_url ? { thumbnailUrl: row.thumbnail_url } : {}),
      installationStatus: row.installation_status,
      ...(row.apple_product_id
        ? {
            storeProducts: {
              apple: { productId: row.apple_product_id, status: 'available' as const },
            },
          }
        : {}),
    }));
    const memberships = new Map<string, string[]>();
    for (const row of membershipRows) {
      const ids = memberships.get(row.bundle_id) ?? [];
      ids.push(row.deck_id);
      memberships.set(row.bundle_id, ids);
    }
    const deckOrders = { free: [] as string[], paid: [] as string[] };
    for (const row of orderRows) deckOrders[row.scope].push(row.deck_id);

    return buildCatalogSnapshot({
      schemaVersion: state.catalog_schema_version,
      revision: state.catalog_revision,
      source: 'sqlite',
      decks,
      bundleRecords: bundleRows.map((row) => ({
        id: row.bundle_id,
        order: row.sort_order,
        title: row.title,
        description: row.description,
        access: row.access,
        ...(row.price_minor_units === null
          ? {}
          : { price: row.price_minor_units / 100 }),
        version: row.bundle_version,
        ...(row.apple_product_id
          ? {
              storeProducts: {
                apple: { productId: row.apple_product_id, status: 'available' as const },
              },
            }
          : {}),
        deckIds: memberships.get(row.bundle_id) ?? [],
      })),
      deckOrders,
    });
  }
}

export async function createConfiguredCatalogRepository(
  source = configuredCatalogSource(),
): Promise<CatalogRepository> {
  if (source === 'sqlite') {
    return new SqliteCatalogRepository(await openCatalogDatabase());
  }
  return new BundledCatalogRepository();
}

function groupCards(rows: CardRow[]) {
  const groups = new Map<string, Card[]>();
  for (const row of rows) {
    const key = `${row.deck_id}:${row.card_content_version}`;
    const cards = groups.get(key) ?? [];
    cards.push({
      id: row.card_id,
      text: row.text,
      ...(row.byline ? { byline: row.byline } : {}),
    });
    groups.set(key, cards);
  }
  return groups;
}

function parseTags(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((tag) => typeof tag === 'string')) {
      return parsed;
    }
  } catch {
    // Invalid persisted metadata is handled as a catalog load failure below.
  }
  throw new Error('The local catalog contains invalid deck tags.');
}

type CatalogStateRow = {
  catalog_schema_version: number;
  catalog_revision: number;
};
type DeckRow = {
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
  cover_uri: string | null;
  cover_url: string | null;
  thumbnail_uri: string | null;
  thumbnail_url: string | null;
  installation_status: CatalogDeck['installationStatus'];
  installed_content_version: number | null;
  apple_product_id: string | null;
};
type CardRow = {
  deck_id: string;
  card_content_version: number;
  card_id: string;
  position: number;
  text: string;
  byline: string | null;
};
type BundleRow = {
  bundle_id: string;
  bundle_version: number;
  title: string;
  description: string;
  access: DeckAccess;
  price_minor_units: number | null;
  sort_order: number;
  apple_product_id: string | null;
};
type MembershipRow = { bundle_id: string; deck_id: string; position: number };
type OrderRow = { scope: DeckAccess; deck_id: string; position: number };

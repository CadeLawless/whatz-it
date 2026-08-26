import type { Card, DeckAccess } from '@/types/deck';

export type CatalogArtifactReference = {
  hash: string;
  bytes: number;
  url: string;
};

export type CatalogContentReference = {
  hash: string;
  bytes: number;
  url: string | null;
  protected: boolean;
};

export type CatalogProductIds = {
  apple: string | null;
  google: string | null;
};

export type CatalogManifestDeck = {
  id: string;
  order: number;
  title: string;
  description: string;
  tags: string[];
  access: DeckAccess;
  price: number | null;
  status: 'active' | 'retired';
  deckVersion: number;
  cardContentVersion: number;
  cardCount: number;
  content: CatalogContentReference;
  cover: CatalogArtifactReference;
  thumbnail: CatalogArtifactReference;
  productIds: CatalogProductIds;
};

export type CatalogManifestBundle = {
  id: string;
  order: number;
  title: string;
  description: string;
  access: DeckAccess;
  price: number | null;
  status: 'active' | 'retired';
  bundleVersion: number;
  deckIds: string[];
  productIds: CatalogProductIds;
};

export type CatalogManifest = {
  schemaVersion: 1;
  catalogSchemaVersion: 5;
  catalogRevision: number;
  updatedAt: string;
  minimumAppVersion: string | null;
  supportedContentSchemaVersions: number[];
  decks: CatalogManifestDeck[];
  bundles: CatalogManifestBundle[];
  deckOrders: { free: string[]; paid: string[] };
};

export type DeckContentArtifact = {
  schemaVersion: 1;
  deckId: string;
  cardContentVersion: number;
  cards: Card[];
};

export type LocalDeckVersion = {
  deck_id: string;
  deck_version: number;
  card_content_version: number;
};

export type LocalBundleVersion = {
  bundle_id: string;
  bundle_version: number;
};

export function parseCatalogManifest(
  value: unknown,
  options: { allowDevelopmentPreview?: boolean } = {},
): CatalogManifest {
  const root = objectValue(value, 'manifest');
  integer(root.schemaVersion, 'schemaVersion', 1);
  integer(root.catalogSchemaVersion, 'catalogSchemaVersion', 5);
  const catalogRevision = positiveInteger(root.catalogRevision, 'catalogRevision');
  const updatedAt = utcTimestamp(root.updatedAt, 'updatedAt');
  const minimumAppVersion = nullableAppVersion(
    root.minimumAppVersion,
    'minimumAppVersion',
  );
  const supportedContentSchemaVersions = arrayValue(
    root.supportedContentSchemaVersions,
    'supportedContentSchemaVersions',
  ).map((version, index) => positiveInteger(version, `supportedContentSchemaVersions[${index}]`));
  if (!supportedContentSchemaVersions.includes(1)) {
    throw new Error('Manifest does not support deck-content schema version 1.');
  }

  const deckIds = new Set<string>();
  const decks = arrayValue(root.decks, 'decks').map((value, index) => {
    const path = `decks[${index}]`;
    const deck = objectValue(value, path);
    const id = identifier(deck.id, `${path}.id`);
    if (deckIds.has(id)) throw new Error(`Duplicate manifest deck ID: ${id}.`);
    deckIds.add(id);
    const access = accessValue(deck.access, `${path}.access`);
    const contentObject = objectValue(deck.content, `${path}.content`);
    const protectedContent = booleanValue(contentObject.protected, `${path}.content.protected`);
    const contentUrl = nullableUrl(contentObject.url, `${path}.content.url`);
    if (access === 'free' && (protectedContent || contentUrl === null)) {
      throw new Error(`Free deck ${id} must expose unprotected content.`);
    }
    if (
      access === 'paid'
      && !options.allowDevelopmentPreview
      && (!protectedContent || contentUrl !== null)
    ) {
      throw new Error(`Paid deck ${id} must not expose a public content URL.`);
    }
    if (
      access === 'paid'
      && options.allowDevelopmentPreview
      && (protectedContent || contentUrl === null)
    ) {
      throw new Error(`Development preview deck ${id} must expose authenticated preview content.`);
    }
    return {
      id,
      order: positiveInteger(deck.order, `${path}.order`),
      title: nonEmptyString(deck.title, `${path}.title`),
      description: stringValue(deck.description, `${path}.description`),
      tags: stringArray(deck.tags, `${path}.tags`),
      access,
      price: nullablePrice(deck.price, `${path}.price`),
      status: statusValue(deck.status, `${path}.status`),
      deckVersion: positiveInteger(deck.deckVersion, `${path}.deckVersion`),
      cardContentVersion: positiveInteger(
        deck.cardContentVersion,
        `${path}.cardContentVersion`,
      ),
      cardCount: nonNegativeInteger(deck.cardCount, `${path}.cardCount`),
      content: contentReference(
        contentObject,
        `${path}.content`,
        contentUrl,
        protectedContent,
      ),
      cover: artifactReference(
        objectValue(deck.cover, `${path}.cover`),
        `${path}.cover`,
      ),
      thumbnail: artifactReference(
        objectValue(deck.thumbnail, `${path}.thumbnail`),
        `${path}.thumbnail`,
      ),
      productIds: productIdsValue(deck.productIds, `${path}.productIds`),
    } satisfies CatalogManifestDeck;
  });

  const bundleIds = new Set<string>();
  const bundles = arrayValue(root.bundles, 'bundles').map((value, index) => {
    const path = `bundles[${index}]`;
    const bundle = objectValue(value, path);
    const id = identifier(bundle.id, `${path}.id`);
    if (bundleIds.has(id)) throw new Error(`Duplicate manifest bundle ID: ${id}.`);
    bundleIds.add(id);
    const deckReferences = stringArray(bundle.deckIds, `${path}.deckIds`);
    if (new Set(deckReferences).size !== deckReferences.length) {
      throw new Error(`Bundle ${id} contains a duplicate deck reference.`);
    }
    for (const deckId of deckReferences) {
      if (!deckIds.has(deckId)) throw new Error(`Bundle ${id} references missing deck ${deckId}.`);
    }
    const status = statusValue(bundle.status, `${path}.status`);
    if (
      status === 'active' &&
      deckReferences.some(
        (deckId) => decks.find((deck) => deck.id === deckId)?.status !== 'active',
      )
    ) {
      throw new Error(`Active bundle ${id} references a retired deck.`);
    }
    return {
      id,
      order: positiveInteger(bundle.order, `${path}.order`),
      title: nonEmptyString(bundle.title, `${path}.title`),
      description: stringValue(bundle.description, `${path}.description`),
      access: accessValue(bundle.access, `${path}.access`),
      price: nullablePrice(bundle.price, `${path}.price`),
      status,
      bundleVersion: positiveInteger(bundle.bundleVersion, `${path}.bundleVersion`),
      deckIds: deckReferences,
      productIds: productIdsValue(bundle.productIds, `${path}.productIds`),
    } satisfies CatalogManifestBundle;
  });
  const orderObject = objectValue(root.deckOrders, 'deckOrders');
  const deckOrders = {
    free: stringArray(orderObject.free, 'deckOrders.free'),
    paid: stringArray(orderObject.paid, 'deckOrders.paid'),
  };
  for (const scope of ['free', 'paid'] as const) {
    const expected = decks
      .filter((deck) => deck.status === 'active' && deck.access === scope)
      .map((deck) => deck.id)
      .sort();
    const actual = [...deckOrders[scope]].sort();
    if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${scope} deck order must contain every active ${scope} deck exactly once.`);
    }
  }

  return {
    schemaVersion: 1,
    catalogSchemaVersion: 5,
    catalogRevision,
    updatedAt,
    minimumAppVersion,
    supportedContentSchemaVersions,
    decks,
    bundles,
    deckOrders,
  };
}

export function assertAppVersionCompatible(
  manifest: Pick<CatalogManifest, 'minimumAppVersion'>,
  appVersion: string,
) {
  if (manifest.minimumAppVersion === null) return;
  const current = appVersionParts(appVersion, 'app version');
  const minimum = appVersionParts(
    manifest.minimumAppVersion,
    'minimumAppVersion',
  );
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return;
    if (current[index] < minimum[index]) {
      throw new Error(
        `App version ${appVersion} is older than required version ${manifest.minimumAppVersion}.`,
      );
    }
  }
}

export function parseDeckContentArtifact(
  value: unknown,
  expected: Pick<CatalogManifestDeck, 'id' | 'cardContentVersion' | 'cardCount'>,
): DeckContentArtifact {
  const root = objectValue(value, 'deck content');
  integer(root.schemaVersion, 'schemaVersion', 1);
  const deckId = identifier(root.deckId, 'deckId');
  const cardContentVersion = positiveInteger(root.cardContentVersion, 'cardContentVersion');
  const ids = new Set<string>();
  const cards = arrayValue(root.cards, 'cards').map((value, index) => {
    const path = `cards[${index}]`;
    const card = objectValue(value, path);
    const id = identifier(card.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`Duplicate card ID in ${deckId}: ${id}.`);
    ids.add(id);
    const byline = card.byline === undefined ? undefined : stringValue(card.byline, `${path}.byline`);
    return {
      id,
      text: nonEmptyString(card.text, `${path}.text`),
      ...(byline ? { byline } : {}),
    };
  });
  if (deckId !== expected.id || cardContentVersion !== expected.cardContentVersion) {
    throw new Error(`Deck-content identity or version does not match manifest deck ${expected.id}.`);
  }
  if (cards.length !== expected.cardCount) {
    throw new Error(`Deck ${deckId} card count does not match its manifest.`);
  }
  return { schemaVersion: 1, deckId, cardContentVersion, cards };
}

export function assertMonotonicVersions(
  manifest: CatalogManifest,
  localDecks: LocalDeckVersion[],
  localBundles: LocalBundleVersion[],
) {
  const deckVersions = new Map(localDecks.map((deck) => [deck.deck_id, deck]));
  for (const deck of manifest.decks) {
    const local = deckVersions.get(deck.id);
    if (
      local &&
      (deck.deckVersion < local.deck_version ||
        deck.cardContentVersion < local.card_content_version)
    ) {
      throw new Error(`Deck ${deck.id} has a version older than the local catalog.`);
    }
  }
  const bundleVersions = new Map(
    localBundles.map((bundle) => [bundle.bundle_id, bundle.bundle_version]),
  );
  for (const bundle of manifest.bundles) {
    const localVersion = bundleVersions.get(bundle.id);
    if (localVersion !== undefined && bundle.bundleVersion < localVersion) {
      throw new Error(`Bundle ${bundle.id} has a version older than the local catalog.`);
    }
  }
}

function artifactReference(
  value: Record<string, unknown>,
  path: string,
  knownUrl?: string | null,
): CatalogArtifactReference {
  const url = knownUrl === undefined ? nullableUrl(value.url, `${path}.url`) : knownUrl;
  if (url === null) throw new Error(`${path}.url must be a public HTTPS URL.`);
  return {
    hash: sha256(value.hash, `${path}.hash`),
    bytes: positiveInteger(value.bytes, `${path}.bytes`),
    url,
  };
}

function contentReference(
  value: Record<string, unknown>,
  path: string,
  url: string | null,
  protectedContent: boolean,
): CatalogContentReference {
  return {
    hash: sha256(value.hash, `${path}.hash`),
    bytes: positiveInteger(value.bytes, `${path}.bytes`),
    url,
    protected: protectedContent,
  };
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}
function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  return value;
}
function nonEmptyString(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!result.trim()) throw new Error(`${path} must not be empty.`);
  return result;
}
function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => stringValue(item, `${path}[${index}]`));
}
function identifier(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(result)) throw new Error(`${path} is not a safe identifier.`);
  return result;
}
function sha256(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${path} must be a lowercase SHA-256 hash.`);
  return result;
}
function integer(value: unknown, path: string, expected?: number): number {
  if (!Number.isInteger(value) || (expected !== undefined && value !== expected)) throw new Error(`${path} is unsupported.`);
  return value as number;
}
function positiveInteger(value: unknown, path: string): number {
  const result = integer(value, path);
  if (result < 1) throw new Error(`${path} must be positive.`);
  return result;
}
function nonNegativeInteger(value: unknown, path: string): number {
  const result = integer(value, path);
  if (result < 0) throw new Error(`${path} must not be negative.`);
  return result;
}
function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  return value;
}
function accessValue(value: unknown, path: string): DeckAccess {
  if (value !== 'free' && value !== 'paid') throw new Error(`${path} must be free or paid.`);
  return value;
}
function statusValue(value: unknown, path: string): 'active' | 'retired' {
  if (value !== 'active' && value !== 'retired') throw new Error(`${path} has an unsupported status.`);
  return value;
}
function nullablePrice(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-8
  ) {
    throw new Error(`${path} must be null or a non-negative two-decimal price.`);
  }
  return value;
}
function productIdsValue(value: unknown, path: string): CatalogProductIds {
  const products = objectValue(value, path);
  return {
    apple: nullableProductId(products.apple, `${path}.apple`),
    google: nullableProductId(products.google, `${path}.google`),
  };
}
function nullableProductId(value: unknown, path: string): string | null {
  if (value === null) return null;
  const result = stringValue(value, path);
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(result)) {
    throw new Error(`${path} is not a valid store product ID.`);
  }
  return result;
}
function nullableAppVersion(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  const result = stringValue(value, path);
  appVersionParts(result, path);
  return result;
}
function appVersionParts(value: string, path: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`${path} must use major.minor.patch format.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function nullableUrl(value: unknown, path: string): string | null {
  if (value === null) return null;
  const result = stringValue(value, path);
  if (!/^https:\/\//i.test(result)) throw new Error(`${path} must use HTTPS.`);
  return result;
}
function utcTimestamp(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(result)) throw new Error(`${path} must be a whole-second UTC timestamp.`);
  return result;
}

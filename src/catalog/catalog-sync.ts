import type { SQLiteDatabase } from 'expo-sqlite';

import {
  assertMonotonicVersions,
  parseCatalogManifest,
  parseDeckContentArtifact,
  type CatalogArtifactReference,
  type CatalogManifest,
  type DeckContentArtifact,
} from './catalog-wire';

export type CatalogSyncResult =
  | { status: 'unchanged'; revision: number }
  | { status: 'updated'; revision: number; downloadedDecks: number; downloadedMedia: number };

export type CatalogSyncOptions = {
  manifestUrl: string;
  signal?: AbortSignal;
  now?: () => Date;
  downloadRuntime?: CatalogDownloadRuntime;
};

export type CatalogDownloadRuntime = {
  request?: (url: string, init: RequestInit) => Promise<Response>;
  digestSha256?: (bytes: Uint8Array) => Promise<string>;
};

type CatalogState = { catalog_revision: number; etag: string | null };
type Installation = { deck_id: string; installed_content_version: number | null };
type DeckVersionRow = {
  deck_id: string;
  deck_version: number;
  card_content_version: number;
};
type BundleVersionRow = { bundle_id: string; bundle_version: number };
type MediaRow = { content_hash: string; local_uri: string | null; byte_size: number; status: string };
type PreparedMedia = CatalogArtifactReference & { localUri: string };

export class CatalogSyncError extends Error {
  public constructor(
    public readonly code:
      | 'network_error'
      | 'invalid_manifest'
      | 'invalid_artifact'
      | 'stale_manifest'
      | 'storage_error',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CatalogSyncError';
  }
}

export async function synchronizeCatalog(
  database: SQLiteDatabase,
  options: CatalogSyncOptions,
): Promise<CatalogSyncResult> {
  const state = await database.getFirstAsync<CatalogState>(
    'SELECT catalog_revision, etag FROM catalog_state WHERE singleton_id = 1',
  );
  if (!state) throw new CatalogSyncError('storage_error', 'The local catalog is not initialized.');

  const response = await request(options.manifestUrl, {
    headers: state.etag ? { 'If-None-Match': state.etag } : undefined,
    signal: options.signal,
  }, options.downloadRuntime);
  if (response.status === 304) return { status: 'unchanged', revision: state.catalog_revision };
  if (!response.ok) {
    throw new CatalogSyncError('network_error', `Catalog request failed with HTTP ${response.status}.`);
  }

  let manifest: CatalogManifest;
  try {
    manifest = parseCatalogManifest(await response.json());
  } catch (error) {
    throw new CatalogSyncError('invalid_manifest', 'The server returned an invalid catalog manifest.', {
      cause: error,
    });
  }
  if (manifest.catalogRevision < state.catalog_revision) {
    throw new CatalogSyncError(
      'stale_manifest',
      `Server revision ${manifest.catalogRevision} is older than local revision ${state.catalog_revision}.`,
    );
  }
  if (manifest.catalogRevision === state.catalog_revision) {
    return { status: 'unchanged', revision: state.catalog_revision };
  }

  const [localDecks, localBundles] = await Promise.all([
    database.getAllAsync<DeckVersionRow>(
      'SELECT deck_id, deck_version, card_content_version FROM decks',
    ),
    database.getAllAsync<BundleVersionRow>(
      'SELECT bundle_id, bundle_version FROM bundles',
    ),
  ]);
  try {
    assertMonotonicVersions(manifest, localDecks, localBundles);
  } catch (error) {
    throw new CatalogSyncError('stale_manifest', 'The manifest regresses a published version.', {
      cause: error,
    });
  }

  const installations = await database.getAllAsync<Installation>(
    'SELECT deck_id, installed_content_version FROM deck_installations',
  );
  const installedVersions = new Map(
    installations.map((row) => [row.deck_id, row.installed_content_version]),
  );
  const deckArtifacts = new Map<string, DeckContentArtifact>();
  for (const deck of manifest.decks) {
    if (deck.status !== 'active' || deck.access !== 'free') continue;
    if (installedVersions.get(deck.id) === deck.cardContentVersion) continue;
    if (!deck.content.url) {
      throw new CatalogSyncError('invalid_manifest', `Free deck ${deck.id} has no content URL.`);
    }
    const bytes = await downloadVerified(
      deck.content.url,
      deck.content.bytes,
      deck.content.hash,
      options.signal,
      options.downloadRuntime,
    );
    try {
      deckArtifacts.set(
        deck.id,
        parseDeckContentArtifact(JSON.parse(new TextDecoder().decode(bytes)), deck),
      );
    } catch (error) {
      throw new CatalogSyncError('invalid_artifact', `Deck ${deck.id} content is invalid.`, {
        cause: error,
      });
    }
  }

  const mediaRows = await database.getAllAsync<MediaRow>(
    'SELECT content_hash, local_uri, byte_size, status FROM media_files',
  );
  const existingMedia = new Map(mediaRows.map((row) => [row.content_hash, row]));
  const mediaReferences = uniqueMediaReferences(manifest);
  const preparedMedia = new Map<string, PreparedMedia>();
  const downloadedMedia = new Map<string, Uint8Array>();
  for (const reference of mediaReferences) {
    const existing = existingMedia.get(reference.hash);
    if (existing?.status === 'ready' && existing.local_uri) {
      const file = await inspectLocalFile(existing.local_uri);
      if (file.exists && file.size === reference.bytes && existing.byte_size === reference.bytes) {
        preparedMedia.set(reference.hash, { ...reference, localUri: existing.local_uri });
        continue;
      }
    }
    downloadedMedia.set(
      reference.hash,
      await downloadVerified(
        reference.url,
        reference.bytes,
        reference.hash,
        options.signal,
        options.downloadRuntime,
      ),
    );
  }

  if (downloadedMedia.size > 0) {
    try {
      const storedMedia = await storeDownloadedMedia(mediaReferences, downloadedMedia);
      for (const item of storedMedia) {
        preparedMedia.set(item.hash, item);
      }
    } catch (error) {
      throw new CatalogSyncError('storage_error', 'Verified catalog media could not be stored.', {
        cause: error,
      });
    }
  }
  if (preparedMedia.size !== mediaReferences.length) {
    throw new CatalogSyncError('storage_error', 'Not all catalog media was prepared.');
  }

  const syncedAt = (options.now ?? (() => new Date()))().toISOString();
  const etag = response.headers.get('etag');
  try {
    await applyPreparedCatalog(database, manifest, deckArtifacts, preparedMedia, etag, syncedAt);
  } catch (error) {
    throw new CatalogSyncError('storage_error', 'The verified catalog could not be activated.', {
      cause: error,
    });
  }
  return {
    status: 'updated',
    revision: manifest.catalogRevision,
    downloadedDecks: deckArtifacts.size,
    downloadedMedia: downloadedMedia.size,
  };
}

export async function applyPreparedCatalog(
  database: SQLiteDatabase,
  manifest: CatalogManifest,
  deckArtifacts: Map<string, DeckContentArtifact>,
  media: Map<string, PreparedMedia>,
  etag: string | null,
  syncedAt: string,
) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync("UPDATE decks SET lifecycle_status = 'retired'");
    await transaction.runAsync("UPDATE bundles SET lifecycle_status = 'retired'");
    await transaction.runAsync('DELETE FROM bundle_decks');
    await transaction.runAsync('DELETE FROM deck_orders');

    for (const deck of manifest.decks) {
      await transaction.runAsync(
        `INSERT INTO decks (
          deck_id, deck_version, card_content_version, title, description,
          access, price_minor_units, tags_json, card_count,
          content_hash, content_bytes, content_url,
          cover_hash, cover_bytes, cover_url,
          thumbnail_hash, thumbnail_bytes, thumbnail_url, lifecycle_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(deck_id) DO UPDATE SET
          deck_version = excluded.deck_version,
          card_content_version = excluded.card_content_version,
          title = excluded.title,
          description = excluded.description,
          access = excluded.access,
          price_minor_units = excluded.price_minor_units,
          tags_json = excluded.tags_json,
          card_count = excluded.card_count,
          content_hash = excluded.content_hash,
          content_bytes = excluded.content_bytes,
          content_url = excluded.content_url,
          cover_hash = excluded.cover_hash,
          cover_bytes = excluded.cover_bytes,
          cover_url = excluded.cover_url,
          thumbnail_hash = excluded.thumbnail_hash,
          thumbnail_bytes = excluded.thumbnail_bytes,
          thumbnail_url = excluded.thumbnail_url,
          lifecycle_status = excluded.lifecycle_status`,
        deck.id,
        deck.deckVersion,
        deck.cardContentVersion,
        deck.title,
        deck.description,
        deck.access,
        toMinorUnits(deck.price),
        JSON.stringify(deck.tags),
        deck.cardCount,
        deck.content.hash,
        deck.content.bytes,
        deck.content.url,
        deck.cover.hash,
        deck.cover.bytes,
        deck.cover.url,
        deck.thumbnail.hash,
        deck.thumbnail.bytes,
        deck.thumbnail.url,
        deck.status,
      );

      const artifact = deckArtifacts.get(deck.id);
      if (artifact) {
        await transaction.runAsync('DELETE FROM cards WHERE deck_id = ?', deck.id);
        for (const [position, card] of artifact.cards.entries()) {
          await transaction.runAsync(
            `INSERT INTO cards (
              deck_id, card_content_version, card_id, position, text, byline
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            deck.id,
            artifact.cardContentVersion,
            card.id,
            position,
            card.text,
            card.byline ?? null,
          );
        }
      } else if (deck.access === 'paid') {
        // A deck that changes from free to paid must not retain playable cards.
        await transaction.runAsync('DELETE FROM cards WHERE deck_id = ?', deck.id);
      }
      const free = deck.access === 'free';
      await transaction.runAsync(
        `INSERT INTO deck_installations (
          deck_id, ownership_source, desired_content_version,
          installed_content_version, status, last_verified_at, last_error_code
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(deck_id) DO UPDATE SET
          ownership_source = excluded.ownership_source,
          desired_content_version = excluded.desired_content_version,
          installed_content_version = excluded.installed_content_version,
          status = excluded.status,
          last_verified_at = excluded.last_verified_at,
          last_error_code = NULL`,
        deck.id,
        free ? 'free' : 'none',
        deck.cardContentVersion,
        free ? deck.cardContentVersion : null,
        free ? 'installed' : 'not_owned',
        syncedAt,
      );
    }

    for (const bundle of manifest.bundles) {
      await transaction.runAsync(
        `INSERT INTO bundles (
          bundle_id, bundle_version, title, description, access,
          price_minor_units, sort_order, lifecycle_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bundle_id) DO UPDATE SET
          bundle_version = excluded.bundle_version,
          title = excluded.title,
          description = excluded.description,
          access = excluded.access,
          price_minor_units = excluded.price_minor_units,
          sort_order = excluded.sort_order,
          lifecycle_status = excluded.lifecycle_status`,
        bundle.id,
        bundle.bundleVersion,
        bundle.title,
        bundle.description,
        bundle.access,
        toMinorUnits(bundle.price),
        bundle.order,
        bundle.status,
      );
      for (const [position, deckId] of bundle.deckIds.entries()) {
        await transaction.runAsync(
          'INSERT INTO bundle_decks (bundle_id, deck_id, position) VALUES (?, ?, ?)',
          bundle.id,
          deckId,
          position,
        );
      }
    }
    for (const scope of ['free', 'paid'] as const) {
      for (const [position, deckId] of manifest.deckOrders[scope].entries()) {
        await transaction.runAsync(
          'INSERT INTO deck_orders (scope, deck_id, position) VALUES (?, ?, ?)',
          scope,
          deckId,
          position,
        );
      }
    }
    for (const item of media.values()) {
      const mediaType = manifest.decks.some((deck) => deck.thumbnail.hash === item.hash)
        ? 'thumbnail'
        : 'cover';
      await transaction.runAsync(
        `INSERT INTO media_files (
          content_hash, media_type, remote_url, byte_size, local_uri,
          status, last_verified_at
        ) VALUES (?, ?, ?, ?, ?, 'ready', ?)
        ON CONFLICT(content_hash) DO UPDATE SET
          remote_url = excluded.remote_url,
          byte_size = excluded.byte_size,
          local_uri = excluded.local_uri,
          status = 'ready',
          last_verified_at = excluded.last_verified_at`,
        item.hash,
        mediaType,
        item.url,
        item.bytes,
        item.localUri,
        syncedAt,
      );
    }
    await transaction.runAsync(
      `UPDATE catalog_state SET
        local_schema_version = 2,
        catalog_schema_version = ?,
        catalog_revision = ?,
        etag = ?,
        source = 'remote',
        catalog_updated_at = ?,
        last_synced_at = ?,
        last_sync_error_code = NULL
       WHERE singleton_id = 1`,
      manifest.catalogSchemaVersion,
      manifest.catalogRevision,
      etag,
      manifest.updatedAt,
      syncedAt,
    );
  });
}

function uniqueMediaReferences(manifest: CatalogManifest) {
  const references = new Map<string, CatalogArtifactReference>();
  for (const deck of manifest.decks) {
    if (deck.status !== 'active') continue;
    for (const reference of [deck.cover, deck.thumbnail]) {
      const existing = references.get(reference.hash);
      if (existing && (existing.bytes !== reference.bytes || existing.url !== reference.url)) {
        throw new CatalogSyncError('invalid_manifest', `Media hash ${reference.hash} has conflicting metadata.`);
      }
      references.set(reference.hash, reference);
    }
  }
  return [...references.values()];
}

export async function downloadVerified(
  url: string,
  expectedBytes: number,
  expectedHash: string,
  signal?: AbortSignal,
  runtime?: CatalogDownloadRuntime,
) {
  const response = await request(url, { signal }, runtime);
  if (!response.ok) {
    throw new CatalogSyncError('network_error', `Artifact request failed with HTTP ${response.status}.`);
  }
  const bytes = await response.bytes();
  if (bytes.byteLength !== expectedBytes) {
    throw new CatalogSyncError('invalid_artifact', `Artifact ${expectedHash} has the wrong byte length.`);
  }
  const actualHash = await (runtime?.digestSha256 ?? digestSha256)(bytes);
  if (actualHash !== expectedHash) {
    throw new CatalogSyncError('invalid_artifact', `Artifact ${expectedHash} failed SHA-256 verification.`);
  }
  return bytes;
}

async function request(
  url: string,
  init: RequestInit,
  runtime?: CatalogDownloadRuntime,
) {
  try {
    if (runtime?.request) return await runtime.request(url, init);
    const { fetch } = await import('expo/fetch');
    return await fetch(url, init);
  } catch (error) {
    throw new CatalogSyncError('network_error', 'The catalog server could not be reached.', {
      cause: error,
    });
  }
}

async function digestSha256(bytes: Uint8Array) {
  const Crypto = await import('expo-crypto');
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, input);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function inspectLocalFile(uri: string) {
  const { File } = await import('expo-file-system');
  const file = new File(uri);
  return { exists: file.exists, size: file.size };
}

async function storeDownloadedMedia(
  references: CatalogArtifactReference[],
  downloadedMedia: Map<string, Uint8Array>,
) {
  const { Directory, File, Paths } = await import('expo-file-system');
  const directory = new Directory(Paths.document, 'catalog-media');
  directory.create({ idempotent: true, intermediates: true });
  const stored: PreparedMedia[] = [];
  for (const reference of references) {
    const bytes = downloadedMedia.get(reference.hash);
    if (!bytes) continue;
    const file = new File(directory, `${reference.hash}${extensionFor(reference.url)}`);
    file.create({ overwrite: true, intermediates: true });
    file.write(bytes);
    stored.push({ ...reference, localUri: file.uri });
  }
  return stored;
}

function toMinorUnits(price: number | null) {
  return price === null ? null : Math.round(price * 100);
}

function extensionFor(url: string) {
  const match = /\.(webp|png|jpe?g)(?:[?#]|$)/i.exec(url);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.bin';
}

import { createHash } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCatalogManifest,
  parseDeckContentArtifact,
  type CatalogManifest,
  type DeckContentArtifact,
} from '../src/catalog/catalog-wire';

const CATALOG_START = '/* DECK_MANAGER_CATALOG_START */';
const CATALOG_END = '/* DECK_MANAGER_CATALOG_END */';
const COVERS_START = '/* DECK_MANAGER_COVERS_START */';
const COVERS_END = '/* DECK_MANAGER_COVERS_END */';
const DEFAULT_CONCURRENCY = 6;

type BaselineDeck = {
  id: string;
  order: number;
  title: string;
  description: string;
  coverImage?: string;
  version: number;
  cardContentVersion: number;
  cardCount: number;
  featuredCards: DeckContentArtifact['cards'];
  tags: string[];
  access: 'free' | 'paid';
  price?: number;
  storeProducts?: { apple?: { productId: string; status: 'available' } };
  cards: DeckContentArtifact['cards'];
};

type BaselineCatalog = {
  schemaVersion: 5;
  revision: number;
  updatedAt: string;
  decks: BaselineDeck[];
  bundles: {
    id: string;
    order: number;
    title: string;
    description: string;
    access: 'free' | 'paid';
    price?: number;
    version: number;
    storeProducts?: { apple?: { productId: string; status: 'available' } };
    deckIds: string[];
  }[];
  deckOrders: { free: string[]; paid: string[] };
};

export type PreparedBaseline = {
  catalog: BaselineCatalog;
  covers: Map<string, Uint8Array>;
};

export async function fetchPreparedBaseline(
  manifestUrl: string,
  request: typeof fetch = fetch,
): Promise<PreparedBaseline> {
  const url = requireHttpsUrl(manifestUrl, 'manifest');
  const manifestResponse = await request(url, {
    headers: { Accept: 'application/json' },
  });
  if (!manifestResponse.ok) {
    throw new Error(`Manifest request failed with HTTP ${manifestResponse.status}.`);
  }
  const manifest = parseCatalogManifest(await manifestResponse.json());
  const activeDecks = manifest.decks.filter((deck) => deck.status === 'active');
  const entries = await mapConcurrent(
    activeDecks,
    DEFAULT_CONCURRENCY,
    async (deck) => {
      const [artifact, coverBytes] = await Promise.all([
        deck.access === 'free'
          ? fetchFreeDeckArtifact(deck, request)
          : Promise.resolve(undefined),
        fetchVerifiedBytes(deck.cover.url, deck.cover.bytes, deck.cover.hash, request),
      ]);
      assertWebp(coverBytes, deck.id);
      return {
        artifact,
        coverBytes,
        coverPath: baselineCoverPath(deck.cover.hash),
        deckId: deck.id,
      };
    },
  );

  const artifacts = new Map(
    entries.flatMap((entry) => entry.artifact ? [[entry.deckId, entry.artifact] as const] : []),
  );
  const coverPaths = new Map(entries.map((entry) => [entry.deckId, entry.coverPath]));
  const covers = new Map(entries.map((entry) => [entry.coverPath, entry.coverBytes]));
  return { catalog: buildBaselineCatalog(manifest, artifacts, coverPaths), covers };
}

export function buildBaselineCatalog(
  manifest: CatalogManifest,
  artifacts: Map<string, DeckContentArtifact>,
  coverPaths: Map<string, string>,
): BaselineCatalog {
  const activeDeckIds = new Set(
    manifest.decks.filter((deck) => deck.status === 'active').map((deck) => deck.id),
  );
  const decks = manifest.decks
    .filter((deck) => deck.status === 'active')
    .map((deck): BaselineDeck => {
      const artifact = artifacts.get(deck.id);
      const coverPath = coverPaths.get(deck.id);
      if (deck.access === 'free' && !artifact) {
        throw new Error(`Free deck ${deck.id} is missing its verified baseline artifact.`);
      }
      if (coverPath !== baselineCoverPath(deck.cover.hash)) {
        throw new Error(`Deck ${deck.id} is missing its verified baseline cover.`);
      }
      if (deck.access === 'paid' && artifact) {
        throw new Error(`Paid deck ${deck.id} must not be included as baseline card content.`);
      }
      const verifiedArtifact = artifact
        ? parseDeckContentArtifact(artifact, deck)
        : undefined;
      return {
        id: deck.id,
        order: deck.order,
        title: deck.title,
        description: deck.description,
        ...(coverPath ? { coverImage: coverPath } : {}),
        version: deck.deckVersion,
        cardContentVersion: deck.cardContentVersion,
        cardCount: deck.cardCount,
        featuredCards: (deck.featuredCards ?? []).map((card) => ({ ...card })),
        tags: [...deck.tags],
        access: deck.access,
        ...(deck.price === null ? {} : { price: deck.price }),
        ...(deck.productIds.apple
          ? { storeProducts: { apple: { productId: deck.productIds.apple, status: 'available' as const } } }
          : {}),
        cards: verifiedArtifact?.cards.map((card) => ({ ...card })) ?? [],
      };
    });
  const bundles = manifest.bundles
    .filter((bundle) => bundle.status === 'active')
    .map((bundle) => ({
      id: bundle.id,
      order: bundle.order,
      title: bundle.title,
      description: bundle.description,
      access: bundle.access,
      ...(bundle.price === null ? {} : { price: bundle.price }),
      version: bundle.bundleVersion,
      ...(bundle.productIds.apple
        ? { storeProducts: { apple: { productId: bundle.productIds.apple, status: 'available' as const } } }
        : {}),
      deckIds: bundle.deckIds.filter((deckId) => activeDeckIds.has(deckId)),
    }));
  return {
    schemaVersion: 5,
    revision: manifest.catalogRevision,
    updatedAt: manifest.updatedAt,
    decks,
    bundles,
    deckOrders: {
      free: [...manifest.deckOrders.free],
      paid: [...manifest.deckOrders.paid],
    },
  };
}

export function renderBundledCatalogSource(
  source: string,
  baseline: BaselineCatalog,
) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const catalogJson = JSON.stringify(baseline, null, 4).replaceAll('\n', newline);
  const coverRegistry = renderCoverRegistry(
    baseline.decks.flatMap((deck) => (deck.coverImage ? [deck.coverImage] : [])),
    newline,
  );
  return replaceManagedBlock(
    replaceManagedBlock(source, CATALOG_START, CATALOG_END, catalogJson, newline),
    COVERS_START,
    COVERS_END,
    coverRegistry,
    newline,
  );
}

export async function baselineIsCurrent(
  repositoryRoot: string,
  prepared: PreparedBaseline,
) {
  const catalogPath = resolve(repositoryRoot, 'src/data/bundles.ts');
  const source = await readFile(catalogPath, 'utf8');
  if (renderBundledCatalogSource(source, prepared.catalog) !== source) return false;
  for (const [path, expected] of prepared.covers) {
    const absolutePath = resolveRepositoryPath(repositoryRoot, path);
    try {
      const info = await stat(absolutePath);
      if (!info.isFile() || info.size !== expected.byteLength) return false;
      if (sha256(await readFile(absolutePath)) !== sha256(expected)) return false;
    } catch {
      return false;
    }
  }
  if (!(await generatedCoverSetMatches(repositoryRoot, prepared.covers))) return false;
  return true;
}

export async function writePreparedBaseline(
  repositoryRoot: string,
  prepared: PreparedBaseline,
) {
  const catalogPath = resolve(repositoryRoot, 'src/data/bundles.ts');
  const source = await readFile(catalogPath, 'utf8');
  const nextSource = renderBundledCatalogSource(source, prepared.catalog);

  for (const [path, bytes] of prepared.covers) {
    const target = resolveRepositoryPath(repositoryRoot, path);
    await mkdir(dirname(target), { recursive: true });
    if (await fileMatches(target, bytes)) continue;
    const temporary = `${target}.tmp-${process.pid}`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await writeFile(target, bytes);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  if (nextSource !== source) {
    const temporary = `${catalogPath}.tmp-${process.pid}`;
    try {
      await writeFile(temporary, nextSource, { encoding: 'utf8', flag: 'wx' });
      await writeFile(catalogPath, nextSource, 'utf8');
    } finally {
      await rm(temporary, { force: true });
    }
  }

  const expectedCoverPaths = new Set(prepared.covers.keys());
  const coverDirectory = resolve(repositoryRoot, 'assets/images/decks/baseline');
  await mkdir(coverDirectory, { recursive: true });
  for (const entry of await readdir(coverDirectory, { withFileTypes: true })) {
    const repositoryPath = `assets/images/decks/baseline/${entry.name}`;
    if (
      entry.isFile() &&
      /^[a-f0-9]{64}\.webp$/.test(entry.name) &&
      !expectedCoverPaths.has(repositoryPath)
    ) {
      await rm(resolveRepositoryPath(repositoryRoot, repositoryPath));
    }
  }
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const prepared = await fetchPreparedBaseline(options.manifestUrl);
  const current = await baselineIsCurrent(repositoryRoot, prepared);
  if (options.mode === 'check') {
    if (!current) {
      console.error(
        `STALE: bundled catalog does not match active revision ${prepared.catalog.revision}.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`PASS: bundled catalog matches active revision ${prepared.catalog.revision}.`);
    return;
  }
  if (current) {
    console.log(`UNCHANGED: bundled catalog already matches revision ${prepared.catalog.revision}.`);
    return;
  }
  await writePreparedBaseline(repositoryRoot, prepared);
  console.log(`UPDATED: bundled catalog now matches revision ${prepared.catalog.revision}.`);
  console.log(`Storefront covers: ${prepared.covers.size}`);
  console.log(
    `Free starter cards: ${prepared.catalog.decks
      .filter((deck) => deck.access === 'free')
      .reduce((total, deck) => total + deck.cards.length, 0)}`,
  );
}

function parseArguments(arguments_: string[]) {
  let mode: 'check' | 'write' = 'check';
  let manifestUrl = process.env.CATALOG_MANIFEST_URL ?? '';
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--write') {
      mode = 'write';
    } else if (argument === '--check') {
      mode = 'check';
    } else if (argument === '--manifest-url' || argument === '--manifest') {
      manifestUrl = arguments_[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--manifest-url=')) {
      manifestUrl = argument.slice('--manifest-url='.length);
    } else if (argument.startsWith('--manifest=')) {
      manifestUrl = argument.slice('--manifest='.length);
    } else if (argument.startsWith('https://') && !manifestUrl) {
      manifestUrl = argument;
    } else {
      throw new Error(`Unknown baseline option: ${argument}`);
    }
  }
  if (!manifestUrl) {
    throw new Error('Supply an HTTPS manifest URL or set CATALOG_MANIFEST_URL.');
  }
  return { manifestUrl: requireHttpsUrl(manifestUrl, 'manifest'), mode };
}

async function fetchVerifiedBytes(
  url: string,
  expectedBytes: number,
  expectedHash: string,
  request: typeof fetch,
) {
  const response = await request(requireHttpsUrl(url, 'artifact'));
  if (!response.ok) throw new Error(`Artifact request failed with HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`Artifact ${expectedHash} has the wrong byte length.`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(`Artifact ${expectedHash} failed SHA-256 verification.`);
  }
  return bytes;
}

async function fetchFreeDeckArtifact(
  deck: CatalogManifest['decks'][number],
  request: typeof fetch,
) {
  if (!deck.content.url) throw new Error(`Free deck ${deck.id} has no content URL.`);
  const contentBytes = await fetchVerifiedBytes(
    deck.content.url,
    deck.content.bytes,
    deck.content.hash,
    request,
  );
  return parseDeckContentArtifact(
    JSON.parse(new TextDecoder().decode(contentBytes)),
    deck,
  );
}

function replaceManagedBlock(
  source: string,
  start: string,
  end: string,
  replacement: string,
  newline: string,
) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Managed source markers are missing: ${start} / ${end}`);
  }
  const contentStart = startIndex + start.length;
  return `${source.slice(0, contentStart)}${newline}${replacement}${newline}${source.slice(endIndex)}`;
}

function renderCoverRegistry(paths: string[], newline: string) {
  const uniquePaths = [...new Set(paths)].sort();
  const lines = uniquePaths.map(
    (path) => `  ${JSON.stringify(path)}: require(${JSON.stringify(`../../${path}`)}),`,
  );
  return ['{', ...lines, '}'].join(newline);
}

function baselineCoverPath(hash: string) {
  return `assets/images/decks/baseline/${hash}.webp`;
}

function resolveRepositoryPath(repositoryRoot: string, repositoryPath: string) {
  const absolutePath = resolve(repositoryRoot, ...repositoryPath.split('/'));
  const relativePath = relative(repositoryRoot, absolutePath);
  if (relativePath.startsWith('..') || relativePath === '' || relativePath.split(sep).includes('..')) {
    throw new Error(`Generated path escapes the repository: ${repositoryPath}`);
  }
  return absolutePath;
}

function requireHttpsUrl(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${label} URL must use HTTPS.`);
  return url.toString();
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertWebp(bytes: Uint8Array, deckId: string) {
  const signature = new TextDecoder('ascii').decode(bytes.subarray(0, 12));
  if (!signature.startsWith('RIFF') || signature.slice(8, 12) !== 'WEBP') {
    throw new Error(`Deck ${deckId} cover is not a WebP file.`);
  }
}

async function fileMatches(path: string, expected: Uint8Array) {
  try {
    const actual = await readFile(path);
    return actual.byteLength === expected.byteLength && sha256(actual) === sha256(expected);
  } catch {
    return false;
  }
}

async function generatedCoverSetMatches(
  repositoryRoot: string,
  expectedCovers: Map<string, Uint8Array>,
) {
  const directory = resolve(repositoryRoot, 'assets/images/decks/baseline');
  try {
    const expectedPaths = new Set(expectedCovers.keys());
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.every((entry) => {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.webp$/.test(entry.name)) return true;
      return expectedPaths.has(`assets/images/decks/baseline/${entry.name}`);
    });
  } catch {
    return expectedCovers.size === 0;
  }
}

async function mapConcurrent<Input, Output>(
  values: Input[],
  concurrency: number,
  operation: (value: Input) => Promise<Output>,
) {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(values[index]);
      }
    }),
  );
  return results;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? `ERROR: ${error.message}` : String(error));
    process.exitCode = 1;
  });
}

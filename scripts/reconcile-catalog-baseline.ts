export const CATALOG_BASELINE_BRANCH = 'automation/catalog-baseline';

export type PreparedCatalogBaseline = {
  revision: number;
};

export type CatalogReconciliationRequest = {
  manifestUrl: string;
  correlationId: string;
  environment: 'production';
  publishedRevision?: number;
};

export type CatalogReconciliationDependencies<
  Prepared extends PreparedCatalogBaseline = PreparedCatalogBaseline,
> = {
  prepare: (manifestUrl: string) => Promise<Prepared>;
  isCurrent: (prepared: Prepared) => Promise<boolean>;
  committedRevision: () => Promise<number>;
  write: (prepared: Prepared) => Promise<void>;
  changedPaths: () => Promise<string[]>;
  verify: () => Promise<void>;
  publish: (details: {
    branch: typeof CATALOG_BASELINE_BRANCH;
    correlationId: string;
    direction: 'forward' | 'regression';
    environment: 'production';
    publishedRevision?: number;
    revision: number;
  }) => Promise<{ pullRequestNumber: number; pullRequestUrl: string }>;
  enableAutoMerge: (
    pullRequestNumber: number,
  ) => Promise<'enabled' | 'unavailable'>;
  disableExistingAutoMerge: () => Promise<void>;
  disableAutoMerge: (pullRequestNumber: number) => Promise<void>;
  closeObsoletePullRequest: () => Promise<void>;
};

export type CatalogReconciliationResult =
  | { status: 'current'; revision: number }
  | {
      status: 'pull-request';
      revision: number;
      direction: 'forward' | 'regression';
      pullRequestNumber: number;
      pullRequestUrl: string;
      autoMerge: 'enabled' | 'unavailable' | 'not-eligible';
    };

export async function reconcileCatalogBaseline<Prepared extends PreparedCatalogBaseline>(
  request: CatalogReconciliationRequest,
  dependencies: CatalogReconciliationDependencies<Prepared>,
): Promise<CatalogReconciliationResult> {
  if (!request.manifestUrl.trim()) {
    throw new Error('CATALOG_MANIFEST_URL is required.');
  }
  if (!request.correlationId.trim()) {
    throw new Error('A publication correlation identifier is required.');
  }
  if (!request.environment.trim()) {
    throw new Error('A catalog environment is required.');
  }
  const prepared = await dependencies.prepare(request.manifestUrl);
  if (await dependencies.isCurrent(prepared)) {
    await dependencies.closeObsoletePullRequest();
    return { status: 'current', revision: prepared.revision };
  }

  const committedRevision = await dependencies.committedRevision();
  const direction = prepared.revision > committedRevision ? 'forward' : 'regression';
  await dependencies.write(prepared);
  const changedPaths = await dependencies.changedPaths();
  const unexpectedPaths = changedPaths.filter((path) => !isGeneratedBaselinePath(path));
  if (direction === 'regression' || unexpectedPaths.length > 0) {
    await dependencies.disableExistingAutoMerge();
  }
  if (unexpectedPaths.length > 0) {
    throw new Error(
      `Refusing to publish unexpected paths: ${unexpectedPaths.join(', ')}`,
    );
  }

  await dependencies.verify();
  const pullRequest = await dependencies.publish({
    branch: CATALOG_BASELINE_BRANCH,
    correlationId: request.correlationId,
    direction,
    environment: request.environment,
    publishedRevision: request.publishedRevision,
    revision: prepared.revision,
  });
  let autoMerge: 'enabled' | 'unavailable' | 'not-eligible' = 'not-eligible';
  if (direction === 'forward') {
    autoMerge = await dependencies.enableAutoMerge(pullRequest.pullRequestNumber);
  } else {
    await dependencies.disableAutoMerge(pullRequest.pullRequestNumber);
  }
  return {
    status: 'pull-request',
    revision: prepared.revision,
    direction,
    ...pullRequest,
    autoMerge,
  };
}

export function isGeneratedBaselinePath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  return normalized === 'src/data/bundles.ts'
    || /^assets\/images\/decks\/baseline\/[a-f0-9]{64}\.webp$/.test(normalized);
}

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

export type CatalogPublishMetadata = {
  branch: typeof CATALOG_BASELINE_BRANCH;
  correlationId: string;
  direction: 'forward' | 'regression';
  environment: 'production';
  publishedRevision?: number;
  revision: number;
  unexpectedPaths: string[];
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
  publish: (details: CatalogPublishMetadata) => Promise<{
    pullRequestNumber: number;
    pullRequestUrl: string;
  }>;
  waitForRequiredChecks: (pullRequestNumber: number) => Promise<boolean>;
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
       autoMerge: 'enabled' | 'unavailable' | 'not-eligible' | 'checks-failed' | 'unexpected-paths';
       unexpectedPaths: string[];
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

  const pullRequest = await dependencies.publish({
    branch: CATALOG_BASELINE_BRANCH,
    correlationId: request.correlationId,
    direction,
    environment: request.environment,
    publishedRevision: request.publishedRevision,
    revision: prepared.revision,
    unexpectedPaths,
  });
  // Publishing first preserves a reviewable PR even when local verification cannot
  // complete. Automation authority remains limited to generated paths; unexpected
  // content is exposed separately as review evidence and is never committed.
  await dependencies.verify();
  let autoMerge: 'enabled' | 'unavailable' | 'not-eligible' | 'checks-failed' |
    'unexpected-paths' = unexpectedPaths.length > 0 ? 'unexpected-paths' : 'not-eligible';
  if (direction === 'forward' && unexpectedPaths.length === 0) {
    autoMerge = await dependencies.waitForRequiredChecks(pullRequest.pullRequestNumber)
      ? await dependencies.enableAutoMerge(pullRequest.pullRequestNumber)
      : 'checks-failed';
  } else {
    await dependencies.disableAutoMerge(pullRequest.pullRequestNumber);
  }
  return {
    status: 'pull-request',
    revision: prepared.revision,
    direction,
    ...pullRequest,
    autoMerge,
    unexpectedPaths,
  };
}

export function isGeneratedBaselinePath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  return normalized === 'src/data/bundles.ts'
    || /^assets\/images\/decks\/baseline\/[a-f0-9]{64}\.webp$/.test(normalized);
}

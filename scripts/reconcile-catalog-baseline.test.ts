import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  reconcileCatalogBaseline,
  type CatalogReconciliationDependencies,
  type CatalogReconciliationRequest,
} from './reconcile-catalog-baseline';

describe('catalog baseline reconciliation', () => {
  it('does nothing when the Bundled Catalog Baseline already matches production', async () => {
    const fixture = reconciliationFixture({ committedRevision: 41, activeRevision: 41 });

    const result = await reconcileCatalogBaseline(fixture.request, fixture.dependencies);

    assert.deepEqual(result, { status: 'current', revision: 41 });
    assert.deepEqual(fixture.calls, ['prepare', 'is-current', 'close-obsolete']);
  });

  it('publishes a verified forward update and enables auto-merge', async () => {
    const fixture = reconciliationFixture({
      committedRevision: 41,
      activeRevision: 42,
      changedPaths: [
        'src/data/bundles.ts',
        `assets/images/decks/baseline/${'a'.repeat(64)}.webp`,
      ],
    });

    const result = await reconcileCatalogBaseline(fixture.request, fixture.dependencies);

    assert.deepEqual(result, {
      status: 'pull-request',
      revision: 42,
      direction: 'forward',
      pullRequestNumber: 18,
      pullRequestUrl: 'https://example.test/pr/18',
      autoMerge: 'enabled',
    });
    assert.deepEqual(fixture.calls, [
      'prepare',
      'is-current',
      'committed-revision',
      'write',
      'changed-paths',
      'verify',
      'publish:forward:42:publication-123',
      'auto-merge',
    ]);
  });

  it('rejects unexpected generated paths before verification or publication', async () => {
    const fixture = reconciliationFixture({
      committedRevision: 41,
      activeRevision: 42,
      changedPaths: ['src/data/bundles.ts', '.github/workflows/upload-testflight.yml'],
    });

    await assert.rejects(
      reconcileCatalogBaseline(fixture.request, fixture.dependencies),
      /Refusing to publish unexpected paths: \.github\/workflows\/upload-testflight\.yml/,
    );
    assert.deepEqual(fixture.calls, [
      'prepare',
      'is-current',
      'committed-revision',
      'write',
      'changed-paths',
    ]);
  });

  it('publishes a regression for review without enabling auto-merge', async () => {
    const fixture = reconciliationFixture({
      committedRevision: 43,
      activeRevision: 42,
      changedPaths: ['src/data/bundles.ts'],
    });

    const result = await reconcileCatalogBaseline(fixture.request, fixture.dependencies);

    assert.equal(result.status, 'pull-request');
    if (result.status !== 'pull-request') return;
    assert.equal(result.direction, 'regression');
    assert.equal(result.autoMerge, 'not-eligible');
    assert.equal(fixture.calls.includes('auto-merge'), false);
    assert.equal(fixture.calls.includes('disable-auto-merge'), true);
    assert.equal(fixture.calls.includes('disable-existing-auto-merge'), true);
    assert.ok(
      fixture.calls.indexOf('disable-existing-auto-merge')
        < fixture.calls.indexOf('verify'),
    );
  });

  it('leaves a valid forward pull request open when auto-merge is unavailable', async () => {
    const fixture = reconciliationFixture({
      committedRevision: 41,
      activeRevision: 42,
      changedPaths: ['src/data/bundles.ts'],
      autoMergeUnavailable: true,
    });

    const result = await reconcileCatalogBaseline(fixture.request, fixture.dependencies);

    assert.equal(result.status, 'pull-request');
    if (result.status !== 'pull-request') return;
    assert.equal(result.autoMerge, 'unavailable');
    assert.equal(result.pullRequestNumber, 18);
  });

  it('does not publish when verification fails', async () => {
    const fixture = reconciliationFixture({
      committedRevision: 41,
      activeRevision: 42,
      changedPaths: ['src/data/bundles.ts'],
      verificationFails: true,
    });

    await assert.rejects(
      reconcileCatalogBaseline(fixture.request, fixture.dependencies),
      /Quality verification failed/,
    );
    assert.equal(fixture.calls.some((call) => call.startsWith('publish:')), false);
  });

  it('fails before generation when required configuration is missing', async () => {
    const fixture = reconciliationFixture({ committedRevision: 41, activeRevision: 42 });
    fixture.request.manifestUrl = '';

    await assert.rejects(
      reconcileCatalogBaseline(fixture.request, fixture.dependencies),
      /CATALOG_MANIFEST_URL is required/,
    );
    assert.deepEqual(fixture.calls, []);
  });

  it('converges rapid publications on one fixed branch and pull request', async () => {
    const fixture = reconciliationFixture({
      committedRevision: 41,
      activeRevision: 42,
      changedPaths: ['src/data/bundles.ts'],
    });

    const first = await reconcileCatalogBaseline(fixture.request, fixture.dependencies);
    fixture.setActiveRevision(43);
    const second = await reconcileCatalogBaseline(fixture.request, fixture.dependencies);

    assert.equal(first.status, 'pull-request');
    assert.equal(second.status, 'pull-request');
    if (first.status !== 'pull-request' || second.status !== 'pull-request') return;
    assert.deepEqual([first.pullRequestNumber, second.pullRequestNumber], [18, 18]);
    assert.deepEqual(
      fixture.published.map((details) => details.branch),
      ['automation/catalog-baseline', 'automation/catalog-baseline'],
    );
    assert.deepEqual(fixture.published.map((details) => details.revision), [42, 43]);
  });

  it('treats the event revision as trace metadata and trusts the fetched manifest', async () => {
    const fixture = reconciliationFixture({
      committedRevision: 41,
      activeRevision: 42,
      changedPaths: ['src/data/bundles.ts'],
    });
    fixture.request.publishedRevision = 999;

    const result = await reconcileCatalogBaseline(fixture.request, fixture.dependencies);

    assert.equal(result.revision, 42);
    assert.equal(fixture.published[0].publishedRevision, 999);
    assert.equal(fixture.published[0].revision, 42);
  });
});

function reconciliationFixture({
  committedRevision,
  activeRevision,
  changedPaths = [],
  autoMergeUnavailable = false,
  verificationFails = false,
}: {
  committedRevision: number;
  activeRevision: number;
  changedPaths?: string[];
  autoMergeUnavailable?: boolean;
  verificationFails?: boolean;
}) {
  const calls: string[] = [];
  const published: Parameters<CatalogReconciliationDependencies['publish']>[0][] = [];
  let currentActiveRevision = activeRevision;
  const request: CatalogReconciliationRequest = {
    manifestUrl: 'https://api.example.test/catalog/manifest',
    correlationId: 'publication-123',
  };
  const dependencies: CatalogReconciliationDependencies = {
    prepare: async () => {
      calls.push('prepare');
      return { revision: currentActiveRevision };
    },
    isCurrent: async () => {
      calls.push('is-current');
      return committedRevision === currentActiveRevision;
    },
    committedRevision: async () => {
      calls.push('committed-revision');
      return committedRevision;
    },
    write: async () => { calls.push('write'); },
    changedPaths: async () => {
      calls.push('changed-paths');
      return changedPaths;
    },
    verify: async () => {
      calls.push('verify');
      if (verificationFails) throw new Error('Quality verification failed');
    },
    publish: async (details) => {
      published.push(details);
      calls.push(
        `publish:${details.direction}:${details.revision}:${details.correlationId}`,
      );
      return { pullRequestNumber: 18, pullRequestUrl: 'https://example.test/pr/18' };
    },
    enableAutoMerge: async () => {
      calls.push('auto-merge');
      return autoMergeUnavailable ? 'unavailable' : 'enabled';
    },
    disableExistingAutoMerge: async () => {
      calls.push('disable-existing-auto-merge');
    },
    disableAutoMerge: async () => { calls.push('disable-auto-merge'); },
    closeObsoletePullRequest: async () => { calls.push('close-obsolete'); },
  };
  return {
    calls,
    dependencies,
    published,
    request,
    setActiveRevision: (revision: number) => { currentActiveRevision = revision; },
  };
}

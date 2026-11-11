import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  classifyRevision,
  reconcileCatalogBaseline,
  validateGeneratedPaths,
  type ReconciliationDependencies,
} from './reconcile-catalog-baseline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(overrides: Partial<ReconciliationDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: ReconciliationDependencies = {
    manifestUrl: 'https://catalog.example/manifest.json',
    fetchActiveBaseline: async (url) => {
      calls.push(`fetch:${url}`);
      return { revision: 11, prepared: {} };
    },
    repository: {
      readCommittedRevision: async () => 10,
      baselineIsCurrent: async () => false,
      prepareFixedBranch: async () => { calls.push('prepare'); },
      writeBaseline: async () => { calls.push('write'); },
      changedPaths: async () => ['src/data/bundles.ts'],
      verify: async () => { calls.push('verify'); },
      commitAndPush: async (message) => { calls.push(`push:${message}`); },
    },
    github: {
      upsertRollingPullRequest: async (metadata) => {
        calls.push(`pr:${metadata.correlationId}`);
        return { number: 18 };
      },
      waitForRequiredChecks: async (number) => { calls.push(`checks:${number}`); return true; },
      enableAutoMerge: async (number) => { calls.push(`merge:${number}`); return true; },
    },
    ...overrides,
  };
  return { calls, dependencies };
}

describe('catalog baseline reconciliation policy', () => {
  it('classifies forward, equal, and regression revisions', () => {
    assert.equal(classifyRevision(11, 10), 'forward');
    assert.equal(classifyRevision(10, 10), 'equal');
    assert.equal(classifyRevision(9, 10), 'regression');
  });

  it('accepts only generated baseline paths', () => {
    assert.deepEqual(validateGeneratedPaths([
      'src/data/bundles.ts',
      'assets/images/decks/baseline/a.webp',
    ]), { allowed: true, unexpected: [] });
    assert.deepEqual(validateGeneratedPaths(['package.json']), {
      allowed: false,
      unexpected: ['package.json'],
    });
  });
});

describe('catalog baseline reconciliation', () => {
  it('ignores non-production and unsuccessful publication events before fetching', async () => {
    const { calls, dependencies } = fixture();
    const result = await reconcileCatalogBaseline(dependencies, {
      trigger: 'repository_dispatch', environment: 'staging', status: 'succeeded',
      publishedRevision: 99, correlationId: 'pub-staging',
    });
    assert.deepEqual(result, { outcome: 'ignored', reason: 'non-production-publication' });
    assert.deepEqual(calls, []);
  });

  it('rejects a production event without complete trace metadata before fetching', async () => {
    const { calls, dependencies } = fixture();
    await assert.rejects(
      reconcileCatalogBaseline(dependencies, {
        trigger: 'repository_dispatch', environment: 'production', status: 'succeeded',
        correlationId: '',
      }),
      /published revision and correlation identifier/,
    );
    assert.deepEqual(calls, []);
  });

  it('does nothing when the independently fetched active baseline is current', async () => {
    const { calls, dependencies } = fixture({
      repository: {
        readCommittedRevision: async () => 11,
        baselineIsCurrent: async () => true,
        prepareFixedBranch: async () => { throw new Error('must not write'); },
        writeBaseline: async () => { throw new Error('must not write'); },
        changedPaths: async () => [], verify: async () => {}, commitAndPush: async () => {},
      },
    });
    const result = await reconcileCatalogBaseline(dependencies, {
      trigger: 'schedule', correlationId: 'scheduled-1',
    });
    assert.deepEqual(result, { outcome: 'current', activeRevision: 11 });
    assert.deepEqual(calls, ['fetch:https://catalog.example/manifest.json']);
  });

  it('publishes and enables auto-merge for a verified forward update', async () => {
    const { calls, dependencies } = fixture();
    const result = await reconcileCatalogBaseline(dependencies, {
      trigger: 'repository_dispatch', environment: 'production', status: 'succeeded',
      publishedRevision: 77, correlationId: 'publication-abc',
    });
    assert.deepEqual(result, { outcome: 'pull-request', pullRequestNumber: 18,
      direction: 'forward', autoMerge: 'enabled', activeRevision: 11 });
    assert.deepEqual(calls, [
      'fetch:https://catalog.example/manifest.json', 'prepare', 'write', 'verify',
      'push:chore(catalog): reconcile baseline to revision 11 [publication-abc]',
      'pr:publication-abc', 'checks:18', 'merge:18',
    ]);
  });

  it('converges two publications through one fixed branch and one rolling pull request', async () => {
    const activeRevisions = [11, 12];
    const writtenRevisions: number[] = [];
    const branchPreparations: string[] = [];
    const pullRequests = new Map<string, { number: number; revision: number }>();
    let preparedRevision = 0;
    const { dependencies } = fixture({
      fetchActiveBaseline: async () => {
        const revision = activeRevisions.shift();
        assert.ok(revision);
        return { revision, prepared: { revision } };
      },
      repository: {
        readCommittedRevision: async () => 10,
        baselineIsCurrent: async () => false,
        prepareFixedBranch: async () => { branchPreparations.push('automation/catalog-baseline'); },
        writeBaseline: async (prepared) => {
          preparedRevision = (prepared as { revision: number }).revision;
          writtenRevisions.push(preparedRevision);
        },
        changedPaths: async () => ['src/data/bundles.ts'],
        verify: async () => {},
        commitAndPush: async () => {},
      },
      github: {
        upsertRollingPullRequest: async (metadata) => {
          const branch = 'automation/catalog-baseline';
          const existing = pullRequests.get(branch);
          const pullRequest = existing ?? { number: 18, revision: preparedRevision };
          pullRequest.revision = metadata.activeRevision;
          pullRequests.set(branch, pullRequest);
          return { number: pullRequest.number };
        },
        waitForRequiredChecks: async () => true,
        enableAutoMerge: async () => true,
      },
    });

    const first = await reconcileCatalogBaseline(dependencies, {
      trigger: 'repository_dispatch', environment: 'production', status: 'succeeded',
      publishedRevision: 11, correlationId: 'publication-11',
    });
    const second = await reconcileCatalogBaseline(dependencies, {
      trigger: 'repository_dispatch', environment: 'production', status: 'succeeded',
      publishedRevision: 12, correlationId: 'publication-12',
    });

    assert.deepEqual(writtenRevisions, [11, 12]);
    assert.deepEqual(branchPreparations, ['automation/catalog-baseline', 'automation/catalog-baseline']);
    assert.equal(pullRequests.size, 1);
    assert.deepEqual(pullRequests.get('automation/catalog-baseline'), { number: 18, revision: 12 });
    assert.equal(first.pullRequestNumber, 18);
    assert.equal(second.pullRequestNumber, 18);
    assert.equal(second.activeRevision, 12);
  });

  it('leaves the pull request open when required checks fail', async () => {
    const { calls, dependencies } = fixture();
    dependencies.github.waitForRequiredChecks = async (number) => {
      calls.push(`checks:${number}`);
      return false;
    };
    const result = await reconcileCatalogBaseline(dependencies, {
      trigger: 'schedule', correlationId: 'scheduled-check-failure',
    });
    assert.equal(result.outcome, 'pull-request');
    assert.equal(result.autoMerge, 'checks-failed');
    assert.ok(!calls.some((call) => call.startsWith('merge:')));
  });

  it('leaves a regression pull request open for review', async () => {
    const { calls, dependencies } = fixture({
      fetchActiveBaseline: async () => ({ revision: 9, prepared: {} }),
    });
    const result = await reconcileCatalogBaseline(dependencies, {
      trigger: 'workflow_dispatch', correlationId: 'manual-review',
    });
    assert.equal(result.outcome, 'pull-request');
    assert.equal(result.direction, 'regression');
    assert.equal(result.autoMerge, 'not-requested');
    assert.ok(!calls.some((call) => call.startsWith('merge:')));
  });

  it('rejects an unexpected generated path before push or pull request', async () => {
    const { calls, dependencies } = fixture();
    dependencies.repository.changedPaths = async () => ['src/data/bundles.ts', 'app.json'];
    await assert.rejects(
      reconcileCatalogBaseline(dependencies, { trigger: 'schedule', correlationId: 'scheduled-2' }),
      /Unexpected generated path: app\.json/,
    );
    assert.ok(!calls.some((call) => call.startsWith('push:') || call.startsWith('pr:')));
  });

  it('fails closed when configuration or verification is missing', async () => {
    const { dependencies } = fixture({ manifestUrl: '' });
    await assert.rejects(
      reconcileCatalogBaseline(dependencies, { trigger: 'schedule', correlationId: 'x' }),
      /CATALOG_MANIFEST_URL/,
    );
    const second = fixture();
    second.dependencies.repository.verify = async () => { throw new Error('quality failed'); };
    await assert.rejects(
      reconcileCatalogBaseline(second.dependencies, { trigger: 'schedule', correlationId: 'y' }),
      /quality failed/,
    );
    assert.ok(!second.calls.some((call) => call.startsWith('push:')));
  });

  it('keeps a valid pull request open when repository auto-merge is unavailable', async () => {
    const { calls, dependencies } = fixture();
    dependencies.github.enableAutoMerge = async () => false;
    const result = await reconcileCatalogBaseline(dependencies, {
      trigger: 'schedule', correlationId: 'scheduled-3',
    });
    assert.equal(result.outcome, 'pull-request');
    assert.equal(result.autoMerge, 'unavailable');
    assert.ok(calls.includes('checks:18'));
  });
});

describe('receiver workflow contract', () => {
  it('uses App authentication, one fixed branch/concurrency group, and no release trigger', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/reconcile-catalog-baseline.yml'), 'utf8');
    assert.match(workflow, /repository_dispatch:\s*\n\s*types: \[catalog-production-published\]/);
    assert.match(workflow, /schedule:\s*\n\s*- cron: '17 9 \* \* \*'/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /group: catalog-baseline-reconciliation/);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.match(workflow, /actions\/create-github-app-token@v2/);
    assert.match(workflow, /BOT_BRANCH: automation\/catalog-baseline/);
    assert.match(workflow, /timeout-minutes: 45/);
    assert.doesNotMatch(workflow, /pull_request_target|personal_access_token|eas|testflight|store submission/i);
  });

  it('documents the external publication sender owner and exact handoff boundary', async () => {
    const documentation = (
      await readFile(resolve(root, 'docs/catalog-baseline-reconciliation.md'), 'utf8')
    ).replace(/\s+/g, ' ');
    assert.match(documentation, /private `CadeLawless\/whatz-it-deck-platform` repository/);
    assert.match(documentation, /`PublicationCoordinator::publish\(\)`/);
    assert.match(documentation, /`ArtifactPromoter::activateManifest\(\)` succeeds/);
    assert.match(documentation, /`publication_preparations` transitions from `database_active` to `active`/);
    assert.match(documentation, /public `\/api\/v1\/catalog\/manifest`/);
    assert.match(documentation, /`preparationId` as `correlation_id`/);
    assert.match(documentation, /`catalog\.revision` as `published_revision`/);
    assert.match(documentation, /sender implementation and integration exercise remain required externally/i);
  });
});

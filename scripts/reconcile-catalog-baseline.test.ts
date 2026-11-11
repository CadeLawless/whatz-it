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
      'pr:publication-abc', 'merge:18',
    ]);
  });

  it('converges rapid events on public state rather than the event revision', async () => {
    const { calls, dependencies } = fixture();
    await reconcileCatalogBaseline(dependencies, {
      trigger: 'repository_dispatch', environment: 'production', status: 'succeeded',
      publishedRevision: 999, correlationId: 'older-event',
    });
    assert.equal(calls[0], 'fetch:https://catalog.example/manifest.json');
    assert.ok(calls.some((call) => call.includes('revision 11')));
    assert.ok(!calls.some((call) => call.includes('999')));
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
    const { dependencies } = fixture();
    dependencies.github.enableAutoMerge = async () => false;
    const result = await reconcileCatalogBaseline(dependencies, {
      trigger: 'schedule', correlationId: 'scheduled-3',
    });
    assert.equal(result.outcome, 'pull-request');
    assert.equal(result.autoMerge, 'unavailable');
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
    assert.doesNotMatch(workflow, /pull_request_target|personal_access_token|eas|testflight|store submission/i);
  });
});

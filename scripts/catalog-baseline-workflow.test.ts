import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const workflowPath = resolve('.github/workflows/reconcile-catalog-baseline.yml');

describe('catalog baseline reconciliation workflow contract', () => {
  it('supports production publication, daily recovery, and manual recovery', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    assert.match(workflow, /repository_dispatch:\s*\n\s+types: \[catalog-production-published\]/);
    assert.match(workflow, /schedule:\s*\n\s+- cron: ['"]\d+ \d+ \* \* \*['"]/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /client_payload\.environment == 'production'/);
    assert.match(workflow, /client_payload\.published_revision/);
    assert.match(workflow, /client_payload\.correlation_id/);
  });

  it('uses one cancelling concurrency group and one GitHub App identity', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    assert.match(workflow, /group: catalog-baseline-reconciliation/);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.match(workflow, /actions\/create-github-app-token@v3/);
    assert.doesNotMatch(workflow, /pull_request_target|personal access token|PAT_TOKEN/);
  });

  it('does not invoke an app-release workflow', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    assert.doesNotMatch(workflow, /eas (build|submit)|upload-testflight|workflow_call|workflow_run/);
  });
});

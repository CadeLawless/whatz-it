import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('canonical quality contract', () => {
  it('runs cacheless lint, typecheck, all tests, and the live baseline check in order', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    assert.equal(packageJson.scripts['lint:cacheless'], 'eslint . --no-cache');
    assert.equal(
      packageJson.scripts.quality,
      'npm run lint:cacheless && npm run typecheck && npm test && npm run catalog:baseline:check',
    );
  });

  it('defines one read-only Node 22 job for pull requests, main, and merge queue commits', async () => {
    const workflow = await readFile(
      resolve(repositoryRoot, '.github/workflows/quality.yml'),
      'utf8',
    );

    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
    assert.match(workflow, /merge_group:/);
    assert.match(workflow, /permissions:\s*\n\s*contents: read/);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.match(workflow, /node-version: 22/);
    assert.match(workflow, /cache: npm/);
    assert.match(workflow, /run: npm ci/);
    assert.match(workflow, /CATALOG_MANIFEST_URL: \$\{\{ vars\.CATALOG_MANIFEST_URL \}\}/);
    assert.match(workflow, /run: npm run quality/);
  });
});

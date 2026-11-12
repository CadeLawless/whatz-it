import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  baselineIsCurrent,
  fetchPreparedBaseline,
  type PreparedBaseline,
  writePreparedBaseline,
} from './prepare-catalog-baseline';
import {
  CATALOG_BASELINE_BRANCH,
  reconcileCatalogBaseline,
  type CatalogReconciliationDependencies,
} from './reconcile-catalog-baseline';

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseBranch = 'main';
const pullRequestTitle = 'chore: update the Bundled Catalog Baseline';

type RuntimePreparedBaseline = {
  revision: number;
  value: PreparedBaseline;
};

async function run() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Catalog reconciliation may only mutate the bot branch in GitHub Actions.');
  }

  const manifestUrl = requiredEnvironment('CATALOG_MANIFEST_URL');
  const correlationId = requiredEnvironment('PUBLICATION_CORRELATION_ID');
  const environment = 'production' as const;
  const repository = requiredEnvironment('GITHUB_REPOSITORY');
  requiredEnvironment('GH_TOKEN');
  validatePublicationMetadata();

  await command('git', ['fetch', 'origin', baseBranch]);
  const remoteBranchSha = await fetchRemoteBotBranch();
  await command('git', [
    'checkout',
    '-B',
    CATALOG_BASELINE_BRANCH,
    `origin/${baseBranch}`,
  ]);

  const dependencies = runtimeDependencies({
    correlationId,
    manifestUrl,
    remoteBranchSha,
    repository,
  });
  const publishedRevision = optionalPositiveInteger(process.env.PUBLISHED_REVISION);
  const result = await reconcileCatalogBaseline(
    { correlationId, environment, manifestUrl, publishedRevision },
    dependencies,
  );
  console.log(JSON.stringify(result));
}

function runtimeDependencies({
  correlationId,
  manifestUrl,
  remoteBranchSha,
  repository,
}: {
  correlationId: string;
  manifestUrl: string;
  remoteBranchSha: string | null;
  repository: string;
}): CatalogReconciliationDependencies<RuntimePreparedBaseline> {
  return {
    prepare: async (url) => {
      const value = await fetchPreparedBaseline(url);
      return { revision: value.catalog.revision, value };
    },
    isCurrent: async (prepared) => baselineIsCurrent(repositoryRoot, prepared.value),
    committedRevision: async () => readCommittedRevision(),
    write: async (prepared) => {
      await writePreparedBaseline(repositoryRoot, prepared.value);
    },
    changedPaths: gitChangedPaths,
    verify: async () => {
      await npm(['run', 'typecheck']);
      await npm(['test']);
      await npm(['run', 'lint']);
      await npm([
        'run',
        'catalog:baseline:check',
        '--',
        `--manifest-url=${manifestUrl}`,
      ]);
    },
    publish: async (details) => {
      const previousPullRequest = await openPullRequest(repository);
      await command('git', [
        'add',
        '--all',
        '--',
        'src/data/bundles.ts',
        'assets/images/decks/baseline',
      ]);
      await command('git', [
        'commit',
        '-m',
        `chore: update bundled catalog baseline to revision ${details.revision}`,
        '-m',
        `Publication-Correlation-ID: ${details.correlationId}`,
        '-m',
        `Publication-Environment: ${details.environment}\nPublished-Revision: ${details.publishedRevision ?? 'not supplied'}`,
      ]);
      const lease = remoteBranchSha
        ? `--force-with-lease=refs/heads/${details.branch}:${remoteBranchSha}`
        : `--force-with-lease=refs/heads/${details.branch}:`;
      await command('git', [
        'push',
        lease,
        'origin',
        `HEAD:refs/heads/${details.branch}`,
      ]);

      const body = pullRequestBody({
        correlationId: details.correlationId,
        direction: details.direction,
        environment: details.environment,
        manifestUrl,
        publishedRevision: details.publishedRevision,
        revision: details.revision,
      });
      const existing = previousPullRequest ?? await openPullRequest(repository);
      if (existing) {
        await gh([
          'pr',
          'edit',
          String(existing.number),
          '--repo',
          repository,
          '--title',
          pullRequestTitle,
          '--body',
          body,
        ]);
        return {
          pullRequestNumber: existing.number,
          pullRequestUrl: existing.url,
        };
      }
      const url = (await gh([
        'pr',
        'create',
        '--repo',
        repository,
        '--base',
        baseBranch,
        '--head',
        details.branch,
        '--title',
        pullRequestTitle,
        '--body',
        body,
      ])).trim();
      const created = await openPullRequest(repository);
      if (!created) throw new Error(`Created pull request was not discoverable: ${url}`);
      return { pullRequestNumber: created.number, pullRequestUrl: created.url };
    },
    enableAutoMerge: async (pullRequestNumber) => {
      const autoMergeAllowed = (await gh([
        'api',
        `repos/${repository}`,
        '--jq',
        '.allow_auto_merge',
      ])).trim() === 'true';
      if (!autoMergeAllowed) {
        console.log(
          '::notice::Auto-merge is unavailable; the verified catalog pull request remains open.',
        );
        return 'unavailable';
      }
      await gh([
        'pr',
        'merge',
        String(pullRequestNumber),
        '--repo',
        repository,
        '--auto',
        '--squash',
      ]);
      return 'enabled';
    },
    disableExistingAutoMerge: async () => {
      const existing = await openPullRequest(repository);
      if (existing) await disablePullRequestAutoMerge(repository, existing.number);
    },
    disableAutoMerge: async (pullRequestNumber) => {
      await disablePullRequestAutoMerge(repository, pullRequestNumber);
    },
    closeObsoletePullRequest: async () => {
      const existing = await openPullRequest(repository);
      if (!existing) return;
      await gh([
        'pr',
        'close',
        String(existing.number),
        '--repo',
        repository,
        '--comment',
        `Closed because the active public manifest already matches main. Correlation: ${correlationId}`,
      ]);
    },
  };
}

async function readCommittedRevision() {
  const source = await readFile(resolve(repositoryRoot, 'src/data/bundles.ts'), 'utf8');
  const start = '/* DECK_MANAGER_CATALOG_START */';
  const end = '/* DECK_MANAGER_CATALOG_END */';
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error('Bundled Catalog Baseline markers are missing.');
  }
  const catalog = JSON.parse(source.slice(startIndex + start.length, endIndex)) as {
    revision?: unknown;
  };
  if (!Number.isSafeInteger(catalog.revision) || (catalog.revision as number) < 0) {
    throw new Error('Bundled Catalog Baseline revision is invalid.');
  }
  return catalog.revision as number;
}

async function gitChangedPaths() {
  const output = await command('git', [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const path = line.slice(3);
      return path.includes(' -> ') ? [path.slice(path.indexOf(' -> ') + 4)] : [path];
    });
}

async function fetchRemoteBotBranch() {
  try {
    await command('git', [
      'fetch',
      'origin',
      `refs/heads/${CATALOG_BASELINE_BRANCH}:refs/remotes/origin/${CATALOG_BASELINE_BRANCH}`,
    ]);
    return (await command('git', [
      'rev-parse',
      `refs/remotes/origin/${CATALOG_BASELINE_BRANCH}`,
    ])).trim();
  } catch {
    return null;
  }
}

async function openPullRequest(repository: string) {
  const output = await gh([
    'pr',
    'list',
    '--repo',
    repository,
    '--head',
    CATALOG_BASELINE_BRANCH,
    '--base',
    baseBranch,
    '--state',
    'open',
    '--limit',
    '1',
    '--json',
    'number,url',
  ]);
  const pullRequests = JSON.parse(output) as { number: number; url: string }[];
  return pullRequests[0] ?? null;
}

async function disablePullRequestAutoMerge(repository: string, pullRequestNumber: number) {
  const autoMergeRequest = (await gh([
    'pr',
    'view',
    String(pullRequestNumber),
    '--repo',
    repository,
    '--json',
    'autoMergeRequest',
    '--jq',
    '.autoMergeRequest',
  ])).trim();
  if (!autoMergeRequest || autoMergeRequest === 'null') return;
  await gh([
    'pr',
    'merge',
    String(pullRequestNumber),
    '--repo',
    repository,
    '--disable-auto',
  ]);
}

function pullRequestBody({
  correlationId,
  direction,
  environment,
  manifestUrl,
  publishedRevision,
  revision,
}: {
  correlationId: string;
  direction: 'forward' | 'regression';
  environment: 'production';
  manifestUrl: string;
  publishedRevision?: number;
  revision: number;
}) {
  const regression = direction === 'regression'
    ? '\n\n> [!WARNING]\n> The active manifest revision is lower than main. This PR requires human review and will not be auto-merged.'
    : '';
  return [
    '## Automated Bundled Catalog Baseline reconciliation',
    '',
    `- Active public manifest revision: **${revision}**`,
    `- Event revision hint: **${publishedRevision ?? 'not supplied'}**`,
    `- Direction from main: **${direction}**`,
    `- Publication environment: **${environment}**`,
    `- Publication correlation identifier: \`${correlationId}\``,
    `- Source of truth: \`${manifestUrl}\` (fetched independently during this run)`,
    '',
    'Only generated baseline catalog source and content-addressed baseline assets are included.',
    regression,
  ].join('\n');
}

function validatePublicationMetadata() {
  if (process.env.RECONCILIATION_TRIGGER !== 'publication') return;
  if (process.env.PUBLICATION_ENVIRONMENT !== 'production') {
    throw new Error('Publication reconciliation accepts only the production environment.');
  }
  if (optionalPositiveInteger(process.env.PUBLISHED_REVISION) === undefined) {
    throw new Error('A positive published revision is required for publication events.');
  }
}

function optionalPositiveInteger(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function npm(arguments_: string[]) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await command(executable, arguments_);
}

async function gh(arguments_: string[]) {
  return command('gh', arguments_);
}

async function command(executable: string, arguments_: string[]) {
  const result = await executeFile(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? `ERROR: ${error.message}` : String(error));
  process.exitCode = 1;
});

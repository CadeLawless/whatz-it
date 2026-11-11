import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  baselineIsCurrent,
  fetchPreparedBaseline,
  writePreparedBaseline,
  type PreparedBaseline,
} from './prepare-catalog-baseline';

export const FIXED_BOT_BRANCH = 'automation/catalog-baseline';
const GENERATED_CATALOG_PATH = 'src/data/bundles.ts';
const GENERATED_ASSET_PREFIX = 'assets/images/decks/baseline/';
const execFile = promisify(execFileCallback);

export type ReconciliationTrigger = {
  trigger: 'repository_dispatch' | 'schedule' | 'workflow_dispatch';
  environment?: string;
  status?: string;
  publishedRevision?: number;
  correlationId: string;
};

export type ReconciliationDependencies = {
  manifestUrl: string;
  fetchActiveBaseline: (manifestUrl: string) => Promise<{ revision: number; prepared: unknown }>;
  repository: {
    readCommittedRevision(): Promise<number>;
    baselineIsCurrent(prepared: unknown): Promise<boolean>;
    prepareFixedBranch(): Promise<void>;
    writeBaseline(prepared: unknown): Promise<void>;
    changedPaths(): Promise<string[]>;
    verify(): Promise<void>;
    commitAndPush(message: string): Promise<void>;
  };
  github: {
    upsertRollingPullRequest(metadata: PullRequestMetadata): Promise<{ number: number }>;
    enableAutoMerge(number: number): Promise<boolean>;
  };
};

type PullRequestMetadata = {
  activeRevision: number;
  committedRevision: number;
  direction: RevisionDirection;
  correlationId: string;
  publishedRevision?: number;
};

export type RevisionDirection = 'forward' | 'equal' | 'regression';

export function classifyRevision(activeRevision: number, committedRevision: number): RevisionDirection {
  if (activeRevision > committedRevision) return 'forward';
  if (activeRevision < committedRevision) return 'regression';
  return 'equal';
}

export function validateGeneratedPaths(paths: string[]) {
  const unexpected = paths.filter((path) => (
    path !== GENERATED_CATALOG_PATH && !path.startsWith(GENERATED_ASSET_PREFIX)
  ));
  return { allowed: unexpected.length === 0, unexpected };
}

export async function reconcileCatalogBaseline(
  dependencies: ReconciliationDependencies,
  trigger: ReconciliationTrigger,
) {
  if (!dependencies.manifestUrl) {
    throw new Error('Missing required CATALOG_MANIFEST_URL repository variable.');
  }
  if (
    trigger.trigger === 'repository_dispatch' &&
    (trigger.environment !== 'production' || trigger.status !== 'succeeded')
  ) {
    return { outcome: 'ignored' as const, reason: 'non-production-publication' as const };
  }
  if (
    trigger.trigger === 'repository_dispatch' &&
    (!Number.isInteger(trigger.publishedRevision) || !trigger.correlationId.trim())
  ) {
    throw new Error('Production publication events require a published revision and correlation identifier.');
  }

  const active = await dependencies.fetchActiveBaseline(dependencies.manifestUrl);
  const committedRevision = await dependencies.repository.readCommittedRevision();
  if (await dependencies.repository.baselineIsCurrent(active.prepared)) {
    return { outcome: 'current' as const, activeRevision: active.revision };
  }

  await dependencies.repository.prepareFixedBranch();
  await dependencies.repository.writeBaseline(active.prepared);
  const pathValidation = validateGeneratedPaths(await dependencies.repository.changedPaths());
  if (!pathValidation.allowed) {
    throw new Error(`Unexpected generated path: ${pathValidation.unexpected.join(', ')}`);
  }
  await dependencies.repository.verify();

  const direction = classifyRevision(active.revision, committedRevision);
  await dependencies.repository.commitAndPush(
    `chore(catalog): reconcile baseline to revision ${active.revision} [${trigger.correlationId}]`,
  );
  const pullRequest = await dependencies.github.upsertRollingPullRequest({
    activeRevision: active.revision,
    committedRevision,
    direction,
    correlationId: trigger.correlationId,
    ...(trigger.publishedRevision === undefined ? {} : { publishedRevision: trigger.publishedRevision }),
  });

  let autoMerge: 'enabled' | 'unavailable' | 'not-requested' = 'not-requested';
  if (direction === 'forward') {
    autoMerge = await dependencies.github.enableAutoMerge(pullRequest.number)
      ? 'enabled'
      : 'unavailable';
  }
  return {
    outcome: 'pull-request' as const,
    pullRequestNumber: pullRequest.number,
    direction,
    autoMerge,
    activeRevision: active.revision,
  };
}

async function command(commandName: string, arguments_: string[], cwd: string) {
  return execFile(commandName, arguments_, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

function parseCommittedRevision(source: string) {
  const match = source.match(/DECK_MANAGER_CATALOG_START[\s\S]*?"revision":\s*(\d+)/);
  if (!match) throw new Error('Unable to read the committed Bundled Catalog Baseline revision.');
  return Number(match[1]);
}

export function createProductionDependencies(repositoryRoot: string): ReconciliationDependencies {
  const manifestUrl = process.env.CATALOG_MANIFEST_URL ?? '';
  return {
    manifestUrl,
    fetchActiveBaseline: async (url) => {
      const prepared = await fetchPreparedBaseline(url);
      return { revision: prepared.catalog.revision, prepared };
    },
    repository: {
      readCommittedRevision: async () => parseCommittedRevision(
        await readFile(resolve(repositoryRoot, 'src/data/bundles.ts'), 'utf8'),
      ),
      baselineIsCurrent: (prepared) => baselineIsCurrent(repositoryRoot, prepared as PreparedBaseline),
      prepareFixedBranch: async () => {
        await command('git', ['fetch', 'origin', 'main'], repositoryRoot);
        await command('git', ['checkout', '-B', FIXED_BOT_BRANCH, 'origin/main'], repositoryRoot);
      },
      writeBaseline: (prepared) => writePreparedBaseline(repositoryRoot, prepared as PreparedBaseline),
      changedPaths: async () => {
        const result = await command('git', ['status', '--short'], repositoryRoot);
        return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
      },
      verify: async () => { await command('npm', ['run', 'quality'], repositoryRoot); },
      commitAndPush: async (message) => {
        await command('git', ['add', '--', GENERATED_CATALOG_PATH, GENERATED_ASSET_PREFIX], repositoryRoot);
        await command('git', ['commit', '-m', message], repositoryRoot);
        await command('git', ['push', '--force-with-lease', 'origin', `HEAD:${FIXED_BOT_BRANCH}`], repositoryRoot);
      },
    },
    github: {
      upsertRollingPullRequest: async (metadata) => {
        const title = `chore(catalog): reconcile baseline to revision ${metadata.activeRevision}`;
        const body = [
          'Automated Bundled Catalog Baseline reconciliation.', '',
          `- Active public revision: ${metadata.activeRevision}`,
          `- Committed revision: ${metadata.committedRevision}`,
          `- Direction: ${metadata.direction}`,
          `- Publication correlation ID: \`${metadata.correlationId}\``,
          ...(metadata.publishedRevision === undefined
            ? [] : [`- Event published revision (trace only): ${metadata.publishedRevision}`]),
          '', 'Generated from the independently fetched active public manifest. Closes #18.',
        ].join('\n');
        const listed = await command('gh', [
          'pr', 'list', '--state', 'open', '--head', FIXED_BOT_BRANCH,
          '--json', 'number', '--jq', '.[0].number // empty',
        ], repositoryRoot);
        const existing = listed.stdout.trim();
        if (existing) {
          await command('gh', ['pr', 'edit', existing, '--title', title, '--body', body], repositoryRoot);
          return { number: Number(existing) };
        }
        const created = await command('gh', [
          'pr', 'create', '--base', 'main', '--head', FIXED_BOT_BRANCH,
          '--title', title, '--body', body,
        ], repositoryRoot);
        const number = Number(created.stdout.trim().match(/\/(\d+)\s*$/)?.[1]);
        if (!Number.isInteger(number)) throw new Error('GitHub did not return a pull request number.');
        return { number };
      },
      enableAutoMerge: async (number) => {
        try {
          await command('gh', ['pr', 'merge', String(number), '--auto', '--squash'], repositoryRoot);
          return true;
        } catch (error) {
          console.warn(`Auto-merge is unavailable; pull request #${number} remains open.`, error);
          return false;
        }
      },
    },
  };
}

function triggerFromEnvironment(): ReconciliationTrigger {
  const trigger = process.env.RECONCILIATION_TRIGGER;
  if (trigger !== 'repository_dispatch' && trigger !== 'schedule' && trigger !== 'workflow_dispatch') {
    throw new Error('RECONCILIATION_TRIGGER must identify a supported workflow event.');
  }
  const published = process.env.PUBLISHED_REVISION;
  return {
    trigger,
    ...(process.env.PUBLICATION_ENVIRONMENT ? { environment: process.env.PUBLICATION_ENVIRONMENT } : {}),
    ...(process.env.PUBLICATION_STATUS ? { status: process.env.PUBLICATION_STATUS } : {}),
    ...(published ? { publishedRevision: Number(published) } : {}),
    correlationId: process.env.CORRELATION_ID ?? '',
  };
}

async function run() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await reconcileCatalogBaseline(
    createProductionDependencies(repositoryRoot),
    triggerFromEnvironment(),
  );
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

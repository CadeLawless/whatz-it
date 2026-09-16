import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  baselineIsCurrent,
  fetchPreparedBaseline,
} from './prepare-catalog-baseline';

const ENABLED = 'enabled';

type BuildEnvironment = Record<string, string | undefined>;

type BaselineVerifier = (
  manifestUrl: string,
  repositoryRoot: string,
) => Promise<{ current: boolean; revision: number }>;

export type EasReleaseBaselineResult =
  | { status: 'skipped' }
  | { status: 'current'; revision: number };

export async function verifyEasReleaseBaseline(
  environment: BuildEnvironment,
  repositoryRoot: string,
  verify: BaselineVerifier = verifyBaseline,
): Promise<EasReleaseBaselineResult> {
  if (environment.WHATZIT_VERIFY_RELEASE_BASELINE !== ENABLED) {
    return { status: 'skipped' };
  }

  const manifestUrl = environment.CATALOG_MANIFEST_URL
    ?? environment.EXPO_PUBLIC_CATALOG_MANIFEST_URL;
  if (!manifestUrl) {
    throw new Error(
      'Production baseline verification is enabled, but the production '
      + 'EXPO_PUBLIC_CATALOG_MANIFEST_URL environment variable is missing.',
    );
  }

  const result = await verify(manifestUrl, repositoryRoot);
  if (!result.current) {
    throw new Error(
      `Bundled catalog is stale for production revision ${result.revision}. `
      + 'Run npm run catalog:baseline:update with the production manifest, '
      + 'review the generated files, and commit them before rebuilding.',
    );
  }
  return { status: 'current', revision: result.revision };
}

async function verifyBaseline(manifestUrl: string, repositoryRoot: string) {
  const prepared = await fetchPreparedBaseline(manifestUrl);
  return {
    current: await baselineIsCurrent(repositoryRoot, prepared),
    revision: prepared.catalog.revision,
  };
}

async function run() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await verifyEasReleaseBaseline(process.env, repositoryRoot);
  if (result.status === 'skipped') {
    console.log('SKIP: release baseline verification is not enabled for this build profile.');
    return;
  }
  console.log(`PASS: production baseline matches active revision ${result.revision}.`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? `ERROR: ${error.message}` : String(error));
    process.exitCode = 1;
  });
}

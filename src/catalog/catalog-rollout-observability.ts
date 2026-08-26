import type { CatalogRuntimeSource } from './catalog-feature';
import { CatalogSyncError, type CatalogSyncResult } from './catalog-sync';

export type CatalogRolloutCohort =
  | 'bundled-fallback'
  | 'sqlite-local-only'
  | 'sqlite-server-sync';

export function catalogRolloutSelectedDetails(
  source: CatalogRuntimeSource,
  manifestUrl: string | null,
  catalogRevision: number,
  schemaVersion: number,
) {
  return {
    catalogRevision,
    cohort: catalogRolloutCohort(source, manifestUrl),
    schemaVersion,
    serverSyncEnabled: source === 'sqlite' && manifestUrl !== null,
    source,
  };
}

export function catalogSyncCompletedDetails(
  result: CatalogSyncResult,
  durationMs: number,
) {
  return {
    durationMs: normalizedDuration(durationMs),
    ...(result.status === 'updated'
      ? {
          downloadedDecks: result.downloadedDecks,
          downloadedMedia: result.downloadedMedia,
        }
      : {}),
    revision: result.revision,
    status: result.status,
  };
}

export function catalogSyncFailedDetails(
  error: Error,
  durationMs: number,
  retryAttempt: number,
  retryDelayMs: number,
) {
  return {
    durationMs: normalizedDuration(durationMs),
    errorCode:
      error instanceof CatalogSyncError ? error.code : 'unexpected_error',
    errorName: error.name || 'Error',
    retryAttempt,
    retryDelayMs,
  };
}

function catalogRolloutCohort(
  source: CatalogRuntimeSource,
  manifestUrl: string | null,
): CatalogRolloutCohort {
  if (source === 'bundled') return 'bundled-fallback';
  return manifestUrl ? 'sqlite-server-sync' : 'sqlite-local-only';
}

function normalizedDuration(durationMs: number) {
  return Math.max(0, Math.round(durationMs));
}

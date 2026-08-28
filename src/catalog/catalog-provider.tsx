import Constants from 'expo-constants';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';

import {
  BundledCatalogRepository,
  SqliteCatalogRepository,
} from './catalog-repository';
import {
  configuredCatalogManifestUrl,
  configuredCatalogSource,
  configuredDevPreviewEnabled,
  configuredDevPreviewKey,
} from './catalog-feature';
import { openCatalogDatabase } from './catalog-database';
import {
  catalogRolloutSelectedDetails,
  catalogSyncCompletedDetails,
  catalogSyncFailedDetails,
} from './catalog-rollout-observability';
import type { CatalogSnapshot } from './catalog-snapshot';
import { CatalogSyncError, synchronizeCatalog } from './catalog-sync';
import { recordFlightEvent } from '@/utils/flight-recorder';

const SYNC_FRESHNESS_MS = 5 * 60 * 1000;

type CatalogProviderCoreState =
  | { status: 'loading'; catalog: CatalogSnapshot }
  | {
      status: 'ready';
      catalog: CatalogSnapshot;
      syncStatus: 'disabled' | 'syncing' | 'synced' | 'failed';
      syncError?: Error;
    }
  | { status: 'error'; catalog: CatalogSnapshot; error: Error };

export type CatalogProviderState = CatalogProviderCoreState & {
  refreshCatalog: () => Promise<void>;
};

const bundledRepository = new BundledCatalogRepository();
const bundledSnapshotPromise = bundledRepository.load();
let bundledSnapshot: CatalogSnapshot | null = null;
void bundledSnapshotPromise.then((snapshot) => {
  bundledSnapshot = snapshot;
});

const CatalogContext = createContext<CatalogProviderState | null>(null);

export function CatalogProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<CatalogProviderCoreState | null>(() =>
    bundledSnapshot ? { status: 'loading', catalog: bundledSnapshot } : null,
  );
  const reportSyncError = useCallback((error: Error) => {
    setState((current) =>
      current
        ? {
            status: 'ready',
            catalog: current.catalog,
            syncStatus: 'failed',
            syncError: error,
          }
        : current,
    );
  }, []);
  const refreshCatalog = useCallback(async () => {
    if (configuredCatalogSource() !== 'sqlite') return;
    const repository = new SqliteCatalogRepository(await openCatalogDatabase());
    const catalog = await repository.load();
    setState((current) => {
      if (!current) return current;
      return current.status === 'ready'
        ? { ...current, catalog }
        : { status: 'ready', catalog, syncStatus: 'synced' };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let syncRunning = false;
    let lastSyncAttempt = 0;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();
    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
    void bundledSnapshotPromise
      .then(async (fallback) => {
        if (!cancelled) setState({ status: 'loading', catalog: fallback });
        const configuredSource = configuredCatalogSource();
        if (configuredSource === 'bundled') {
          recordFlightEvent(
            'catalog.rollout-selected',
            catalogRolloutSelectedDetails(
              configuredSource,
              null,
              fallback.revision,
              fallback.schemaVersion,
            ),
          );
          if (!cancelled) {
            setState({
              status: 'ready',
              catalog: fallback,
              syncStatus: 'disabled',
            });
          }
          return;
        }

        const database = await openCatalogDatabase();
        const repository = new SqliteCatalogRepository(database);
        const catalog = await repository.load();
        const developmentPreview = configuredDevPreviewEnabled();
        const manifestUrl = configuredCatalogManifestUrl(
          undefined,
          undefined,
          developmentPreview,
        );
        const developmentPreviewKey = configuredDevPreviewKey();
        if (developmentPreview && !manifestUrl) {
          throw new Error('Expo development preview requires a dedicated preview manifest URL.');
        }
        if (developmentPreview && !developmentPreviewKey) {
          throw new Error('Expo development preview requires a valid preview key.');
        }
        recordFlightEvent(
          'catalog.rollout-selected',
          catalogRolloutSelectedDetails(
            configuredSource,
            manifestUrl,
            catalog.revision,
            catalog.schemaVersion,
          ),
        );
        if (!cancelled) {
          setState(developmentPreview && manifestUrl
            ? { status: 'loading', catalog }
            : {
                status: 'ready',
                catalog,
                syncStatus: manifestUrl ? 'syncing' : 'disabled',
              });
        }
        if (!manifestUrl) return;
        const sync = async (force = false) => {
          const now = Date.now();
          if (
            cancelled ||
            syncRunning ||
            (!force && now - lastSyncAttempt < SYNC_FRESHNESS_MS)
          ) {
            return;
          }
          lastSyncAttempt = now;
          syncRunning = true;
          const startedAt = Date.now();
          const attempt = retryAttempt + 1;
          recordFlightEvent('catalog.sync-started', { attempt, force });
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
          }
          setState((current) =>
            current && current.status === 'ready'
              ? { ...current, syncStatus: 'syncing', syncError: undefined }
              : current,
          );
          try {
            const result = await synchronizeCatalog(database, {
              manifestUrl,
              appVersion: Constants.expoConfig?.version ?? '0.0.0',
              signal: abortController.signal,
              developmentPreview,
              downloadRuntime: developmentPreviewKey
                ? developmentPreviewDownloadRuntime(
                    manifestUrl,
                    developmentPreviewKey,
                  )
                : undefined,
            });
            if (cancelled) return;
            recordFlightEvent(
              'catalog.sync-completed',
              catalogSyncCompletedDetails(result, Date.now() - startedAt),
            );
            if (result.status === 'updated') {
              const refreshedCatalog = await repository.load();
              if (!cancelled) {
                setState({
                  status: 'ready',
                  catalog: refreshedCatalog,
                  syncStatus: 'synced',
                });
              }
            } else {
              setState((current) =>
                current
                  ? {
                      status: 'ready',
                      catalog: current.catalog,
                      syncStatus: 'synced',
                    }
                  : current,
              );
            }
            retryAttempt = 0;
          } catch (cause: unknown) {
            if (!cancelled) {
              const error = cause instanceof Error ? cause : new Error(String(cause));
              console.warn('[CatalogSync] Catalog preparation will retry.', {
                cause:
                  error.cause instanceof Error
                    ? error.cause.message
                    : error.cause === undefined
                      ? null
                      : String(error.cause),
                code:
                  error instanceof CatalogSyncError
                    ? error.code
                    : 'unexpected_error',
                developmentPreview,
                message: error.message,
                previewKeyConfigured: developmentPreviewKey !== null,
              });
              reportSyncError(error);
              lastSyncAttempt = 0;
              const retryDelay = Math.min(1_000 * 2 ** retryAttempt, 30_000);
              recordFlightEvent(
                'catalog.sync-failed',
                catalogSyncFailedDetails(
                  error,
                  Date.now() - startedAt,
                  attempt,
                  retryDelay,
                ),
                { level: 'warn' },
              );
              retryAttempt += 1;
              retryTimer = setTimeout(() => void sync(true), retryDelay);
            }
          } finally {
            syncRunning = false;
          }
        };

        appStateSubscription = AppState.addEventListener('change', (nextState) => {
          if (nextState === 'active') void sync();
        });
        // Preview is an authoring tool: a reload must not render a known-stale
        // snapshot and hope that a detached background task replaces it later.
        // Wait for the cache-busted manifest check before exposing the catalog.
        if (developmentPreview) await sync(true);
        else void sync(true);
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        recordFlightEvent(
          'catalog.rollout-initialization-failed',
          catalogSyncFailedDetails(error, 0, 0, 0),
          { flush: true, level: 'warn' },
        );
        void bundledSnapshotPromise.then((fallback) => {
          if (!cancelled) setState({ status: 'error', catalog: fallback, error });
        });
      });
    return () => {
      cancelled = true;
      abortController.abort();
      if (retryTimer) clearTimeout(retryTimer);
      appStateSubscription?.remove();
    };
  }, [reportSyncError]);

  const value = useMemo(
    () => (state ? { ...state, refreshCatalog } : null),
    [refreshCatalog, state],
  );
  if (!value) return null;
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

function developmentPreviewDownloadRuntime(
  manifestUrl: string,
  developmentPreviewKey: string,
) {
  return {
    request: async (url: string, init: RequestInit) => {
      const { fetch } = await import('expo/fetch');
      const headers = new Headers(init.headers);
      headers.set('X-Whatzit-Dev-Preview-Key', developmentPreviewKey);
      if (url === manifestUrl) {
        headers.set('Cache-Control', 'no-cache');
        headers.set('Pragma', 'no-cache');
        const previewManifestUrl = new URL(url);
        previewManifestUrl.searchParams.set(
          'previewRequest',
          String(Date.now()),
        );
        return fetch(previewManifestUrl.toString(), {
          ...init,
          headers,
        });
      }
      return fetch(url, { ...init, headers });
    },
  };
}

export function useCatalog() {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside CatalogProvider.');
  return value;
}

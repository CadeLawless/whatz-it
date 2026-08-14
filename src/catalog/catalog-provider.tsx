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
} from './catalog-feature';
import { openCatalogDatabase } from './catalog-database';
import type { CatalogSnapshot } from './catalog-snapshot';
import { synchronizeCatalog } from './catalog-sync';

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
      current && current.status !== 'loading'
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
    const abortController = new AbortController();
    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
    void bundledSnapshotPromise
      .then(async (fallback) => {
        if (!cancelled) setState({ status: 'loading', catalog: fallback });
        if (configuredCatalogSource() === 'bundled') {
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
        const manifestUrl = configuredCatalogManifestUrl();
        if (!cancelled) {
          setState({
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
          setState((current) =>
            current && current.status === 'ready'
              ? { ...current, syncStatus: 'syncing', syncError: undefined }
              : current,
          );
          try {
            const result = await synchronizeCatalog(database, {
              manifestUrl,
              signal: abortController.signal,
            });
            if (cancelled) return;
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
          } catch (cause: unknown) {
            if (!cancelled) {
              reportSyncError(
                cause instanceof Error ? cause : new Error(String(cause)),
              );
            }
          } finally {
            syncRunning = false;
          }
        };

        appStateSubscription = AppState.addEventListener('change', (nextState) => {
          if (nextState === 'active') void sync();
        });
        void sync(true);
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        void bundledSnapshotPromise.then((fallback) => {
          if (!cancelled) setState({ status: 'error', catalog: fallback, error });
        });
      });
    return () => {
      cancelled = true;
      abortController.abort();
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

export function useCatalog() {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside CatalogProvider.');
  return value;
}

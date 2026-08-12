import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  BundledCatalogRepository,
  createConfiguredCatalogRepository,
} from './catalog-repository';
import type { CatalogSnapshot } from './catalog-snapshot';

export type CatalogProviderState =
  | { status: 'loading'; catalog: CatalogSnapshot }
  | { status: 'ready'; catalog: CatalogSnapshot }
  | { status: 'error'; catalog: CatalogSnapshot; error: Error };

const bundledRepository = new BundledCatalogRepository();
const bundledSnapshotPromise = bundledRepository.load();
let bundledSnapshot: CatalogSnapshot | null = null;
void bundledSnapshotPromise.then((snapshot) => {
  bundledSnapshot = snapshot;
});

const CatalogContext = createContext<CatalogProviderState | null>(null);

export function CatalogProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<CatalogProviderState | null>(() =>
    bundledSnapshot ? { status: 'loading', catalog: bundledSnapshot } : null,
  );

  useEffect(() => {
    let cancelled = false;
    void bundledSnapshotPromise
      .then(async (fallback) => {
        if (!cancelled) setState({ status: 'loading', catalog: fallback });
        const repository = await createConfiguredCatalogRepository();
        const catalog = await repository.load();
        if (!cancelled) setState({ status: 'ready', catalog });
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        void bundledSnapshotPromise.then((fallback) => {
          if (!cancelled) setState({ status: 'error', catalog: fallback, error });
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => state, [state]);
  if (!value) return null;
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside CatalogProvider.');
  return value;
}

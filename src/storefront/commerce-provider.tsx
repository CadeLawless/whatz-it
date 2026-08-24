import { createContext, type PropsWithChildren, use } from 'react';

import {
  fallbackCommerceState,
  type CommerceProductState,
  type CommerceTarget,
} from './commerce-state';

export type CommerceAdapter = {
  getProductState: (target: CommerceTarget) => CommerceProductState;
  purchase?: (target: CommerceTarget) => void | Promise<void>;
  restorePurchases?: () => void | Promise<void>;
  restoreState?: CommerceRestoreState;
  refreshCommerceConnection?: () => void | Promise<void>;
  refreshStoreProducts?: () => void | Promise<void>;
  retryPreparation?: (target: CommerceTarget) => void | Promise<void>;
  testing?: CommerceTestingAdapter;
};

export type CommerceTestingState =
  | { status: 'idle' }
  | { status: 'working'; operation: 'new-device' | 'reset-ownership' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

export type CommerceTestingAdapter = {
  simulateNewDevice: () => void | Promise<void>;
  resetSandboxOwnership: () => void | Promise<void>;
  state: CommerceTestingState;
};

export type CommerceRestoreState =
  | { status: 'idle' }
  | { status: 'restoring' }
  | { status: 'success'; restoredProductCount: number }
  | { status: 'error'; message: string };

const fallbackAdapter: CommerceAdapter = {
  getProductState: fallbackCommerceState,
};

const CommerceContext = createContext<CommerceAdapter>(fallbackAdapter);

export function CommerceProvider({
  adapter,
  children,
}: PropsWithChildren<{ adapter: CommerceAdapter }>) {
  return <CommerceContext value={adapter}>{children}</CommerceContext>;
}

export function useCommerceProduct(target: CommerceTarget) {
  const adapter = use(CommerceContext);
  const state = adapter.getProductState(target);

  return {
    purchase:
      adapter.purchase && state.status === 'available'
        ? () => adapter.purchase?.(target)
        : undefined,
    retry:
      state.status === 'offline' && adapter.refreshCommerceConnection
        ? () => adapter.refreshCommerceConnection?.()
        : state.status === 'retry' && adapter.retryPreparation
        ? () => adapter.retryPreparation?.(target)
        : state.status === 'unavailable'
          && state.reason === 'store_unavailable'
          && adapter.refreshStoreProducts
          ? () => adapter.refreshStoreProducts?.()
          : undefined,
    state,
  };
}

export function useRestorePurchases() {
  const adapter = use(CommerceContext);
  return {
    restorePurchases: adapter.restorePurchases,
    state: adapter.restoreState ?? { status: 'idle' as const },
  };
}

export function useCommerceTesting() {
  return use(CommerceContext).testing;
}

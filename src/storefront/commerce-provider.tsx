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
  retryPreparation?: (target: CommerceTarget) => void | Promise<void>;
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
      adapter.retryPreparation && state.status === 'retry'
        ? () => adapter.retryPreparation?.(target)
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

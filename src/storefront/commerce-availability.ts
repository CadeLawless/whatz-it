import type { CommerceProductState, CommerceTarget } from './commerce-state';

export type CommerceConnectionState = 'loading' | 'ready' | 'error';
export type StoreProductRequestState = 'waiting' | 'loading' | 'complete' | 'error';

export function productsForCurrentCatalog<T>(snapshot: {
  fingerprint: string;
  status: StoreProductRequestState;
  products: T[];
}, fingerprint: string): T[] {
  return snapshot.fingerprint === fingerprint && snapshot.status === 'complete'
    ? snapshot.products : [];
}

/** Access refresh failures propagate; content failures stay scoped to owned downloads. */
export async function refreshCommerceSession<T>({ connect, ready, prepare, preparationFailed }: {
  connect: () => Promise<T>;
  ready: () => void;
  prepare: (session: T) => Promise<void>;
  preparationFailed: (error: unknown) => void;
}) {
  const session = await connect();
  ready();
  try {
    await prepare(session);
  } catch (error) {
    preparationFailed(error);
  }
  return session;
}

/** Only a current store response can make an unowned product purchasable. */
export function unownedCommerceState({
  configured,
  networkOffline,
  serviceState,
  storeState,
  localizedPrice,
}: {
  configured: boolean;
  networkOffline: boolean;
  serviceState: CommerceConnectionState;
  storeState: StoreProductRequestState;
  localizedPrice?: string;
}): CommerceProductState {
  if (!configured) return { status: 'unavailable', reason: 'not_configured' };
  if (networkOffline) return { status: 'offline' };
  if (serviceState === 'error') return { status: 'unavailable', reason: 'service_unavailable' };
  if (storeState === 'error') return { status: 'unavailable', reason: 'store_unavailable' };
  if (serviceState !== 'ready' || storeState !== 'complete') return { status: 'loading' };
  return localizedPrice
    ? { status: 'available', localizedPrice }
    : { status: 'unavailable', reason: 'product_unavailable' };
}

/** Keep owned content and purchase recovery accessible without advertising unavailable products. */
export function commerceListingVisible(state: CommerceProductState) {
  return state.status !== 'loading' && state.status !== 'unavailable' && state.status !== 'offline';
}

export function commerceTarget(
  record: Omit<CommerceTarget, 'kind'>,
  kind: CommerceTarget['kind'],
): CommerceTarget {
  return {
    access: record.access,
    id: record.id,
    title: record.title,
    installationStatus: record.installationStatus,
    kind,
  };
}

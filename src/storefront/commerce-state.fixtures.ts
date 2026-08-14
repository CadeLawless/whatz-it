import type { CommerceProductState } from './commerce-state';

export const commerceStateFixtures = {
  loading: { status: 'loading' },
  unavailable: { status: 'unavailable', reason: 'store_unavailable' },
  offline: { status: 'offline', lastKnownPrice: '$2.99' },
  available: { status: 'available', localizedPrice: '$2.99' },
  purchasing: { status: 'purchasing', localizedPrice: '$2.99' },
  pending: { status: 'pending' },
  verifying: { status: 'verifying' },
  preparing: { status: 'preparing', progress: 0.42 },
  retry: { status: 'retry' },
  owned: { status: 'owned', source: 'purchase' },
} satisfies Record<string, CommerceProductState>;

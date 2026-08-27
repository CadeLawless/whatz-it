import type { CommerceRestoreState } from './commerce-provider';

type SuccessfulRestoreState = Extract<CommerceRestoreState, { status: 'success' }>;

export function successfulRestoreNotice(state: SuccessfulRestoreState) {
  if (state.restoredProductCount === 0) {
    return {
      title: 'No purchases found',
      message: 'No previous purchases were found for this Apple Account.',
    };
  }
  if (state.newlyRestoredProductCount === 0) {
    return {
      title: 'Purchases already restored',
      message: 'Your purchases are already available on this device.',
    };
  }
  return {
    title: 'Purchases restored',
    message: 'Your purchases are restored and available decks are ready offline.',
  };
}

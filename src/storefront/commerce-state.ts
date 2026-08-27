import type { DeckAccess } from '@/types/deck';

export type CommerceTarget = {
  access: DeckAccess;
  id: string;
  installationStatus?: 'installed' | 'not_owned' | 'pending' | 'failed';
  kind: 'deck' | 'bundle';
  title: string;
};

export type CommerceProductState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: 'not_configured' | 'store_unavailable' }
  | { status: 'offline'; lastKnownPrice?: string }
  | { status: 'available'; localizedPrice: string }
  | { status: 'purchasing'; localizedPrice: string; waitingForStore?: boolean }
  | { status: 'pending' }
  | { status: 'verifying' }
  | { status: 'preparing'; progress?: number }
  | { status: 'retry'; message?: string }
  | { status: 'owned'; source: 'purchase' | 'bundle' | 'included' };

export type CommerceAction = 'none' | 'purchase' | 'retry';

export type CommercePresentation = {
  action: CommerceAction;
  busy: boolean;
  buttonLabel: string;
  copy: string;
  title: string;
  tone: 'muted' | 'primary' | 'success' | 'warning';
};

type InstallationStatus = NonNullable<CommerceTarget['installationStatus']>;

export function entitledCommerceState(
  source: Extract<CommerceProductState, { status: 'owned' }>['source'],
  installationStatuses: readonly (InstallationStatus | undefined)[],
): CommerceProductState {
  if (installationStatuses.some((status) => status === 'failed')) {
    return { status: 'retry' };
  }
  if (installationStatuses.some((status) => status !== 'installed')) {
    return { status: 'preparing' };
  }
  return { status: 'owned', source };
}

export function fallbackCommerceState(
  target: CommerceTarget,
): CommerceProductState {
  if (target.access === 'free') {
    return { status: 'owned', source: 'included' };
  }

  switch (target.installationStatus) {
    case 'installed':
      return { status: 'owned', source: 'purchase' };
    case 'pending':
      return { status: 'preparing' };
    case 'failed':
      return { status: 'retry' };
    default:
      return { status: 'unavailable', reason: 'not_configured' };
  }
}

export function commercePresentation(
  state: CommerceProductState,
  target: CommerceTarget,
): CommercePresentation {
  const item = target.kind === 'deck' ? 'deck' : 'bundle';

  switch (state.status) {
    case 'loading':
      return {
        action: 'none',
        busy: true,
        buttonLabel: 'CHECKING…',
        copy: 'Checking the App Store for current availability and pricing.',
        title: 'Checking availability',
        tone: 'muted',
      };
    case 'unavailable':
      return state.reason === 'not_configured'
        ? {
            action: 'none',
            busy: false,
            buttonLabel: 'COMING SOON',
            copy: `Secure in-app purchasing for this ${item} will be connected in the next phase.`,
            title: 'Purchasing is coming soon',
            tone: 'muted',
          }
        : {
            action: 'retry',
            busy: false,
            buttonLabel: 'TRY AGAIN',
            copy: `The App Store didn’t return a price for this ${item}. Check your connection and try again.`,
            title: 'Couldn’t reach the App Store',
            tone: 'warning',
          };
    case 'offline':
      return {
        action: 'retry',
        busy: false,
        buttonLabel: 'TRY AGAIN',
        copy: state.lastKnownPrice
          ? `Reconnect to confirm the current price and purchase this ${item}, then tap Try Again if it doesn’t update automatically. Last seen: ${state.lastKnownPrice}.`
          : `Reconnect to check the current price and purchase this ${item}, then tap Try Again if it doesn’t update automatically.`,
        title: 'Connect to purchase',
        tone: 'warning',
      };
    case 'available':
      return {
        action: 'purchase',
        busy: false,
        buttonLabel: `BUY • ${state.localizedPrice}`,
        copy: 'The App Store will confirm the purchase and final localized price.',
        title: `Purchase ${target.title}`,
        tone: 'primary',
      };
    case 'purchasing':
      return {
        action: 'none',
        busy: true,
        buttonLabel: state.waitingForStore ? 'WAITING FOR APP STORE…' : 'PURCHASING…',
        copy: state.waitingForStore
          ? 'The App Store is taking longer than usual. Keep this screen open; the purchase prompt may still appear.'
          : 'Finish or cancel the purchase in the App Store prompt.',
        title: state.waitingForStore ? 'Waiting for the App Store' : 'Purchase in progress',
        tone: 'primary',
      };
    case 'pending':
      return {
        action: 'none',
        busy: true,
        buttonLabel: 'PENDING APPROVAL',
        copy: 'The App Store is waiting for approval. This screen will update when the purchase completes.',
        title: 'Purchase pending',
        tone: 'warning',
      };
    case 'verifying':
      return {
        action: 'none',
        busy: true,
        buttonLabel: 'VERIFYING…',
        copy: 'Confirming the completed store transaction securely.',
        title: 'Verifying purchase',
        tone: 'primary',
      };
    case 'preparing': {
      const percent =
        state.progress === undefined
          ? null
          : Math.round(Math.max(0, Math.min(1, state.progress)) * 100);
      return {
        action: 'none',
        busy: true,
        buttonLabel: percent === null ? 'PREPARING…' : `PREPARING • ${percent}%`,
        copy: `Purchase confirmed. Preparing this ${item} for offline play.`,
        title: 'Preparing your content',
        tone: 'primary',
      };
    }
    case 'retry':
      return {
        action: 'retry',
        busy: false,
        buttonLabel: 'RETRY PREPARING',
        copy:
          state.message ??
          `Your purchase is safe, but this ${item} could not finish preparing for offline play.`,
        title: 'Preparation interrupted',
        tone: 'warning',
      };
    case 'owned':
      return {
        action: 'none',
        busy: false,
        buttonLabel:
          state.source === 'included'
            ? 'IN MY DECKS'
            : state.source === 'bundle'
              ? 'OWNED IN A BUNDLE'
              : 'OWNED',
        copy:
          state.source === 'included'
            ? `This ${item} is included with WHATZ IT? and available offline.`
            : `This ${item} is installed and ready for offline play.`,
        title: state.source === 'included' ? 'Included with WHATZ IT?' : 'Ready to play',
        tone: 'success',
      };
  }
}

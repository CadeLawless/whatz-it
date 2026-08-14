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
  | { status: 'purchasing'; localizedPrice: string }
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
            action: 'none',
            busy: false,
            buttonLabel: 'UNAVAILABLE',
            copy: `This ${item} is not currently available for purchase. Please check again later.`,
            title: 'Purchase unavailable',
            tone: 'muted',
          };
    case 'offline':
      return {
        action: 'none',
        busy: false,
        buttonLabel: 'CONNECTION REQUIRED',
        copy: state.lastKnownPrice
          ? `Reconnect to confirm the current price and purchase this ${item}. Last seen: ${state.lastKnownPrice}.`
          : `Reconnect to check the current price and purchase this ${item}.`,
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
        buttonLabel: 'PURCHASING…',
        copy: 'Finish or cancel the purchase in the App Store prompt.',
        title: 'Purchase in progress',
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

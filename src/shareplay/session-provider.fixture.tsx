import type {
  SharePlaySnapshot,
  WhatzItSharePlayModuleEvents,
} from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { renderProviderHarness } from '../test/provider-harness';

export const idleSnapshot: SharePlaySnapshot = {
  revision: 0, status: 'idle', sessionId: null, localParticipantId: null,
  participantIds: [], isHost: false, hostParticipantId: null, activity: null,
};

type FixtureEventName = keyof WhatzItSharePlayModuleEvents;
type FixtureListeners = {
  [Name in FixtureEventName]: Set<WhatzItSharePlayModuleEvents[Name]>;
};
type FixtureListenerEntry = {
  [Name in FixtureEventName]: [Name, WhatzItSharePlayModuleEvents[Name]];
}[FixtureEventName];
type CatalogDeck = { id: string; title: string; access: 'free' | 'paid'; cards: never[] };
const defaultCatalogDecks: CatalogDeck[] = [
  { id: 'animals', title: 'Animals', access: 'free', cards: [] },
];

const mockRuntime = {
  snapshot: idleSnapshot,
  inviteResult: 'success' as 'success' | 'cancelled',
  leaveFails: false,
  deferredLeave: null as null | { promise: Promise<void>; resolve: () => void },
  listeners: {
    onSession: new Set<WhatzItSharePlayModuleEvents['onSession']>(),
    onMessage: new Set<WhatzItSharePlayModuleEvents['onMessage']>(),
    onError: new Set<WhatzItSharePlayModuleEvents['onError']>(),
    onDiagnostic: new Set<WhatzItSharePlayModuleEvents['onDiagnostic']>(),
  } satisfies FixtureListeners,
  storage: new Map<string, string>(),
  nativeCalls: [] as string[],
  removedKeys: [] as string[],
  liveGameSessions: [] as SharePlaySnapshot[],
  subscriptionRemovals: 0,
  catalogDecks: defaultCatalogDecks,
  ownedDeckIds: new Set<string>(),
};

jest.mock('expo-constants', () => ({ __esModule: true, default: {
  expoConfig: { extra: { sharePlayPrototypeEnabled: true, sharePlayEnvironment: 'main:test' } },
} }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: jest.fn(async () => 'digest'),
  randomUUID: jest.fn(() => 'nonce'),
}));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const mocked = Object.defineProperties({}, Object.getOwnPropertyDescriptors(actual));
  Object.defineProperty(mocked, 'Platform', { value: { ...actual.Platform, OS: 'ios' } });
  Object.defineProperty(mocked, 'AppState', { value: {
    currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  } });
  return mocked;
});
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockRuntime.storage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockRuntime.storage.set(key, value); }),
  removeItem: jest.fn(async (key: string) => {
    mockRuntime.removedKeys.push(key); mockRuntime.storage.delete(key);
  }),
} }));
function mockAddListener(...entry: FixtureListenerEntry) {
  const [name, listener] = entry;
  switch (name) {
    case 'onSession': mockRuntime.listeners.onSession.add(listener); break;
    case 'onMessage': mockRuntime.listeners.onMessage.add(listener); break;
    case 'onError': mockRuntime.listeners.onError.add(listener); break;
    case 'onDiagnostic': mockRuntime.listeners.onDiagnostic.add(listener); break;
  }
  return {
    remove: jest.fn(() => {
      switch (name) {
        case 'onSession': mockRuntime.listeners.onSession.delete(listener); break;
        case 'onMessage': mockRuntime.listeners.onMessage.delete(listener); break;
        case 'onError': mockRuntime.listeners.onError.delete(listener); break;
        case 'onDiagnostic': mockRuntime.listeners.onDiagnostic.delete(listener); break;
      }
      mockRuntime.subscriptionRemovals++;
    }),
  };
}

jest.mock('../../modules/whatz-it-shareplay/src/WhatzItSharePlayModule', () => ({ __esModule: true, default: {
  addListener: jest.fn(mockAddListener),
  startAsync: jest.fn(async () => mockRuntime.snapshot),
  stopAsync: jest.fn(async () => undefined),
  getSnapshotAsync: jest.fn(async () => mockRuntime.snapshot),
  inviteAsync: jest.fn(async () => { mockRuntime.nativeCalls.push('invite'); return mockRuntime.inviteResult; }),
  joinAsync: jest.fn(async () => { mockRuntime.nativeCalls.push('join'); }),
  sendAsync: jest.fn(async () => undefined),
  leaveAsync: jest.fn(async () => {
    mockRuntime.nativeCalls.push('leave');
    const leavingSessionId = mockRuntime.snapshot.sessionId;
    await mockRuntime.deferredLeave?.promise;
    if (mockRuntime.leaveFails) throw new Error('native leave failed');
    if (mockRuntime.snapshot.sessionId === leavingSessionId) {
      mockRuntime.snapshot = { ...idleSnapshot, revision: mockRuntime.snapshot.revision + 1 };
    }
  }),
  endAsync: jest.fn(async () => { mockRuntime.nativeCalls.push('end'); }),
} }));
jest.mock('@/catalog/catalog-provider', () => ({ useCatalog: () => ({ catalog: {
  decks: mockRuntime.catalogDecks,
  getDeckById: (id: string) => mockRuntime.catalogDecks.find((deck) => deck.id === id) ?? null,
} }) }));
jest.mock('@/storefront/commerce-provider', () => ({ useOwnedDeckIds: () => mockRuntime.ownedDeckIds }));
jest.mock('@/storage/daily-card-memory', () => ({
  loadRoundCardIds: jest.fn(async () => []), rememberSharedCard: jest.fn(async () => undefined),
}));
jest.mock('@/storage/round-history', () => ({ saveRoundResult: jest.fn(async () => undefined) }));
jest.mock('./audio-policy', () => ({ setSharePlayAudioBlocked: jest.fn() }));
jest.mock('./diagnostics', () => ({
  logSharePlay: jest.fn(), shortSharePlayId: (id: string | null) => id ?? 'none',
  SHAREPLAY_RUNTIME_REVISION: 'test',
}));
jest.mock('./live-game', () => ({ LiveGame: class {
  synchronized = false; remainingMs = 0; countdown = 0; currentView = null;
  setSession(next: SharePlaySnapshot) { mockRuntime.liveGameSessions.push(next); }
  refreshAvailableDecks() {} pulse() {} receive() {} react() {} act() {}
  selectMode() {} selectGuesser() {} selectDeck() {} selectDuration() {} returnToLobby() {}
  nextRound() {} endGame() {} exitResults() {} setForeground() {}
  endSession = async () => undefined;
} }));

// The provider must load after the module mocks above are declared.
// eslint-disable-next-line import/first
import { SharePlayProvider, useSharePlay } from './session-provider';

type Options = {
  snapshot?: SharePlaySnapshot;
  savedRejoinNonce?: string;
  leaveFails?: boolean;
  deferLeave?: boolean;
  catalogDecks?: CatalogDeck[];
  ownedDeckIds?: string[];
};

export function mountSharePlayProvider(options: Options = {}) {
  mockRuntime.snapshot = options.snapshot ?? idleSnapshot;
  mockRuntime.inviteResult = 'success'; mockRuntime.leaveFails = options.leaveFails ?? false;
  mockRuntime.deferredLeave = options.deferLeave ? (() => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  })() : null;
  mockRuntime.listeners.onSession.clear();
  mockRuntime.listeners.onMessage.clear();
  mockRuntime.listeners.onError.clear();
  mockRuntime.listeners.onDiagnostic.clear();
  mockRuntime.storage = new Map([['shareplay.player-name.v1', 'Cade']]);
  if (options.savedRejoinNonce) mockRuntime.storage.set('whatz-it.shareplay.rejoin-session', options.savedRejoinNonce);
  mockRuntime.nativeCalls = []; mockRuntime.removedKeys = []; mockRuntime.liveGameSessions = [];
  mockRuntime.subscriptionRemovals = 0;
  mockRuntime.catalogDecks = options.catalogDecks ?? defaultCatalogDecks;
  mockRuntime.ownedDeckIds = new Set(options.ownedDeckIds);

  const harness = renderProviderHarness({ Provider: SharePlayProvider, useValue: useSharePlay, props: {} });
  return {
    ...harness,
    emitSession(next: SharePlaySnapshot) {
      mockRuntime.snapshot = next;
      mockRuntime.listeners.onSession.forEach((listener) => listener(next));
    },
    emitError(code: string) {
      mockRuntime.listeners.onError.forEach((listener) => listener({ code }));
    },
    setNativeSnapshot(next: SharePlaySnapshot) { mockRuntime.snapshot = next; },
    setInviteResult(result: 'success' | 'cancelled') { mockRuntime.inviteResult = result; },
    resolveLeave() { mockRuntime.deferredLeave?.resolve(); },
    nativeCalls: mockRuntime.nativeCalls, removedKeys: mockRuntime.removedKeys,
    liveGameSessions: mockRuntime.liveGameSessions,
    advanceTime(milliseconds: number) { jest.advanceTimersByTime(milliseconds); },
    pendingTimerCount: () => jest.getTimerCount(),
    activeSubscriptions: () => (
      mockRuntime.listeners.onSession.size + mockRuntime.listeners.onMessage.size +
      mockRuntime.listeners.onError.size + mockRuntime.listeners.onDiagnostic.size
    ),
    subscriptionRemovals: () => mockRuntime.subscriptionRemovals,
  };
}

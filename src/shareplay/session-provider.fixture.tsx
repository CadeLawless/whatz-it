import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { renderProviderHarness } from '../test/provider-harness';

export const idleSnapshot: SharePlaySnapshot = {
  revision: 0, status: 'idle', sessionId: null, localParticipantId: null,
  participantIds: [], isHost: false, hostParticipantId: null, activity: null,
};

type Listener = (value: never) => void;
const mockRuntime = {
  snapshot: idleSnapshot,
  inviteResult: 'success' as 'success' | 'cancelled',
  leaveFails: false,
  listeners: new Map<string, Set<Listener>>(),
  storage: new Map<string, string>(),
  nativeCalls: [] as string[],
  removedKeys: [] as string[],
  liveGameSessions: [] as SharePlaySnapshot[],
  subscriptionRemovals: 0,
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
jest.mock('../../modules/whatz-it-shareplay/src/WhatzItSharePlayModule', () => ({ __esModule: true, default: {
  addListener: jest.fn((name: string, listener: Listener) => {
    const listeners = mockRuntime.listeners.get(name) ?? new Set<Listener>();
    listeners.add(listener); mockRuntime.listeners.set(name, listeners);
    return { remove: jest.fn(() => { listeners.delete(listener); mockRuntime.subscriptionRemovals++; }) };
  }),
  startAsync: jest.fn(async () => mockRuntime.snapshot),
  stopAsync: jest.fn(async () => undefined),
  getSnapshotAsync: jest.fn(async () => mockRuntime.snapshot),
  inviteAsync: jest.fn(async () => { mockRuntime.nativeCalls.push('invite'); return mockRuntime.inviteResult; }),
  joinAsync: jest.fn(async () => { mockRuntime.nativeCalls.push('join'); }),
  sendAsync: jest.fn(async () => undefined),
  leaveAsync: jest.fn(async () => {
    mockRuntime.nativeCalls.push('leave');
    if (mockRuntime.leaveFails) throw new Error('native leave failed');
    mockRuntime.snapshot = { ...idleSnapshot, revision: mockRuntime.snapshot.revision + 1 };
  }),
  endAsync: jest.fn(async () => { mockRuntime.nativeCalls.push('end'); }),
} }));
jest.mock('@/catalog/catalog-provider', () => ({ useCatalog: () => ({ catalog: {
  decks: [], getDeckById: (id: string) => id === 'animals'
    ? { id, title: 'Animals', access: 'free', cards: [] } : null,
} }) }));
jest.mock('@/storefront/commerce-provider', () => ({ useOwnedDeckIds: () => new Set<string>() }));
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

import { SharePlayProvider, useSharePlay } from './session-provider';

type Options = { snapshot?: SharePlaySnapshot; savedRejoinNonce?: string; leaveFails?: boolean };

export function mountSharePlayProvider(options: Options = {}) {
  mockRuntime.snapshot = options.snapshot ?? idleSnapshot;
  mockRuntime.inviteResult = 'success'; mockRuntime.leaveFails = options.leaveFails ?? false;
  mockRuntime.listeners.clear();
  mockRuntime.storage = new Map([['shareplay.player-name.v1', 'Cade']]);
  if (options.savedRejoinNonce) mockRuntime.storage.set('whatz-it.shareplay.rejoin-session', options.savedRejoinNonce);
  mockRuntime.nativeCalls = []; mockRuntime.removedKeys = []; mockRuntime.liveGameSessions = [];
  mockRuntime.subscriptionRemovals = 0;

  const harness = renderProviderHarness({ Provider: SharePlayProvider, useValue: useSharePlay, props: {} });
  return {
    ...harness,
    emitSession(next: SharePlaySnapshot) {
      mockRuntime.snapshot = next;
      mockRuntime.listeners.get('onSession')?.forEach((listener) => listener(next as never));
    },
    emitError(code: string) {
      mockRuntime.listeners.get('onError')?.forEach((listener) => listener({ code } as never));
    },
    setNativeSnapshot(next: SharePlaySnapshot) { mockRuntime.snapshot = next; },
    setInviteResult(result: 'success' | 'cancelled') { mockRuntime.inviteResult = result; },
    nativeCalls: mockRuntime.nativeCalls, removedKeys: mockRuntime.removedKeys,
    liveGameSessions: mockRuntime.liveGameSessions,
    activeSubscriptions: () => [...mockRuntime.listeners.values()].reduce((total, listeners) => total + listeners.size, 0),
    subscriptionRemovals: () => mockRuntime.subscriptionRemovals,
  };
}

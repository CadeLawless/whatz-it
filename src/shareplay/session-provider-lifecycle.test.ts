import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { ReactElement } from 'react';

import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/shareplay/session-provider.tsx'), {
  configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
});

const idleSnapshot: SharePlaySnapshot = {
  revision: 0, status: 'idle', sessionId: null, localParticipantId: null,
  participantIds: [], isHost: false, hostParticipantId: null, activity: null,
};

type ProviderValue = {
  initialized: boolean;
  invitationPending: boolean;
  rejoinOffered: boolean;
  isOpen: boolean;
  setup: unknown;
  session: SharePlaySnapshot;
  open(setup: { deckId: string; deckTitle: string; durationSeconds: number; access: 'free' }): void;
  invite(): Promise<void>;
  declineRejoin(): Promise<void>;
  leave(endForEveryone?: boolean): Promise<void>;
};

function mountProvider(options: { snapshot?: SharePlaySnapshot; savedRejoinNonce?: string; leaveFails?: boolean } = {}) {
  let snapshot = options.snapshot ?? idleSnapshot;
  let inviteResult: 'success' | 'cancelled' = 'success';
  const listeners = new Map<string, Set<(value: never) => void>>();
  const storage = new Map<string, string>([['shareplay.player-name.v1', 'Cade']]);
  if (options.savedRejoinNonce) storage.set('whatz-it.shareplay.rejoin-session', options.savedRejoinNonce);
  const removedKeys: string[] = [];
  const nativeCalls: string[] = [];
  const liveGameSessions: SharePlaySnapshot[] = [];
  const timers: { callback: () => void; delay: number }[] = [];
  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const effects: (() => unknown)[] = [];
  let stateCursor = 0;
  let refCursor = 0;
  let mounting = true;
  let value: ProviderValue;
  const noop = () => {};
  const native = {
    addListener(name: string, listener: (value: never) => void) {
      const group = listeners.get(name) ?? new Set();
      group.add(listener); listeners.set(name, group);
      return { remove: () => group.delete(listener) };
    },
    startAsync: async () => snapshot,
    stopAsync: async () => {},
    getSnapshotAsync: async () => snapshot,
    inviteAsync: async () => { nativeCalls.push('invite'); return inviteResult; },
    joinAsync: async () => { nativeCalls.push('join'); },
    sendAsync: async () => {},
    leaveAsync: async () => {
      nativeCalls.push('leave');
      if (options.leaveFails) throw new Error('native leave failed');
      snapshot = { ...snapshot, revision: snapshot.revision + 1, status: 'idle', sessionId: null,
        localParticipantId: null, participantIds: [], isHost: false, hostParticipantId: null, activity: null };
    },
    endAsync: async () => { nativeCalls.push('end'); },
  };
  const react = {
    ...require('react'),
    useCallback: (callback: unknown) => callback,
    useContext: () => null,
    useRef(initial: unknown) {
      const index = refCursor++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useState(initial: unknown) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [state[index], (next: unknown) => {
        state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(state[index]) : next;
      }];
    },
    useEffect(effect: () => unknown) { if (mounting) effects.push(effect); },
  };
  const exports = {} as typeof import('./session-provider');
  runInNewContext(code, {
    exports, __DEV__: true, performance, process,
    setInterval: () => 1, clearInterval: noop, clearTimeout: noop,
    setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay }); return timers.length; },
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'expo-constants') return { __esModule: true, default: {
        expoConfig: { extra: { sharePlayPrototypeEnabled: true, sharePlayEnvironment: 'main:test' } },
      } };
      if (name === 'expo-crypto') return {
        CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async () => 'digest', randomUUID: () => 'nonce',
      };
      if (name === 'react-native') return {
        Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) },
      };
      if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
        getItem: async (key: string) => storage.get(key) ?? null,
        setItem: async (key: string, next: string) => { storage.set(key, next); },
        removeItem: async (key: string) => { removedKeys.push(key); storage.delete(key); },
      } };
      if (name.endsWith('/WhatzItSharePlayModule')) return { __esModule: true, default: native };
      if (name.endsWith('/catalog-provider')) return { useCatalog: () => ({ catalog: {
        decks: [], getDeckById: (id: string) => id === 'animals' ? { id, title: 'Animals', access: 'free', cards: [] } : null,
      } }) };
      if (name.endsWith('/commerce-provider')) return { useOwnedDeckIds: () => new Set<string>() };
      if (name.endsWith('/live-game')) return { LiveGame: class {
        synchronized = false; remainingMs = 0; countdown = 0; currentView = null;
        setSession(next: SharePlaySnapshot) { liveGameSessions.push(next); }
        refreshAvailableDecks() {} pulse() {} receive() {} react() {} act() {}
        selectMode() {} selectGuesser() {} selectDeck() {} selectDuration() {} returnToLobby() {}
        nextRound() {} endGame() {} exitResults() {} setForeground() {} endSession = async () => {};
      } };
      if (name.endsWith('/audio-policy')) return { setSharePlayAudioBlocked: noop };
      if (name.endsWith('/diagnostics')) return {
        logSharePlay: noop, shortSharePlayId: (id: string | null) => id ?? 'none',
        SHAREPLAY_RUNTIME_REVISION: 'test',
      };
      if (name.endsWith('/daily-card-memory')) return { loadRoundCardIds: async () => [], rememberSharedCard: async () => {} };
      if (name.endsWith('/round-history')) return { saveRoundResult: async () => {} };
      return require(name);
    },
  });
  function render() {
    stateCursor = 0; refCursor = 0;
    const element = exports.SharePlayProvider({ children: null }) as ReactElement<{ value: ProviderValue }>;
    value = element.props.value;
  }
  async function flush() {
    await new Promise<void>((done) => setImmediate(done));
    await new Promise<void>((done) => setImmediate(done));
    render();
  }
  render();
  mounting = false;
  effects.forEach((effect) => effect());
  return {
    flush,
    value: () => value,
    emitSession(next: SharePlaySnapshot) {
      snapshot = next;
      listeners.get('onSession')?.forEach((listener) => listener(next as never));
    },
    setNativeSnapshot(next: SharePlaySnapshot) { snapshot = next; },
    emitError(code: string) {
      listeners.get('onError')?.forEach((listener) => listener({ code } as never));
    },
    timers, nativeCalls, removedKeys, liveGameSessions,
    setInviteResult(result: 'success' | 'cancelled') { inviteResult = result; },
  };
}

it('makes successful invitation feedback transient and leaves cancellation immediately retryable', async () => {
  const provider = mountProvider();
  await provider.flush();
  assert.equal(provider.value().initialized, true);
  provider.value().open({ deckId: 'animals', deckTitle: 'Animals', durationSeconds: 60, access: 'free' });
  await provider.flush();

  provider.setInviteResult('cancelled');
  await provider.value().invite();
  await provider.flush();
  assert.equal(provider.value().invitationPending, false);

  provider.setInviteResult('success');
  await provider.value().invite();
  await provider.flush();
  assert.equal(provider.value().invitationPending, true);
  const feedbackTimer = provider.timers.find((timer) => timer.delay === 2_000);
  assert.ok(feedbackTimer, 'successful invitation schedules two-second feedback cleanup');
  feedbackTimer.callback();
  await provider.flush();
  assert.equal(provider.value().invitationPending, false);
});

it('clears setup and invitation state on activation and terminal snapshots without accepting delayed callbacks', async () => {
  const provider = mountProvider();
  await provider.flush();
  provider.value().open({ deckId: 'animals', deckTitle: 'Animals', durationSeconds: 60, access: 'free' });
  await provider.flush();
  await provider.value().invite();
  await provider.flush();
  const delayedFeedback = provider.timers.find((timer) => timer.delay === 2_000)!;

  const waiting: SharePlaySnapshot = {
    revision: 1, status: 'waiting', sessionId: 'session-1', localParticipantId: 'cade',
    participantIds: ['cade'], isHost: true, hostParticipantId: 'cade',
    activity: { protocolVersion: 4, environment: 'main:test', nonce: 'nonce', deckId: 'animals',
      deckTitle: 'Animals', durationSeconds: 60, hostPublicKey: 'key' },
  };
  provider.emitSession(waiting);
  await provider.flush();
  assert.equal(provider.value().invitationPending, false);

  const ended = { ...waiting, revision: 2, status: 'ended' as const, sessionId: null,
    localParticipantId: null, participantIds: [], isHost: false, hostParticipantId: null, activity: null };
  provider.emitSession(ended);
  const nextSession = { ...waiting, revision: 3, sessionId: 'session-2' };
  provider.emitSession(nextSession);
  provider.emitSession({ ...waiting, revision: 4 }); // old session arrives after the new one
  provider.emitSession({ ...ended, revision: 5 });
  delayedFeedback.callback();
  await provider.flush();
  assert.equal(provider.value().session.status, 'ended');
  assert.equal(provider.value().session.sessionId, null);
  assert.equal(provider.value().invitationPending, false);
  assert.equal(provider.value().setup, null);
  assert.equal(provider.value().isOpen, false);
  assert.ok(provider.removedKeys.includes('whatz-it.shareplay.rejoin-session'));

  provider.setNativeSnapshot({ ...idleSnapshot, revision: 6 });
  provider.value().open({ deckId: 'animals', deckTitle: 'Animals', durationSeconds: 60, access: 'free' });
  await provider.flush();
  await provider.value().invite();
  await provider.flush();
  assert.equal(provider.nativeCalls.filter((call) => call === 'invite').length, 2);
  assert.equal(provider.value().invitationPending, true);
});

it('declining a cold-launch rejoin leaves native SharePlay and removes persisted rejoin state', async () => {
  const joined: SharePlaySnapshot = {
    revision: 4, status: 'joined', sessionId: 'session-1', localParticipantId: 'cade',
    participantIds: ['cade', 'friend'], isHost: false, hostParticipantId: 'friend',
    activity: { protocolVersion: 4, environment: 'main:test', nonce: 'saved-nonce', deckId: 'animals',
      deckTitle: 'Animals', durationSeconds: 60, hostPublicKey: 'key' },
  };
  const provider = mountProvider({ snapshot: joined, savedRejoinNonce: 'saved-nonce' });
  await provider.flush();
  assert.equal(provider.value().rejoinOffered, true);

  await provider.value().declineRejoin();
  await provider.flush();
  assert.ok(provider.nativeCalls.includes('leave'));
  assert.ok(provider.removedKeys.includes('whatz-it.shareplay.rejoin-session'));
  assert.equal(provider.value().rejoinOffered, false);
  assert.equal(provider.value().session.sessionId, null);
  assert.equal(provider.value().isOpen, false);
});

it('hides a terminal snapshot even when it is the first callback and still carries a session ID', async () => {
  const provider = mountProvider();
  await provider.flush();
  provider.emitSession({
    revision: 1, status: 'ended', sessionId: 'ended-session', localParticipantId: 'cade',
    participantIds: ['cade'], isHost: true, hostParticipantId: 'cade', activity: null,
  });
  await provider.flush();
  assert.equal(provider.value().session.status, 'idle');
  assert.equal(provider.value().session.sessionId, null);
  assert.equal(provider.value().setup, null);
  assert.equal(provider.value().isOpen, false);
});

it('cleans provider state for explicit leave and native invalidation even with the sheet closed', async () => {
  const joined: SharePlaySnapshot = {
    revision: 1, status: 'joined', sessionId: 'session-1', localParticipantId: 'cade',
    participantIds: ['cade', 'friend'], isHost: false, hostParticipantId: 'friend',
    activity: { protocolVersion: 4, environment: 'main:test', nonce: 'nonce', deckId: 'animals',
      deckTitle: 'Animals', durationSeconds: 60, hostPublicKey: 'key' },
  };
  const left = mountProvider({ snapshot: joined, leaveFails: true });
  await left.flush();
  await left.value().leave();
  await left.flush();
  assert.equal(left.value().session.sessionId, null);
  assert.equal(left.value().setup, null);
  assert.equal(left.value().isOpen, false);
  assert.equal(left.liveGameSessions.at(-1)?.status, 'idle');
  assert.equal(left.liveGameSessions.at(-1)?.sessionId, null);

  const invalidated = mountProvider({ snapshot: joined });
  await invalidated.flush();
  const ended = { ...joined, revision: 2, status: 'ended' as const, sessionId: null,
    localParticipantId: null, participantIds: [], isHost: false, hostParticipantId: null, activity: null };
  invalidated.setNativeSnapshot(ended);
  invalidated.emitError('sessionInvalidated');
  await invalidated.flush();
  assert.equal(invalidated.value().session.status, 'ended');
  assert.equal(invalidated.value().session.sessionId, null);
  assert.equal(invalidated.value().setup, null);
  assert.equal(invalidated.value().isOpen, false);
  assert.ok(invalidated.removedKeys.includes('whatz-it.shareplay.rejoin-session'));
});

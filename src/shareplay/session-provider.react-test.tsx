import { act } from '@testing-library/react-native';

import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { idleSnapshot, mountSharePlayProvider } from './session-provider.fixture';

const setup = { deckId: 'animals', deckTitle: 'Animals', durationSeconds: 60, access: 'free' as const };
const waiting: SharePlaySnapshot = {
  revision: 1, status: 'waiting', sessionId: 'session-1', localParticipantId: 'cade',
  participantIds: ['cade'], isHost: true, hostParticipantId: 'cade',
  activity: { protocolVersion: 4, environment: 'main:test', nonce: 'nonce', deckId: 'animals',
    deckTitle: 'Animals', durationSeconds: 60, hostPublicKey: 'key' },
};
const joined: SharePlaySnapshot = {
  ...waiting, revision: 4, status: 'joined', participantIds: ['cade', 'friend'],
  isHost: false, hostParticipantId: 'friend',
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('leaves invitation cancellation immediately retryable', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.value().open(setup));
  provider.setInviteResult('cancelled');
  await act(async () => provider.value().invite());
  expect(provider.value().invitationPending).toBe(false);

  provider.setInviteResult('success');
  await act(async () => provider.value().invite());
  expect(provider.nativeCalls.filter((call) => call === 'invite')).toHaveLength(2);
  expect(provider.value().invitationPending).toBe(true);
  await provider.unmount();
});

it('shows successful invitation feedback for two seconds', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.value().open(setup));
  await act(async () => provider.value().invite());
  expect(provider.value().invitationPending).toBe(true);
  act(() => provider.advanceTime(1_999));
  expect(provider.value().invitationPending).toBe(true);
  act(() => provider.advanceTime(1));
  expect(provider.value().invitationPending).toBe(false);
  await provider.unmount();
});

it('activation before invitation feedback expires cancels the delayed UI update', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.value().open(setup));
  await act(async () => provider.value().invite());
  act(() => provider.emitSession(waiting));
  await provider.flush();
  expect(provider.value().invitationPending).toBe(false);
  act(() => provider.advanceTime(2_000));
  expect(provider.value().invitationPending).toBe(false);
  expect(provider.value().session.sessionId).toBe('session-1');
  await provider.unmount();
});

it('provider unmount cancels invitation feedback and native subscriptions', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.value().open(setup));
  await act(async () => provider.value().invite());
  const mountedTimerCount = provider.pendingTimerCount();
  const activeSubscriptions = provider.activeSubscriptions();
  expect(mountedTimerCount).toBeGreaterThan(0);
  expect(activeSubscriptions).toBeGreaterThan(0);

  await provider.unmount();
  expect(provider.subscriptionRemovals()).toBe(activeSubscriptions);
  expect(provider.activeSubscriptions()).toBe(0);
  expect(provider.pendingTimerCount()).toBeLessThan(mountedTimerCount);
  act(() => provider.advanceTime(2_000));
});

type TerminalExpectation = {
  value: ReturnType<typeof mountSharePlayProvider>['value'];
  removedKeys: string[];
  liveGameSessions: SharePlaySnapshot[];
};

function expectTerminalCleanup(provider: TerminalExpectation) {
  expect(provider.value().session.sessionId).toBeNull();
  expect(provider.value()).toMatchObject({
    invitationPending: false, rejoinOffered: false, setup: null, isOpen: false,
  });
  expect(provider.removedKeys).toContain('whatz-it.shareplay.rejoin-session');
  expect(provider.liveGameSessions.at(-1)).toMatchObject({ status: 'idle', sessionId: null });
}

it.each([
  { nativeResult: 'success', leaveFails: false },
  { nativeResult: 'failure', leaveFails: true },
] as const)('explicit leave applies terminal cleanup after native $nativeResult', async ({ leaveFails }) => {
  const provider = mountSharePlayProvider({ snapshot: joined, leaveFails });
  await provider.flush();
  await act(async () => provider.value().leave());
  expect(provider.nativeCalls).toContain('leave');
  expectTerminalCleanup(provider);
  await provider.unmount();
});

it.each([
  { nativeResult: 'success', leaveFails: false },
  { nativeResult: 'failure', leaveFails: true },
] as const)('declined rejoin applies terminal cleanup after native $nativeResult', async ({ leaveFails }) => {
  const provider = mountSharePlayProvider({
    snapshot: { ...joined, activity: { ...joined.activity!, nonce: 'saved-nonce' } },
    savedRejoinNonce: 'saved-nonce', leaveFails,
  });
  await provider.flush();
  expect(provider.value().rejoinOffered).toBe(true);
  await act(async () => provider.value().declineRejoin());
  expect(provider.nativeCalls).toContain('leave');
  expectTerminalCleanup(provider);
  await provider.unmount();
});

it.each([
  { trigger: 'native invalidation', kind: 'invalidation', terminalSessionId: null },
  { trigger: 'terminal snapshot with a session identifier', kind: 'snapshot', terminalSessionId: 'session-1' },
  { trigger: 'terminal snapshot without a session identifier', kind: 'snapshot', terminalSessionId: null },
] as const)('$trigger applies the shared terminal cleanup contract', async ({ kind, terminalSessionId }) => {
  const provider = mountSharePlayProvider({ snapshot: joined });
  await provider.flush();
  act(() => provider.value().open(setup));
  const terminal: SharePlaySnapshot = {
    ...idleSnapshot, revision: joined.revision + 1, status: 'ended', sessionId: terminalSessionId,
    localParticipantId: terminalSessionId ? 'cade' : null,
    participantIds: terminalSessionId ? ['cade'] : [],
    isHost: !!terminalSessionId, hostParticipantId: terminalSessionId ? 'cade' : null,
  };

  if (kind === 'invalidation') {
    provider.setNativeSnapshot(terminal);
    act(() => provider.emitError('sessionInvalidated'));
  } else {
    act(() => provider.emitSession(terminal));
  }
  await provider.flush();
  expectTerminalCleanup(provider);
  await provider.unmount();
});

it('a delayed invitation timer cannot resurrect UI after terminal cleanup', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.value().open(setup));
  await act(async () => provider.value().invite());
  expect(provider.value().invitationPending).toBe(true);

  act(() => provider.emitSession({ ...waiting, revision: 2 }));
  await provider.flush();
  act(() => provider.emitSession({ ...waiting, revision: 3, status: 'ended' }));
  await provider.flush();
  act(() => provider.advanceTime(2_000));
  expectTerminalCleanup(provider);
  await provider.unmount();
});

it('a delayed explicit leave from an older session cannot erase its active replacement', async () => {
  const provider = mountSharePlayProvider({ snapshot: joined, deferLeave: true });
  await provider.flush();
  let leave: Promise<void>;
  act(() => { leave = provider.value().leave(); });
  await provider.flush();

  const replacement = {
    ...joined, revision: 5, sessionId: 'session-2', activity: { ...joined.activity!, nonce: 'replacement' },
  };
  act(() => provider.emitSession(replacement));
  provider.resolveLeave();
  await act(async () => leave!);

  expect(provider.value().session).toMatchObject({ status: 'joined', sessionId: 'session-2' });
  expect(provider.value().isOpen).toBe(true);
  expect(provider.liveGameSessions.at(-1)).toMatchObject({ sessionId: 'session-2' });
  await provider.unmount();
});

it('an old session terminal event cannot overwrite the active replacement', async () => {
  const provider = mountSharePlayProvider({ snapshot: joined });
  await provider.flush();
  const replacement = {
    ...joined, revision: 5, sessionId: 'session-2', activity: { ...joined.activity!, nonce: 'replacement' },
  };
  act(() => provider.emitSession(replacement));
  await provider.flush();

  act(() => provider.emitSession({ ...joined, revision: 6, status: 'ended', sessionId: 'session-1' }));
  await provider.flush();

  expect(provider.value().session).toMatchObject({ status: 'joined', sessionId: 'session-2' });
  expect(provider.value().isOpen).toBe(true);
  expect(provider.liveGameSessions.at(-1)).toMatchObject({ sessionId: 'session-2' });
  await provider.unmount();
});

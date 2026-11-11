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

it('makes successful invitation feedback transient and leaves cancellation immediately retryable', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  expect(provider.value().initialized).toBe(true);

  act(() => provider.value().open(setup));
  provider.setInviteResult('cancelled');
  await act(async () => provider.value().invite());
  expect(provider.value().invitationPending).toBe(false);

  provider.setInviteResult('success');
  await act(async () => provider.value().invite());
  expect(provider.value().invitationPending).toBe(true);

  act(() => jest.advanceTimersByTime(2_000));
  expect(provider.value().invitationPending).toBe(false);
  await provider.unmount();
});

it('clears setup and invitation state on activation and terminal snapshots without accepting delayed feedback', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.value().open(setup));
  await act(async () => provider.value().invite());
  expect(provider.value().invitationPending).toBe(true);

  act(() => provider.emitSession(waiting));
  await provider.flush();
  expect(provider.value().invitationPending).toBe(false);

  const ended = { ...waiting, revision: 2, status: 'ended' as const, sessionId: null,
    localParticipantId: null, participantIds: [], isHost: false, hostParticipantId: null, activity: null };
  act(() => {
    provider.emitSession(ended);
    provider.emitSession({ ...waiting, revision: 3, sessionId: 'session-2' });
    provider.emitSession({ ...waiting, revision: 4 });
    provider.emitSession({ ...ended, revision: 5 });
    jest.advanceTimersByTime(2_000);
  });
  await provider.flush();
  expect(provider.value().session).toMatchObject({ status: 'ended', sessionId: null });
  expect(provider.value()).toMatchObject({ invitationPending: false, setup: null, isOpen: false });
  expect(provider.removedKeys).toContain('whatz-it.shareplay.rejoin-session');

  provider.setNativeSnapshot({ ...idleSnapshot, revision: 6 });
  act(() => provider.value().open(setup));
  await act(async () => provider.value().invite());
  expect(provider.nativeCalls.filter((call) => call === 'invite')).toHaveLength(2);
  expect(provider.value().invitationPending).toBe(true);
  await provider.unmount();
});

it('declining a cold-launch rejoin leaves native SharePlay and removes persisted rejoin state', async () => {
  const provider = mountSharePlayProvider({
    snapshot: { ...joined, activity: { ...joined.activity!, nonce: 'saved-nonce' } },
    savedRejoinNonce: 'saved-nonce',
  });
  await provider.flush();
  expect(provider.value().rejoinOffered).toBe(true);

  await act(async () => provider.value().declineRejoin());
  expect(provider.nativeCalls).toContain('leave');
  expect(provider.removedKeys).toContain('whatz-it.shareplay.rejoin-session');
  expect(provider.value()).toMatchObject({ rejoinOffered: false, isOpen: false });
  expect(provider.value().session.sessionId).toBeNull();
  await provider.unmount();
});

it('hides a terminal snapshot even when the first callback still carries a session ID', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.emitSession({
    revision: 1, status: 'ended', sessionId: 'ended-session', localParticipantId: 'cade',
    participantIds: ['cade'], isHost: true, hostParticipantId: 'cade', activity: null,
  }));
  await provider.flush();
  expect(provider.value().session).toMatchObject({ status: 'idle', sessionId: null });
  expect(provider.value()).toMatchObject({ setup: null, isOpen: false });
  await provider.unmount();
});

it('cleans provider state for explicit leave failure and native invalidation with the sheet closed', async () => {
  const left = mountSharePlayProvider({ snapshot: joined, leaveFails: true });
  await left.flush();
  await act(async () => left.value().leave());
  expect(left.value().session.sessionId).toBeNull();
  expect(left.value()).toMatchObject({ setup: null, isOpen: false });
  expect(left.liveGameSessions.at(-1)).toMatchObject({ status: 'idle', sessionId: null });
  await left.unmount();

  const invalidated = mountSharePlayProvider({ snapshot: joined });
  await invalidated.flush();
  invalidated.setNativeSnapshot({ ...joined, revision: 5, status: 'ended', sessionId: null,
    localParticipantId: null, participantIds: [], isHost: false, hostParticipantId: null, activity: null });
  act(() => invalidated.emitError('sessionInvalidated'));
  await invalidated.flush();
  expect(invalidated.value().session).toMatchObject({ status: 'ended', sessionId: null });
  expect(invalidated.value()).toMatchObject({ setup: null, isOpen: false });
  expect(invalidated.removedKeys).toContain('whatz-it.shareplay.rejoin-session');
  await invalidated.unmount();
});

it('removes native subscriptions and invitation feedback timers on unmount', async () => {
  const provider = mountSharePlayProvider();
  await provider.flush();
  act(() => provider.value().open(setup));
  await act(async () => provider.value().invite());
  const mountedTimerCount = jest.getTimerCount();
  expect(mountedTimerCount).toBeGreaterThan(0);
  const activeSubscriptions = provider.activeSubscriptions();
  expect(activeSubscriptions).toBeGreaterThan(0);

  await provider.unmount();
  expect(provider.subscriptionRemovals()).toBe(activeSubscriptions);
  expect(provider.activeSubscriptions()).toBe(0);
  expect(jest.getTimerCount()).toBeLessThan(mountedTimerCount);
  act(() => jest.advanceTimersByTime(2_000));
});

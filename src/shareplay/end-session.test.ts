import assert from 'node:assert/strict';
import test from 'node:test';
import { endSharePlaySession, isLastSharePlayParticipant } from './end-session';
import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';

test('only the sole joined local participant ends the session on Leave', () => {
  const session: SharePlaySnapshot = { revision: 1, status: 'joined', sessionId: 'session',
    localParticipantId: 'last', participantIds: ['last'], isHost: false,
    hostParticipantId: 'departed-host', activity: null };
  assert.equal(isLastSharePlayParticipant(session), true);
  assert.equal(isLastSharePlayParticipant({ ...session, participantIds: ['last', 'friend'] }), false);
  assert.equal(isLastSharePlayParticipant({ ...session, participantIds: ['friend'] }), false);
  assert.equal(isLastSharePlayParticipant({ ...session, participantIds: [] }), false);
  assert.equal(isLastSharePlayParticipant({ ...session, status: 'waiting' }), false);
  assert.equal(isLastSharePlayParticipant({ ...session, status: 'ended' }), false);
});

test('ending tells participants to exit before ending the native session', async () => {
  const events: string[] = [];
  await endSharePlaySession({ notifyParticipants: async () => { events.push('notify'); },
    endNativeSession: async () => { events.push('end'); },
    leaveNativeSession: async () => { events.push('leave'); }, onFailure: () => undefined });
  assert.deepEqual(events, ['notify', 'end']);
});

test('an older bridge rejecting the elected host falls back to leaving after notifying everyone', async () => {
  const events: string[] = [];
  await endSharePlaySession({ notifyParticipants: async () => { events.push('notify'); },
    endNativeSession: async () => { throw new Error('SharePlay: notHost'); },
    leaveNativeSession: async () => { events.push('leave'); }, onFailure: (stage) => events.push(stage) });
  assert.deepEqual(events, ['notify', 'native', 'leave']);
});

test('failed messages do not prevent native end, but failure of both paths is reported', async () => {
  let ended = false;
  const options = { notifyParticipants: async () => { throw new Error('send failed'); },
    endNativeSession: async () => { ended = true; },
    leaveNativeSession: async () => { throw new Error('must not leave'); }, onFailure: () => undefined };
  await endSharePlaySession(options);
  assert.equal(ended, true);
  await assert.rejects(endSharePlaySession({ ...options,
    endNativeSession: async () => { throw new Error('end failed'); } }), /end failed/);
});

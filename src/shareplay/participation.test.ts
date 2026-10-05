import assert from 'node:assert/strict';
import test from 'node:test';
import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { parseGameWire } from './game-wire';
import { resolveSharePlayHost } from './host-election';
import { SharePlayParticipation, shouldOfferSharePlayRejoin } from './participation';

const session: SharePlaySnapshot = {
  revision: 1, status: 'joined', sessionId: 'session', localParticipantId: 'host',
  participantIds: ['host', 'guest'], isHost: true, hostParticipantId: 'host',
  activity: { protocolVersion: 4, environment: 'test', nonce: 'activity', deckId: 'deck',
    deckTitle: 'Deck', durationSeconds: 60, hostPublicKey: 'key' },
};

test('a fresh launch offers rejoin only for the previously joined activity', () => {
  assert.equal(shouldOfferSharePlayRejoin(session, 'activity'), true);
  assert.equal(shouldOfferSharePlayRejoin({ ...session, status: 'waiting' }, 'activity'), true);
  assert.equal(shouldOfferSharePlayRejoin(session, null), false);
  assert.equal(shouldOfferSharePlayRejoin(session, 'another-activity'), false);
  assert.equal(shouldOfferSharePlayRejoin({ ...session, status: 'ended' }, 'activity'), false);
  assert.equal(shouldOfferSharePlayRejoin({ ...session, localParticipantId: null }, 'activity'), false);
});

test('native roster refreshes preserve a declined rejoin until explicit acceptance', () => {
  const participants = new SharePlayParticipation();
  participants.sync(session);
  participants.exclude('host');
  participants.sync({ ...session, revision: 2, status: 'waiting', participantIds: ['guest'] });
  assert.equal(participants.isActive('host'), false);
  participants.sync({ ...session, revision: 3 });
  assert.deepEqual(participants.project(session).participantIds, ['guest']);
  assert.equal(participants.project(session).isHost, false);
  assert.equal(resolveSharePlayHost(participants.project(session), true).hostParticipantId, 'guest');
  participants.update('host', true, 10);
  assert.deepEqual(participants.project(session).participantIds, ['host', 'guest']);
});

test('stale presence cannot put a withdrawn player back into the game', () => {
  const participants = new SharePlayParticipation();
  participants.sync(session);
  assert.equal(participants.update('guest', false, 20), true);
  assert.equal(participants.update('guest', true, 19), false);
  assert.equal(participants.update('guest', true, 20), false);
  assert.equal(participants.isActive('guest'), false);
  assert.equal(participants.update('guest', true, 21), true);
  assert.equal(participants.isActive('guest'), true);
});

test('a new activity clears participation decisions from the old call', () => {
  const participants = new SharePlayParticipation();
  participants.sync(session);
  participants.update('guest', false, 20);
  participants.sync({ ...session, sessionId: 'new-session' });
  assert.deepEqual(participants.project(session).participantIds, ['host', 'guest']);
  assert.equal(participants.update('guest', true, 1), true);
});

test('presence messages require a boolean and a nonnegative integer sequence', () => {
  const body = { version: 3, kind: 'presence', active: false, sequence: 20 };
  assert.deepEqual(parseGameWire(JSON.stringify(body)), body);
  for (const invalid of [
    { ...body, active: 'false' }, { ...body, sequence: -1 }, { ...body, sequence: 1.5 },
    { ...body, participantId: 'someone-else' },
  ]) assert.equal(parseGameWire(JSON.stringify(invalid)), null);
});

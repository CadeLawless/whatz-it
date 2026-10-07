import assert from 'node:assert/strict';
import test from 'node:test';
import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { acceptsSharePlayHostClaim, recoveryHost, rejoinLobbyRecoveryTarget,
  resolveSharePlayHost, shouldRecoverSharePlayHost } from './host-election';
import { SharePlayParticipation } from './participation';

const base: SharePlaySnapshot = {
  revision: 1, status: 'joined', sessionId: 'session', localParticipantId: 'alice',
  participantIds: ['alice', 'bob', 'inviter'], isHost: false, hostParticipantId: 'inviter',
  activity: null,
};

test('a silent host is replaced without a roster change or the old app reopening', () => {
  assert.equal(shouldRecoverSharePlayHost(base, 1000, 5999, true), false);
  assert.equal(shouldRecoverSharePlayHost(base, 1000, 6000, true), true);
  assert.equal(shouldRecoverSharePlayHost(base, 5500, 6000, true), false);
  assert.equal(shouldRecoverSharePlayHost(base, 1000, 6000, false), false);
  assert.equal(shouldRecoverSharePlayHost({ ...base, isHost: true }, 1000, 6000, true), false);
  assert.equal(shouldRecoverSharePlayHost({ ...base, status: 'ended' }, 1000, 6000, true), false);
});

test('keeps the signed inviter while present and elects a remaining participant on departure', () => {
  assert.equal(resolveSharePlayHost(base), base);
  const afterDeparture = { ...base, participantIds: ['bob', 'alice'] };
  assert.deepEqual(resolveSharePlayHost(afterDeparture), {
    ...afterDeparture, isHost: true, hostParticipantId: 'alice', electedHost: true,
  });
  assert.equal(resolveSharePlayHost({ ...afterDeparture, localParticipantId: 'bob' }).isHost, false);
  assert.equal(resolveSharePlayHost({ ...afterDeparture, participantIds: ['bob', 'alice', 'aaron'] },
    false, 'alice').hostParticipantId, 'alice');
});

test('a late joiner waits for a signed host announcement before fallback election', () => {
  const unknown = { ...base, hostParticipantId: null };
  assert.equal(resolveSharePlayHost(unknown), unknown);
  assert.equal(resolveSharePlayHost(unknown, true).hostParticipantId, 'alice');
  assert.equal(resolveSharePlayHost({ ...unknown, status: 'idle' }, true).hostParticipantId, null);
});

test('a bound inviter identity can recover host ownership without the lost signing key', () => {
  const restarted = { ...base, localParticipantId: 'inviter', isHost: false };
  assert.equal(resolveSharePlayHost(restarted).isHost, true);
  assert.equal(resolveSharePlayHost(restarted).electedHost, true);
  // A recovered inviter still yields to a successor who remained in the call.
  assert.equal(resolveSharePlayHost(restarted, false, 'alice').isHost, false);
});

test('heartbeat recovery automatically picks a connected player and ignores the silent host', () => {
  assert.equal(recoveryHost(base, ['inviter', 'bob']), 'alice');
  assert.equal(recoveryHost({ ...base, localParticipantId: 'bob' }, ['inviter', 'alice']), 'alice');
  assert.equal(recoveryHost(base, ['outsider']), 'alice');
});

test('rejoining and simultaneous host claims converge without a player vote', () => {
  assert.equal(acceptsSharePlayHostClaim('inviter', 0, 'alice', 1, false), true);
  assert.equal(acceptsSharePlayHostClaim('alice', 1, 'inviter', 0, true), false);
  assert.equal(acceptsSharePlayHostClaim('bob', 1, 'alice', 1, false), true);
  assert.equal(acceptsSharePlayHostClaim('alice', 1, 'bob', 1, false), false);
  assert.equal(acceptsSharePlayHostClaim('alice', 1, 'bob', 2, false), true);
  assert.equal(acceptsSharePlayHostClaim('alice', 2, 'bob', 1, false), false);
  assert.equal(acceptsSharePlayHostClaim('alice', 2, 'alice', 2, false), true);
});

test('simultaneous cold rejoin does not elect the other player while each phone is withdrawn', () => {
  const alice = { ...base, participantIds: ['alice', 'bob'], hostParticipantId: null };
  const bob = { ...alice, localParticipantId: 'bob' };
  const alicePresence = new SharePlayParticipation();
  const bobPresence = new SharePlayParticipation();
  alicePresence.sync(alice); bobPresence.sync(bob);
  alicePresence.exclude('alice'); bobPresence.exclude('bob');
  assert.equal(resolveSharePlayHost(alicePresence.project(alice), true).hostParticipantId, null);
  assert.equal(resolveSharePlayHost(bobPresence.project(bob), true).hostParticipantId, null);
  alicePresence.update('alice', true, 1); bobPresence.update('bob', true, 1);
  assert.equal(resolveSharePlayHost(alicePresence.project(alice), true).hostParticipantId, 'alice');
  assert.equal(resolveSharePlayHost(bobPresence.project(bob), true).hostParticipantId, 'alice');
});

test('connected rejoiners choose the same fallback host after eight seconds without a lobby', () => {
  const alice = { ...base, sessionId: 'rejoined', participantIds: ['alice', 'bob'], hostParticipantId: 'bob' };
  const bob = { ...alice, localParticipantId: 'bob', hostParticipantId: 'alice' };
  for (const snapshot of [alice, bob]) {
    assert.equal(rejoinLobbyRecoveryTarget(snapshot, 'rejoined', true, 1000, 8999), null);
    assert.equal(rejoinLobbyRecoveryTarget(snapshot, 'rejoined', true, 1000, 9000), 'alice');
    assert.equal(rejoinLobbyRecoveryTarget(snapshot, 'rejoined', false, 1000, 9000), null);
    assert.equal(rejoinLobbyRecoveryTarget(snapshot, 'other-session', true, 1000, 9000), null);
  }
});

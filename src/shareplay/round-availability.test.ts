import assert from 'node:assert/strict';
import test from 'node:test';
import { canPlaySharedRound } from './round-availability';

test('one connected friend is enough even when another player is struggling to connect', () => {
  assert.equal(canPlaySharedRound(['host', 'friend', 'offline'], 'host', 'host',
    { friend: 'confirmed', offline: 'checking' }), true);
  assert.equal(canPlaySharedRound(['host', 'friend', 'offline'], 'friend', 'host',
    { host: 'confirmed', offline: 'checking' }), true);
});

test('two players need each other, and a guest needs the session host', () => {
  assert.equal(canPlaySharedRound(['host', 'friend'], 'host', 'host', { friend: 'checking' }), false);
  assert.equal(canPlaySharedRound(['host', 'friend'], 'host', 'host', { friend: 'confirmed' }), true);
  assert.equal(canPlaySharedRound(['host', 'friend', 'other'], 'friend', 'host',
    { host: 'checking', other: 'confirmed' }), false);
});

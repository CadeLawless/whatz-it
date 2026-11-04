import assert from 'node:assert/strict';
import test from 'node:test';
import { canPlayAgainFromResults, canPlaySharedRound } from './round-availability';

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

test('Play Again waits for the new lobby after someone joins during Results', () => {
  const results = { sessionId: 'session', roundId: 'finished', phase: 'results' as const,
    participants: ['host', 'friend'], deck: { deckId: 'deck', contentHash: 'hash', sponsorId: 'host' } };
  const members = ['host', 'friend', 'newcomer'];
  assert.equal(canPlayAgainFromResults(members, results, results, 'deck'), false);
  assert.equal(canPlayAgainFromResults(members, results, null, 'deck'), false);
  assert.equal(canPlayAgainFromResults(['host', 'newcomer'], results, results, 'deck'), false);
  assert.equal(canPlayAgainFromResults(members, results,
    { ...results, roundId: 'next', phase: 'lobby', participants: members }, 'deck'), true);
});

test('Play Again remains available on Results with an unchanged roster', () => {
  const results = { sessionId: 'session', roundId: 'finished', phase: 'results' as const,
    participants: ['host', 'friend'], deck: { deckId: 'deck', contentHash: 'hash', sponsorId: 'host' } };
  assert.equal(canPlayAgainFromResults(results.participants, results, results, 'deck'), true);
  assert.equal(canPlayAgainFromResults(results.participants, results, results, 'other-deck'), false);
});

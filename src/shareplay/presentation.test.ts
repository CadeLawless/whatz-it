import assert from 'node:assert/strict';
import test from 'node:test';
import { canShowSharePlayRoundOptions, sharePlaySurface } from './presentation';

const joined = { enabled: true, joined: true, setupOpen: false, localAvailable: false,
  gameVisible: false, phase: undefined };

test('joined players retain the lobby regardless of dismissed setup or local round state', () => {
  assert.equal(sharePlaySurface(joined), 'lobby');
  assert.equal(sharePlaySurface({ ...joined, phase: 'lobby', gameVisible: true }), 'lobby');
});

test('accepting rejoin keeps the same presentation open from prompt to lobby', () => {
  assert.equal(sharePlaySurface({ ...joined, joined: false, rejoinOffered: true }), 'rejoin');
  // Session reconciliation can complete before the acceptance promise settles.
  assert.equal(sharePlaySurface({ ...joined, rejoinOffered: true }), 'rejoin');
  assert.equal(sharePlaySurface({ ...joined, rejoinOffered: false }), 'lobby');
  assert.equal(sharePlaySurface({ ...joined, joined: false, rejoinOffered: false }), null);
  assert.equal(sharePlaySurface({ ...joined, enabled: false, rejoinOffered: true }), null);
});

test('the same joined surface stays on the round through temporary missing snapshots', () => {
  assert.equal(sharePlaySurface({ ...joined, phase: 'playing', gameVisible: true }), 'round');
  assert.equal(sharePlaySurface({ ...joined, gameVisible: true }), 'round');
  assert.equal(sharePlaySurface({ ...joined, phase: 'results', gameVisible: true }), 'round');
});

test('leaving releases the screen and pre-join setup still respects local gameplay', () => {
  assert.equal(sharePlaySurface({ ...joined, joined: false }), null);
  assert.equal(sharePlaySurface({ ...joined, joined: false, setupOpen: true }), null);
  assert.equal(sharePlaySurface({ ...joined, joined: false, setupOpen: true, localAvailable: true }), 'setup');
  assert.equal(sharePlaySurface({ ...joined, enabled: false }), null);
});

test('round options cannot cover time-up, other results, or a replacement lobby', () => {
  for (const phase of ['results', 'ended', 'lobby', undefined] as const)
    assert.equal(canShowSharePlayRoundOptions(phase), false);
  for (const phase of ['playing', 'feedback', 'handoff', 'paused', 'countdown'] as const)
    assert.equal(canShowSharePlayRoundOptions(phase), true);
});

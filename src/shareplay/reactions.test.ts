import assert from 'node:assert/strict';
import test from 'node:test';

import { canReactInPhase, REACTION_COOLDOWN_MS, SHAREPLAY_REACTIONS,
  SHAREPLAY_RESULTS_REACTIONS, SharePlayReactionGate } from './reactions';

test('reaction choices stay in the requested order', () => {
  assert.deepEqual(SHAREPLAY_REACTIONS.map(({ emoji }) => emoji), ['😂', '🤨', '😳', '🗑️']);
  assert.deepEqual(SHAREPLAY_RESULTS_REACTIONS.map(({ emoji }) => emoji), ['👏', '😬', '😳', '🫣']);
  assert.equal(canReactInPhase('feedback'), false);
  assert.equal(canReactInPhase('results'), true);
});

test('reactions are limited per player and duplicate packets are ignored', () => {
  const gate = new SharePlayReactionGate();
  assert.equal(gate.accept('round', 'alice', 'first', 1000), true);
  assert.equal(gate.accept('round', 'alice', 'second', 1000 + REACTION_COOLDOWN_MS - 1), false);
  assert.equal(gate.accept('round', 'bob', 'first', 1001), true);
  assert.equal(gate.accept('round', 'alice', 'first', 1000 + REACTION_COOLDOWN_MS), false);
  assert.equal(gate.accept('round', 'alice', 'second', 1000 + REACTION_COOLDOWN_MS), true);
  assert.equal(gate.accept('next-round', 'alice', 'first', 1001), true);
});

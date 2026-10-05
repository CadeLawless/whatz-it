import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogDeck } from '@/catalog/catalog-snapshot';

import { parseGameMode } from './game-mode';
import { initialRoundState } from './game-reducer';
import type { RoundAction } from './game-types';
import { captureRoundResultSnapshot } from './round-result-snapshot';
import { resolveRoundTransition } from './round-transition';

function createSession() {
  let state = initialRoundState;
  const seen: string[] = [];
  const send = (action: RoundAction) => {
    const transition = resolveRoundTransition(state, action);
    state = transition.round;
    if (transition.revealedCardId) seen.push(transition.revealedCardId);
    return state;
  };
  send({ type: 'CONFIGURE', mode: 'pass-n-play', deckId: 'animals',
    durationSeconds: 60, cardOrder: ['one', 'two', 'three'] });
  return { send, seen };
}

describe('round transition card-memory decisions', () => {
  it('remembers only cards actually revealed, including with rapid duplicate actions', () => {
    const { send, seen } = createSession();
    assert.deepEqual(seen, []);
    send({ type: 'START', now: 1_000 });
    send({ type: 'START', now: 1_001 });
    send({ type: 'ANSWER', outcome: 'correct', now: 2_000 });
    send({ type: 'ADVANCE', now: 2_100 });
    assert.deepEqual(seen, ['one']);
    send({ type: 'REVEAL', now: 30_000 });
    send({ type: 'REVEAL', now: 30_001 });
    assert.deepEqual(seen, ['one', 'two']);
  });

  it('does not remember a next card after pass feedback has expired', () => {
    const { send, seen } = createSession();
    send({ type: 'START', now: 1_000 });
    send({ type: 'ANSWER', outcome: 'passed', now: 60_900 });
    assert.equal(send({ type: 'ADVANCE', now: 61_000 }).status, 'finished');
    assert.deepEqual(seen, ['one']);
  });

  it('remembers a next card when resuming pass feedback, but not when resuming handoff', () => {
    const { send, seen } = createSession();
    send({ type: 'START', now: 1_000 });
    send({ type: 'ANSWER', outcome: 'passed', now: 2_000 });
    send({ type: 'PAUSE', now: 2_100 });
    send({ type: 'RESUME', now: 20_000 });
    assert.deepEqual(seen, ['one', 'two']);
    send({ type: 'ANSWER', outcome: 'correct', now: 21_000 });
    send({ type: 'ADVANCE', now: 21_350 });
    send({ type: 'PAUSE', now: 22_000 });
    send({ type: 'RESUME', now: 100_000 });
    assert.deepEqual(seen, ['one', 'two']);
    send({ type: 'REVEAL', now: 101_000 });
    assert.deepEqual(seen, ['one', 'two', 'three']);
  });

  it('does not remember the same card again after a normal pause', () => {
    const { send, seen } = createSession();
    send({ type: 'START', now: 1_000 });
    send({ type: 'PAUSE', now: 2_000 });
    send({ type: 'RESUME', now: 20_000 });
    assert.deepEqual(seen, ['one']);
  });
});

describe('game mode compatibility', () => {
  it('completes a mixed round with interrupted handoff and play, then configures a clean replay', () => {
    const { send, seen } = createSession();
    send({ type: 'START', now: 1_000 });
    send({ type: 'ANSWER', outcome: 'passed', now: 2_000 });
    send({ type: 'ADVANCE', now: 2_350 });
    send({ type: 'ANSWER', outcome: 'correct', now: 5_000 });
    const handoff = send({ type: 'ADVANCE', now: 5_350 });
    assert.equal(handoff.endsAt, 61_000);

    assert.equal(send({ type: 'PAUSE', now: 10_000 }).remainingMs, 51_000);
    send({ type: 'RESUME', now: 120_000 });
    assert.deepEqual(seen, ['one', 'two']);
    assert.equal(send({ type: 'REVEAL', now: 150_000 }).endsAt, 171_000);
    assert.equal(send({ type: 'PAUSE', now: 160_000 }).remainingMs, 11_000);
    const resumed = send({ type: 'RESUME', now: 200_000 });
    assert.equal(resumed.endsAt, 211_000);
    assert.strictEqual(send({ type: 'EXPIRE', endsAt: 171_000, now: 206_000 }), resumed);
    const finished = send({ type: 'EXPIRE', endsAt: 211_000, now: 211_000 });
    assert.equal(finished.status, 'finished');
    assert.deepEqual(seen, ['one', 'two', 'three']);
    assert.deepEqual(finished.results.map(({ outcome }) => outcome), ['passed', 'correct', 'neutral']);

    const deck: CatalogDeck = {
      id: 'animals', order: 1, title: 'Animals', description: 'Test deck', version: 1,
      access: 'free', cards: ['one', 'two', 'three'].map((id) => ({ id, text: id })),
      tags: [], cardCount: 3, cardContentVersion: 1, installationStatus: 'installed',
    };
    const snapshot = captureRoundResultSnapshot(finished, deck);
    assert.ok(snapshot);
    assert.equal(snapshot.mode, 'pass-n-play');
    assert.deepEqual(snapshot.results.map(({ text }) => text), seen);
    const replay = send({ type: 'CONFIGURE', mode: parseGameMode(snapshot.mode),
      deckId: snapshot.deckId, durationSeconds: snapshot.durationSeconds, cardOrder: ['three', 'one', 'two'] });
    assert.equal(replay.mode, 'pass-n-play');
    assert.equal(replay.status, 'ready');
    assert.equal(replay.durationSeconds, 60);
    assert.equal(replay.currentCardIndex, 0);
    assert.equal(replay.endsAt, null);
    assert.deepEqual(replay.results, []);
  });

  it('defaults old results and malformed route/storage values to Classic', () => {
    for (const value of [undefined, null, '', 'unknown', [], ['pass-n-play'], {}]) {
      assert.equal(parseGameMode(value), 'classic');
    }
    assert.equal(parseGameMode('classic'), 'classic');
    assert.equal(parseGameMode('pass-n-play'), 'pass-n-play');
  });
});

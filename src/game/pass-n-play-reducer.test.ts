import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialRoundState, roundReducer } from './game-reducer';
import type { GameMode } from './game-types';

function start(mode: GameMode = 'pass-n-play', cardOrder = ['one', 'two']) {
  return roundReducer(roundReducer(initialRoundState, {
    type: 'CONFIGURE', deckId: 'animals', durationSeconds: 60, cardOrder, mode,
  }), { type: 'START', now: 1_000 });
}

function handoff(cardOrder = ['one', 'two']) {
  const feedback = roundReducer(start('pass-n-play', cardOrder), {
    type: 'ANSWER', outcome: 'correct', now: 11_250,
  });
  return roundReducer(feedback, { type: 'ADVANCE', now: 11_600 });
}

describe('Pass n\' Play round transitions', () => {
  it('defaults existing configuration to Classic', () => {
    const configured = roundReducer(initialRoundState, {
      type: 'CONFIGURE', deckId: 'animals', durationSeconds: 60, cardOrder: ['one'],
    });
    assert.equal(configured.mode, 'classic');
    assert.equal(roundReducer(configured, { type: 'RESET' }).mode, 'classic');
  });

  it('scores once, shows correct feedback, then hides the next card while time runs', () => {
    const feedback = roundReducer(start(), { type: 'ANSWER', outcome: 'correct', now: 11_250 });
    assert.equal(feedback.status, 'feedback');
    assert.equal(feedback.latestOutcome, 'correct');
    assert.strictEqual(roundReducer(feedback, { type: 'REVEAL', now: 11_300 }), feedback);
    const state = handoff();
    assert.equal(state.status, 'handoff');
    assert.equal(state.endsAt, 61_000);
    assert.equal(state.remainingMs, null);
    assert.equal(state.currentCardIndex, 0);
    assert.deepEqual(state.results, [{ cardId: 'one', outcome: 'correct', answeredAt: 11_250 }]);
    assert.strictEqual(roundReducer(state, { type: 'ANSWER', outcome: 'correct', now: 12_000 }), state);
    assert.strictEqual(roundReducer(state, { type: 'ADVANCE', now: 12_000 }), state);
  });

  it('reveals only on recipient input without extending the deadline', () => {
    const revealed = roundReducer(handoff(), { type: 'REVEAL', now: 50_000 });
    assert.equal(revealed.status, 'playing');
    assert.equal(revealed.currentCardIndex, 1);
    assert.equal(revealed.endsAt, 61_000);
    assert.equal(revealed.remainingMs, null);
    assert.equal(revealed.latestOutcome, null);
    assert.equal(revealed.results.length, 1);
    assert.strictEqual(roundReducer(revealed, { type: 'REVEAL', now: 50_001 }), revealed);
    assert.strictEqual(roundReducer(start('classic'), { type: 'REVEAL', now: 2_000 }).status, 'playing');
  });

  it('keeps time running when skipping a card', () => {
    const passed = roundReducer(start(), { type: 'ANSWER', outcome: 'passed', now: 11_250 });
    assert.equal(passed.status, 'feedback');
    assert.equal(passed.endsAt, 61_000);
    assert.equal(passed.remainingMs, null);
    assert.strictEqual(roundReducer(passed, { type: 'ADVANCE' }), passed);
    const advanced = roundReducer(passed, { type: 'ADVANCE', now: 11_500 });
    assert.equal(advanced.currentCardIndex, 1);
    assert.equal(advanced.endsAt, 61_000);
    assert.equal(advanced.results[0].outcome, 'passed');
  });

  it('restores a running handoff after a manual or background pause', () => {
    const state = handoff();
    const paused = roundReducer(state, { type: 'PAUSE', now: 20_000 });
    assert.equal(paused.pausedStatus, 'handoff');
    assert.equal(paused.remainingMs, 41_000);
    const resumed = roundReducer(paused, { type: 'RESUME', now: 100_000 });
    assert.equal(resumed.status, 'handoff');
    assert.equal(resumed.endsAt, 141_000);
    assert.equal(resumed.remainingMs, null);
    assert.equal(resumed.currentCardIndex, 0);
    const revealed = roundReducer(resumed, { type: 'REVEAL', now: 110_000 });
    assert.equal(revealed.endsAt, 141_000);
  });

  it('expires during handoff without recording an unseen card', () => {
    const state = handoff();
    const expired = roundReducer(state, { type: 'EXPIRE', endsAt: 61_000, now: 61_000 });
    assert.equal(expired.status, 'finished');
    assert.deepEqual(expired.results, state.results);
    const revealed = roundReducer(state, { type: 'REVEAL', now: 60_000 });
    assert.strictEqual(roundReducer(revealed, {
      type: 'EXPIRE', endsAt: 61_000, now: 60_999,
    }), revealed);
    const revealedExpired = roundReducer(revealed, { type: 'EXPIRE', endsAt: 61_000, now: 61_000 });
    assert.equal(revealedExpired.status, 'finished');
    assert.equal(revealedExpired.results[1].outcome, 'neutral');
  });

  it('lets expiry win over a correct or pass tap at the deadline', () => {
    for (const outcome of ['correct', 'passed'] as const) {
      for (const now of [61_000, 61_001]) {
        const expired = roundReducer(start(), { type: 'ANSWER', outcome, now });
        assert.equal(expired.status, 'finished');
        assert.deepEqual(expired.results, [{ cardId: 'one', outcome: 'neutral', answeredAt: now }]);
      }
    }
  });

  it('does not reveal or add an unanswered card when pass feedback expires', () => {
    const passed = roundReducer(start(), { type: 'ANSWER', outcome: 'passed', now: 60_900 });
    const expired = roundReducer(passed, { type: 'ADVANCE', now: 61_000 });
    assert.equal(expired.status, 'finished');
    assert.equal(expired.currentCardIndex, 0);
    assert.equal(expired.results.length, 1);
    assert.equal(expired.results[0].outcome, 'passed');
  });

  it('can replenish on reveal or finish when no next card exists', () => {
    const state = handoff(['one']);
    const revealed = roundReducer(state, {
      type: 'REVEAL', now: 20_000, replenishedCardOrder: ['two'],
    });
    assert.equal(revealed.status, 'playing');
    assert.deepEqual(revealed.cardOrder, ['one', 'two']);
    assert.equal(revealed.currentCardIndex, 1);
    const finished = roundReducer(state, { type: 'REVEAL', now: 20_000 });
    assert.equal(finished.status, 'finished');
    assert.deepEqual(finished.results, state.results);
  });

  it('rejects reveal at and after the handoff deadline', () => {
    for (const now of [61_000, 61_001]) {
      const state = handoff();
      const finished = roundReducer(state, { type: 'REVEAL', now });
      assert.equal(finished.status, 'finished');
      assert.equal(finished.currentCardIndex, 0);
      assert.deepEqual(finished.results, state.results);
    }
  });

  it('finishes during correct feedback and restores interrupted feedback to handoff', () => {
    const feedback = roundReducer(start(), { type: 'ANSWER', outcome: 'correct', now: 60_900 });
    const expired = roundReducer(feedback, { type: 'ADVANCE', now: 61_000 });
    assert.equal(expired.status, 'finished');
    assert.deepEqual(expired.results, feedback.results);
    const paused = roundReducer(feedback, { type: 'PAUSE', now: 60_950 });
    const resumed = roundReducer(paused, { type: 'RESUME', now: 90_000 });
    assert.equal(resumed.status, 'handoff');
    assert.equal(resumed.endsAt, 90_050);
    assert.equal(resumed.currentCardIndex, 0);
    assert.deepEqual(resumed.results, feedback.results);
    assert.strictEqual(roundReducer(resumed, { type: 'EXPIRE', endsAt: 61_000, now: 90_000 }), resumed);
  });

  it('does not count unseen cards on setup cancellation or handoff exit', () => {
    const ready = roundReducer(initialRoundState, {
      type: 'CONFIGURE', deckId: 'animals', durationSeconds: 60,
      cardOrder: ['one', 'two'], mode: 'pass-n-play',
    });
    assert.deepEqual(roundReducer(ready, { type: 'FINISH', now: 500 }).results, []);
    const state = handoff();
    assert.deepEqual(roundReducer(state, { type: 'FINISH', now: 20_000 }).results, state.results);
  });

  it('records the revealed unanswered card when ending from pause', () => {
    const paused = roundReducer(start(), { type: 'PAUSE', now: 2_000 });
    const finished = roundReducer(paused, { type: 'FINISH', now: 3_000 });
    assert.deepEqual(finished.results, [{ cardId: 'one', outcome: 'neutral', answeredAt: 3_000 }]);
    const pausedHandoff = roundReducer(handoff(), { type: 'PAUSE', now: 20_000 });
    assert.equal(roundReducer(pausedHandoff, { type: 'FINISH', now: 30_000 }).results.length, 1);
  });

  it('finishes instead of pausing an expired round', () => {
    const finished = roundReducer(start(), { type: 'PAUSE', now: 61_000 });
    assert.equal(finished.status, 'finished');
    assert.equal(finished.results[0].outcome, 'neutral');
  });
});

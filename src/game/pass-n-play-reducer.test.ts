import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialRoundState, roundReducer } from './game-reducer';
import type { GameMode, RoundAction } from './game-types';

function start(mode: GameMode = 'pass-n-play', cardOrder = ['one', 'two']) {
  return roundReducer(roundReducer(initialRoundState, {
    type: 'CONFIGURE', deckId: 'animals', durationSeconds: 60, cardOrder, mode,
  }), { type: 'START', now: 1_000 });
}

function correctFeedback(cardOrder = ['one', 'two']) {
  return roundReducer(start('pass-n-play', cardOrder), {
    type: 'ANSWER', outcome: 'correct', now: 11_250,
  });
}

describe('Pass n\' Play round transitions', () => {
  it('defaults existing configuration to Classic', () => {
    const configured = roundReducer(initialRoundState, {
      type: 'CONFIGURE', deckId: 'animals', durationSeconds: 60, cardOrder: ['one'],
    });
    assert.equal(configured.mode, 'classic');
    assert.equal(roundReducer(configured, { type: 'RESET' }).mode, 'classic');
  });

  it('scores once, hides the next card during handoff, and reveals only once on tap', () => {
    const feedback = correctFeedback();
    assert.equal(feedback.status, 'feedback');
    assert.equal(feedback.latestOutcome, 'correct');
    assert.equal(feedback.currentCardIndex, 0);
    assert.strictEqual(roundReducer(feedback, { type: 'ANSWER', outcome: 'correct', now: 11_300 }), feedback);
    const handoff = roundReducer(feedback, { type: 'ADVANCE', now: 11_600 });
    assert.equal(handoff.status, 'handoff');
    assert.equal(handoff.currentCardIndex, 0);
    assert.equal(handoff.endsAt, 61_000);
    assert.strictEqual(roundReducer(handoff, { type: 'ADVANCE', now: 11_601 }), handoff);
    assert.strictEqual(roundReducer(handoff, { type: 'ANSWER', outcome: 'correct', now: 11_601 }), handoff);
    const state = roundReducer(handoff, { type: 'REVEAL', now: 12_000 });
    assert.equal(state.status, 'playing');
    assert.equal(state.endsAt, 61_000);
    assert.equal(state.remainingMs, null);
    assert.equal(state.currentCardIndex, 1);
    assert.equal(state.latestOutcome, null);
    assert.deepEqual(state.results, [{ cardId: 'one', outcome: 'correct', answeredAt: 11_250 }]);
    assert.strictEqual(roundReducer(state, { type: 'ADVANCE', now: 12_000 }), state);
    assert.strictEqual(roundReducer(state, { type: 'REVEAL', now: 12_001 }), state);
  });

  it('keeps the original deadline while celebrating, passing, and revealing', () => {
    const state = start();
    const feedback = roundReducer(state, { type: 'ANSWER', outcome: 'correct', now: 50_000 });
    assert.equal(feedback.results[0].answeredAt, 50_000);
    const handoff = roundReducer(feedback, { type: 'ADVANCE', now: 50_350 });
    assert.equal(handoff.currentCardIndex, 0);
    assert.equal(handoff.endsAt, state.endsAt);
    const advanced = roundReducer(handoff, { type: 'REVEAL', now: 60_500 });
    assert.equal(advanced.currentCardIndex, 1);
    assert.equal(advanced.endsAt, 61_000);
    assert.equal(advanced.results.length, 1);
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

  it('restores the current card after a manual or background pause', () => {
    const state = start();
    const paused = roundReducer(state, { type: 'PAUSE', now: 20_000 });
    assert.equal(paused.pausedStatus, 'playing');
    assert.equal(paused.remainingMs, 41_000);
    const resumed = roundReducer(paused, { type: 'RESUME', now: 100_000 });
    assert.equal(resumed.status, 'playing');
    assert.equal(resumed.endsAt, 141_000);
    assert.equal(resumed.remainingMs, null);
    assert.equal(resumed.currentCardIndex, 0);
  });

  it('expires during correct feedback without recording an unseen card', () => {
    const state = correctFeedback();
    const expired = roundReducer(state, { type: 'EXPIRE', endsAt: 61_000, now: 61_000 });
    assert.equal(expired.status, 'finished');
    assert.deepEqual(expired.results, state.results);
    const handoff = roundReducer(state, { type: 'ADVANCE', now: 59_000 });
    const revealed = roundReducer(handoff, { type: 'REVEAL', now: 60_000 });
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

  it('can replenish after a correct answer or finish when no next card exists', () => {
    const feedback = correctFeedback(['one']);
    const state = roundReducer(feedback, { type: 'ADVANCE', now: 11_600 });
    const revealed = roundReducer(state, {
      type: 'REVEAL', now: 20_000, replenishedCardOrder: ['two'],
    });
    assert.equal(revealed.status, 'playing');
    assert.deepEqual(revealed.cardOrder, ['one', 'two']);
    assert.equal(revealed.currentCardIndex, 1);
    const finished = roundReducer(state, { type: 'REVEAL', now: 20_000 });
    assert.equal(finished.status, 'finished');
    assert.deepEqual(finished.results, state.results);
    const paused = roundReducer(state, { type: 'PAUSE', now: 20_000 });
    const resumed = roundReducer(paused, {
      type: 'RESUME', now: 100_000, replenishedCardOrder: ['two'],
    });
    assert.equal(resumed.status, 'handoff');
    assert.equal(resumed.currentCardIndex, 0);
    assert.deepEqual(resumed.cardOrder, ['one']);
    assert.equal(resumed.endsAt, 141_000);
    assert.deepEqual(resumed.results, state.results);
  });

  it('rejects advancing at and after the feedback deadline', () => {
    for (const now of [61_000, 61_001]) {
      const state = correctFeedback();
      const finished = roundReducer(state, { type: 'ADVANCE', now });
      assert.equal(finished.status, 'finished');
      assert.equal(finished.currentCardIndex, 0);
      assert.deepEqual(finished.results, state.results);
    }
  });

  it('finishes expired feedback and resumes interrupted correct feedback at handoff', () => {
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

  it('does not count unseen cards on setup cancellation or feedback exit', () => {
    const ready = roundReducer(initialRoundState, {
      type: 'CONFIGURE', deckId: 'animals', durationSeconds: 60,
      cardOrder: ['one', 'two'], mode: 'pass-n-play',
    });
    assert.deepEqual(roundReducer(ready, { type: 'FINISH', now: 500 }).results, []);
    const state = correctFeedback();
    assert.deepEqual(roundReducer(state, { type: 'FINISH', now: 20_000 }).results, state.results);
  });

  it('expires or ends during handoff without revealing or counting an unseen card', () => {
    const handoff = roundReducer(correctFeedback(), { type: 'ADVANCE', now: 11_600 });
    for (const now of [61_000, 61_001]) {
      for (const action of [
        { type: 'EXPIRE', endsAt: 61_000, now },
        { type: 'REVEAL', now, replenishedCardOrder: ['three'] },
      ] satisfies RoundAction[]) {
        const finished = roundReducer(handoff, action);
        assert.equal(finished.status, 'finished');
        assert.equal(finished.currentCardIndex, 0);
        assert.deepEqual(finished.results, handoff.results);
        assert.strictEqual(roundReducer(finished, { type: 'REVEAL', now }), finished);
        assert.strictEqual(roundReducer(finished, { type: 'ADVANCE', now }), finished);
      }
    }
    const finished = roundReducer(handoff, { type: 'FINISH', now: 20_000 });
    assert.equal(finished.status, 'finished');
    assert.deepEqual(finished.results, handoff.results);
  });

  it('returns to handoff after a background interruption without revealing the answer', () => {
    const handoff = roundReducer(correctFeedback(), { type: 'ADVANCE', now: 11_600 });
    const paused = roundReducer(handoff, { type: 'PAUSE', now: 20_000 });
    assert.equal(paused.pausedStatus, 'handoff');
    const resumed = roundReducer(paused, { type: 'RESUME', now: 100_000 });
    assert.equal(resumed.status, 'handoff');
    assert.equal(resumed.currentCardIndex, 0);
    assert.equal(resumed.endsAt, 141_000);
  });

  it('records the revealed unanswered card when ending from pause', () => {
    const paused = roundReducer(start(), { type: 'PAUSE', now: 2_000 });
    const finished = roundReducer(paused, { type: 'FINISH', now: 3_000 });
    assert.deepEqual(finished.results, [{ cardId: 'one', outcome: 'neutral', answeredAt: 3_000 }]);
    const pausedFeedback = roundReducer(correctFeedback(), { type: 'PAUSE', now: 20_000 });
    assert.equal(roundReducer(pausedFeedback, { type: 'FINISH', now: 30_000 }).results.length, 1);
  });

  it('finishes instead of pausing an expired round', () => {
    const finished = roundReducer(start(), { type: 'PAUSE', now: 61_000 });
    assert.equal(finished.status, 'finished');
    assert.equal(finished.results[0].outcome, 'neutral');
  });
});

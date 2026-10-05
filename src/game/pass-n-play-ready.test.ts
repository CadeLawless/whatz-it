import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  initialPassNPlayReadyState, passNPlayReadyReducer, PASS_N_PLAY_INTRO_MS,
} from './pass-n-play-ready';

describe('Pass n\' Play ready timeline', () => {
  it('waits for explicit readiness, then completes the intro and countdown once', () => {
    const intro = passNPlayReadyReducer(initialPassNPlayReadyState, { type: 'BEGIN', now: 1_000 });
    assert.equal(intro.phase, 'intro');
    assert.equal(intro.endsAt, 1_000 + PASS_N_PLAY_INTRO_MS);
    assert.strictEqual(passNPlayReadyReducer(intro, { type: 'BEGIN', now: 1_001 }), intro);
    const countdown = passNPlayReadyReducer(intro, { type: 'TICK', now: 3_410, endsAt: 3_410 });
    assert.equal(countdown.phase, 'countdown');
    assert.equal(countdown.endsAt, 6_410);
    const complete = passNPlayReadyReducer(countdown, { type: 'TICK', now: 6_410, endsAt: 6_410 });
    assert.equal(complete.phase, 'complete');
    assert.equal(complete.endsAt, null);
    assert.strictEqual(passNPlayReadyReducer(complete, { type: 'TICK', now: 6_411, endsAt: 6_410 }), complete);
  });

  it('preserves an intro interrupted by backgrounding', () => {
    const intro = passNPlayReadyReducer(initialPassNPlayReadyState, { type: 'BEGIN', now: 0 });
    const paused = passNPlayReadyReducer(intro, { type: 'PAUSE', now: 1_000 });
    assert.equal(paused.remainingMs, 1_410);
    assert.equal(paused.endsAt, null);
    assert.strictEqual(passNPlayReadyReducer(paused, { type: 'PAUSE', now: 5_000 }), paused);
    const resumed = passNPlayReadyReducer(paused, { type: 'RESUME', now: 90_000 });
    assert.equal(resumed.phase, 'intro');
    assert.equal(resumed.endsAt, 91_410);
  });

  it('preserves a countdown interrupted at a partial second', () => {
    const intro = passNPlayReadyReducer(initialPassNPlayReadyState, { type: 'BEGIN', now: 0 });
    const countdown = passNPlayReadyReducer(intro, { type: 'TICK', now: 2_410, endsAt: 2_410 });
    const paused = passNPlayReadyReducer(countdown, { type: 'PAUSE', now: 3_660 });
    assert.equal(paused.remainingMs, 1_750);
    const resumed = passNPlayReadyReducer(paused, { type: 'RESUME', now: 90_000 });
    assert.equal(resumed.phase, 'countdown');
    assert.equal(resumed.endsAt, 91_750);
    assert.strictEqual(passNPlayReadyReducer(resumed, { type: 'TICK', now: 90_001, endsAt: 5_410 }), resumed);
  });

  it('ignores premature, duplicate, and backgrounded expiry callbacks', () => {
    const intro = passNPlayReadyReducer(initialPassNPlayReadyState, { type: 'BEGIN', now: 0 });
    assert.strictEqual(passNPlayReadyReducer(intro, { type: 'TICK', now: 2_409, endsAt: 2_410 }), intro);
    const paused = passNPlayReadyReducer(intro, { type: 'PAUSE', now: 500 });
    assert.strictEqual(passNPlayReadyReducer(paused, { type: 'TICK', now: 3_000, endsAt: 2_410 }), paused);
    const countdown = passNPlayReadyReducer(intro, { type: 'TICK', now: 2_410, endsAt: 2_410 });
    assert.strictEqual(passNPlayReadyReducer(countdown, { type: 'TICK', now: 2_411, endsAt: 2_410 }), countdown);
  });

  it('starts a full countdown after a delayed intro callback', () => {
    const intro = passNPlayReadyReducer(initialPassNPlayReadyState, { type: 'BEGIN', now: 0 });
    const countdown = passNPlayReadyReducer(intro, { type: 'TICK', now: 10_000, endsAt: 2_410 });
    assert.equal(countdown.phase, 'countdown');
    assert.equal(countdown.endsAt, 13_000);
  });

  it('cannot resume, begin, or complete after cancellation', () => {
    const intro = passNPlayReadyReducer(initialPassNPlayReadyState, { type: 'BEGIN', now: 0 });
    const cancelled = passNPlayReadyReducer(intro, { type: 'CANCEL' });
    assert.equal(cancelled.phase, 'cancelled');
    assert.equal(cancelled.endsAt, null);
    assert.strictEqual(passNPlayReadyReducer(cancelled, { type: 'RESUME', now: 90_000 }), cancelled);
    assert.strictEqual(passNPlayReadyReducer(cancelled, { type: 'BEGIN', now: 90_000 }), cancelled);
    assert.strictEqual(passNPlayReadyReducer(cancelled, { type: 'TICK', now: 90_000, endsAt: 2_410 }), cancelled);
  });
});

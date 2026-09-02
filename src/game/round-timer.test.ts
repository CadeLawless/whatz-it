import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getNextSecondBoundaryDelay,
  getRemainingSeconds,
  getRemainingSecondsFromMs,
  scheduleRoundTimer,
} from '@/hooks/use-round-timer';

describe('round timer scheduling', () => {
  it('emits 3, 2, 1, 0 once each on the absolute countdown timeline', (context) => {
    context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const values: number[] = [];
    const stop = scheduleRoundTimer(3000, (value) => values.push(value));
    context.mock.timers.tick(1000);
    context.mock.timers.tick(1000);
    context.mock.timers.tick(1000);
    context.mock.timers.tick(5000);
    assert.deepEqual(values, [3, 2, 1, 0]);
    stop();
  });

  it('cancels the old countdown before starting another deck', (context) => {
    context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const old: number[] = [];
    const current: number[] = [];
    const stopOld = scheduleRoundTimer(3000, (value) => old.push(value));
    context.mock.timers.tick(1000);
    stopOld();
    const stopCurrent = scheduleRoundTimer(4000, (value) => current.push(value));
    context.mock.timers.tick(1000);
    context.mock.timers.tick(1000);
    context.mock.timers.tick(1000);
    assert.deepEqual(old, [3, 2]);
    assert.deepEqual(current, [3, 2, 1, 0]);
    stopCurrent();
  });

  it('skips expired beats after a JS stall instead of bursting old cues', (context) => {
    context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    const values: number[] = [];
    const stop = scheduleRoundTimer(3000, (value) => values.push(value));
    context.mock.timers.tick(2200);
    assert.deepEqual(values, [3, 1]);
    context.mock.timers.tick(800);
    assert.deepEqual(values, [3, 1, 0]);
    stop();
  });
  it('targets the exact next whole-second boundary', () => {
    assert.equal(getRemainingSeconds(30_000, 0), 30);
    assert.equal(getNextSecondBoundaryDelay(30_000, 30, 0), 1_000);
  });

  it('corrects a late callback instead of accumulating its delay', () => {
    const now = 1_220;
    const remaining = getRemainingSeconds(30_000, now);

    assert.equal(remaining, 29);
    assert.equal(getNextSecondBoundaryDelay(30_000, remaining, now), 780);
  });

  it('preserves the displayed second when the round is paused', () => {
    assert.equal(getRemainingSecondsFromMs(6_250), 7);
    assert.equal(getRemainingSecondsFromMs(0), 0);
    assert.equal(getRemainingSecondsFromMs(null), 0);
  });
});

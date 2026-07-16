import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getNextSecondBoundaryDelay,
  getRemainingSeconds,
} from '@/hooks/use-round-timer';

describe('round timer scheduling', () => {
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
});

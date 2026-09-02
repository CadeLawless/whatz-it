import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getClockwiseLandscapeInsets } from '@/utils/clockwise-landscape-insets';

describe('clockwise landscape safe-area mapping', () => {
  it('moves a portrait bottom navigation dock to the landscape right edge', () => {
    assert.deepEqual(
      getClockwiseLandscapeInsets({ top: 24, right: 0, bottom: 48, left: 0 }),
      { top: 0, right: 48, bottom: 0, left: 24 },
    );
  });

  it('preserves zero insets on unobstructed edges', () => {
    assert.deepEqual(
      getClockwiseLandscapeInsets({ top: 0, right: 0, bottom: 0, left: 0 }),
      { top: 0, right: 0, bottom: 0, left: 0 },
    );
  });
});

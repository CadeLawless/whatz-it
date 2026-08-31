import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRITICAL_ROUND_SOUNDS,
  GAMEPLAY_ROUND_SOUNDS,
  playerKeyForRoundSound,
  type RoundSoundId,
} from './round-sound-plan';

describe('round sound loading plan', () => {
  it('uses independent native players for countdown cues', () => {
    assert.equal(playerKeyForRoundSound('count-3'), 'count-3');
    assert.equal(playerKeyForRoundSound('count-2'), 'count-2');
    assert.equal(playerKeyForRoundSound('count-1'), 'count-1');
  });

  it('identifies the intro cues that receive eager module-scope preloading', () => {
    assert.deepEqual(CRITICAL_ROUND_SOUNDS, [
      'get-ready',
      'count-3',
      'round-start',
    ]);
    assert.deepEqual(GAMEPLAY_ROUND_SOUNDS, [
      'final-tick',
      'correct',
      'pass',
      'flip',
      'round-end',
    ]);
  });

  it('needs eleven players including isolated intro and overlapping final-tick cues', () => {
    const sounds: RoundSoundId[] = [
      'get-ready',
      'count-3',
      'count-2',
      'count-1',
      'round-start',
      'correct',
      'pass',
      'flip',
      'round-end',
    ];
    const playerKeys = new Set(sounds.map(playerKeyForRoundSound));
    playerKeys.add('final-tick-a');
    playerKeys.add('final-tick-b');
    assert.equal(playerKeys.size, 11);
  });
});

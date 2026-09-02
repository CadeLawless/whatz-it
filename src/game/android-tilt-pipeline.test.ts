import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANDROID_TILT_CONFIG, DEFAULT_TILT_CONFIG, createTiltDetectorState, updateTiltDetector } from './tilt-detector';
import { initialRoundState, roundReducer } from './game-reducer';

test('deep Android tilts return to the next card on the first neutral sample over repeated flips', () => {
  let detector = createTiltDetectorState(0);
  let round = roundReducer(initialRoundState, {
    type: 'CONFIGURE', deckId: 'test', durationSeconds: 120,
    cardOrder: Array.from({ length: 101 }, (_, index) => String(index)),
  });
  round = roundReducer(round, { type: 'START', now: 0 });
  for (let flip = 0; flip < 100; flip += 1) {
    const direction = flip % 2 === 0 ? 1 : -1;
    for (let sample = 0; sample < 12; sample += 1) {
      const result = updateTiltDetector(detector, direction * 1.3, ANDROID_TILT_CONFIG, round.status === 'playing');
      detector = result.state;
      if (result.action) round = roundReducer(round, { type: 'ANSWER', outcome: result.action, now: flip * 1000 });
    }
    assert.equal(round.status, 'feedback');
    assert.equal(round.results.length, flip + 1);
    const neutral = updateTiltDetector(detector, 0, ANDROID_TILT_CONFIG, false);
    assert.equal(neutral.rearmed, true, 'no low-pass filter tail or timer gates neutral');
    detector = neutral.state;
    round = roundReducer(round, { type: 'ADVANCE' });
    assert.equal(round.status, 'playing');
    assert.equal(round.currentCardIndex, flip + 1);
    const centered = updateTiltDetector(detector, 0, ANDROID_TILT_CONFIG);
    assert.equal(centered.action, null);
    detector = centered.state;
  }
});

test('Android still rejects a single noisy trigger sample', () => {
  const spike = updateTiltDetector(createTiltDetectorState(0), 1.5, ANDROID_TILT_CONFIG);
  assert.equal(spike.action, null);
  assert.equal(updateTiltDetector(spike.state, 0, ANDROID_TILT_CONFIG).action, null);
});

test('iOS retains its original filtered neutral detection and two-sample rearm', () => {
  assert.equal(DEFAULT_TILT_CONFIG.smoothingFactor, 0.35);
  assert.equal(DEFAULT_TILT_CONFIG.rearmSamples, 2);
  assert.equal(DEFAULT_TILT_CONFIG.rearmUsingRawAngle, undefined);
  let state = createTiltDetectorState(0);
  for (let sample = 0; sample < 12; sample += 1) state = updateTiltDetector(state, 1.3).state;
  assert.equal(updateTiltDetector(state, 0).rearmed, false);
});

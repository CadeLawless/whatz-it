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

test('Android filter response is independent of delivered sampling frequency', () => {
  const config = { ...ANDROID_TILT_CONFIG, baselineAdjustmentFactor: 0 };
  const sample = (dt: number) => {
    let state = createTiltDetectorState(0);
    for (let elapsed = 0; elapsed < 200; elapsed += dt) {
      state = updateTiltDetector(state, 0.8, config, false, dt).state;
    }
    return state.filteredAngle!;
  };
  assert.ok(Math.abs(sample(10) - sample(50)) < 1e-10);
  assert.ok(Math.abs(sample(25) - sample(50)) < 1e-10);
});

test('Android confirms two distinct raw samples without an additional dwell timer', () => {
  const config = { ...ANDROID_TILT_CONFIG, smoothingFactor: 1, baselineAdjustmentFactor: 0 };
  const first = updateTiltDetector(createTiltDetectorState(0), 0.6, config, true, 16);
  assert.equal(first.action, null);
  assert.equal(updateTiltDetector(first.state, 0.6, config, true, 16).action, 'correct');
});

test('brief neutral crossing between old 50 ms samples advances and allows a rapid opposite gesture', () => {
  let state = createTiltDetectorState(0);
  for (let i = 0; i < 30; i++) state = updateTiltDetector(state, 1, ANDROID_TILT_CONFIG, true, 16).state;
  assert.equal(state.armed, false);
  const center = updateTiltDetector(state, 0, ANDROID_TILT_CONFIG, false, 16);
  assert.equal(center.rearmed, true);
  assert.equal(center.state.filteredAngle, 0);
  state = center.state;
  let actions = 0;
  for (let i = 0; i < 30; i++) {
    const result = updateTiltDetector(state, -1, ANDROID_TILT_CONFIG, true, 16);
    if (result.action) { assert.equal(result.action, 'passed'); actions++; }
    state = result.state;
  }
  assert.equal(actions, 1);
});

test('faster sampling does not shorten Android fallback calibration to sixteen frames', () => {
  let state = createTiltDetectorState();
  for (let i = 0; i < 49; i++) {
    const result = updateTiltDetector(state, 0, ANDROID_TILT_CONFIG, false, 16);
    assert.equal(result.calibrated, false);
    state = result.state;
  }
  assert.equal(updateTiltDetector(state, 0, ANDROID_TILT_CONFIG, false, 16).calibrated, true);
});

test('Android single-frame spike at the faster cadence cannot score on its filter tail', () => {
  let state = updateTiltDetector(createTiltDetectorState(0), 1.5, ANDROID_TILT_CONFIG, true, 16).state;
  for (let i = 0; i < 20; i++) {
    const result = updateTiltDetector(state, 0, ANDROID_TILT_CONFIG, true, 16);
    assert.equal(result.action, null);
    state = result.state;
  }
});

const trajectories = {
  'fast 45 degree tilt': [0, 0.2, 0.5, 0.78, 0.78, 0.5, 0.2, 0],
  'fast 69 degree tilt with immediate return': [0, 0.3, 0.7, 1.2, 1.2, 1.2, 1.2, 1.2, 0, 0],
  'very fast deep tilt': [0, 0.65, 1.2, 0, 0],
  'shallow intentional tilt': [0, 0.1, 0.25, 0.4, 0.49, 0.52, 0.50, 0.25, 0],
  'slow intentional tilt': [...Array.from({ length: 21 }, (_, i) => i * 0.04), 0.4, 0],
};

for (const [name, angles] of Object.entries(trajectories)) {
  for (const direction of [1, -1]) {
    test(`${name}, direction ${direction}: answer occurs on outward tilt before neutral`, () => {
      let state = createTiltDetectorState(0);
      const calls: number[] = [];
      angles.forEach((angle, i) => {
        const result = updateTiltDetector(state, direction * angle, ANDROID_TILT_CONFIG, true, 16);
        state = result.state;
        if (result.action) {
          assert.equal(result.action, direction === 1 ? 'correct' : 'passed');
          assert.ok(angle >= 0.48, 'never accept a stale filter tail after return');
          assert.ok(angle >= angles[i - 1], 'accept while moving outward');
          calls.push(i);
        }
      });
      assert.equal(calls.length, 1);
      const peak = angles.indexOf(Math.max(...angles));
      assert.ok(calls[0] < angles.findIndex((angle, i) => i > peak && angle < 0.3));
    });
  }
}

test('100 rapid alternating cards are accepted before their neutral-return sample', () => {
  let state = createTiltDetectorState(0);
  for (let i = 0; i < 100; i++) {
    const direction = i % 2 ? -1 : 1;
    const first = updateTiltDetector(state, direction * 0.65, ANDROID_TILT_CONFIG, true, 16);
    assert.equal(first.action, null);
    const second = updateTiltDetector(first.state, direction * 1.1, ANDROID_TILT_CONFIG, true, 16);
    assert.equal(second.action, direction === 1 ? 'correct' : 'passed');
    const neutral = updateTiltDetector(second.state, 0, ANDROID_TILT_CONFIG, false, 16);
    assert.equal(neutral.action, null);
    assert.equal(neutral.rearmed, true);
    state = neutral.state;
  }
});

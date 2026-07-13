import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialRoundState, roundReducer } from './game-reducer';
import { clampRoundDuration, formatRoundClock } from './round-duration';
import { shuffle } from './shuffle';
import {
  createTiltDetectorState,
  isForeheadPosition,
  normalizeLandscapeTilt,
  unwrapTiltAngle,
  updateTiltDetector,
} from './tilt-detector';

describe('roundReducer', () => {
  it('configures and starts a timed round', () => {
    const configured = roundReducer(initialRoundState, {
      type: 'CONFIGURE',
      deckId: 'animals',
      durationSeconds: 90,
      cardOrder: ['one', 'two'],
    });
    const started = roundReducer(configured, { type: 'START', now: 1_000 });

    assert.equal(configured.status, 'ready');
    assert.equal(started.status, 'playing');
    assert.equal(started.endsAt, 91_000);
  });

  it('records only one result until feedback advances', () => {
    const playing = {
      ...initialRoundState,
      status: 'playing' as const,
      deckId: 'animals',
      cardOrder: ['one', 'two'],
    };
    const answered = roundReducer(playing, { type: 'ANSWER', outcome: 'correct', now: 2_000 });
    const duplicate = roundReducer(answered, { type: 'ANSWER', outcome: 'passed', now: 2_100 });
    const advanced = roundReducer(duplicate, { type: 'ADVANCE' });

    assert.equal(answered.status, 'feedback');
    assert.equal(duplicate.results.length, 1);
    assert.equal(advanced.status, 'playing');
    assert.equal(advanced.currentCardIndex, 1);
  });

  it('finishes after answering the final card', () => {
    const playing = {
      ...initialRoundState,
      status: 'playing' as const,
      deckId: 'animals',
      cardOrder: ['only-card'],
    };
    const answered = roundReducer(playing, { type: 'ANSWER', outcome: 'passed', now: 3_000 });
    const finished = roundReducer(answered, { type: 'ADVANCE' });

    assert.equal(finished.status, 'finished');
    assert.equal(finished.results[0].outcome, 'passed');
  });

  it('ignores repeated finish actions', () => {
    const ready = { ...initialRoundState, status: 'ready' as const };
    const finished = roundReducer(ready, { type: 'FINISH' });
    assert.strictEqual(roundReducer(finished, { type: 'FINISH' }), finished);
  });
});

describe('shuffle', () => {
  it('does not mutate the source and preserves all cards', () => {
    const source = ['one', 'two', 'three'];
    const shuffled = shuffle(source, () => 0);

    assert.deepEqual(source, ['one', 'two', 'three']);
    assert.deepEqual([...shuffled].sort(), [...source].sort());
    assert.notStrictEqual(shuffled, source);
  });
});

describe('round duration', () => {
  it('never allows a duration above five minutes', () => {
    assert.equal(clampRoundDuration(301), 300);
    assert.equal(clampRoundDuration(9_999), 300);
  });

  it('never allows a duration below 30 seconds', () => {
    assert.equal(clampRoundDuration(29), 30);
  });

  it('formats gameplay time as minutes and seconds', () => {
    assert.equal(formatRoundClock(300), '5:00');
    assert.equal(formatRoundClock(90), '1:30');
    assert.equal(formatRoundClock(9), '0:09');
    assert.equal(formatRoundClock(0), '0:00');
  });
});

describe('tilt detector', () => {
  const config = {
    calibrationSamples: 2,
    calibrationMovementTolerance: 1,
    smoothingFactor: 1,
    triggerAngle: 0.6,
    confirmationSamples: 1,
    neutralAngle: 0.2,
    rearmSamples: 1,
    baselineAdjustmentFactor: 0,
  };

  it('calibrates before accepting a tilt', () => {
    const first = updateTiltDetector(createTiltDetectorState(), 0.1, config);
    const second = updateTiltDetector(first.state, 0.1, config);

    assert.equal(first.calibrated, false);
    assert.equal(second.calibrated, true);
    assert.equal(second.state.baseline, 0.1);
  });

  it('emits one action and requires a return to neutral', () => {
    let result = updateTiltDetector(createTiltDetectorState(), 0, config);
    result = updateTiltDetector(result.state, 0, config);
    result = updateTiltDetector(result.state, 0.7, config);
    assert.equal(result.action, 'correct');

    result = updateTiltDetector(result.state, 0.8, config);
    assert.equal(result.action, null);
    assert.equal(result.state.armed, false);

    result = updateTiltDetector(result.state, 0.1, config);
    assert.equal(result.state.armed, true);
    assert.equal(result.rearmed, true);
    result = updateTiltDetector(result.state, -0.7, config);
    assert.equal(result.action, 'passed');
  });

  it('keeps feedback visible until enough neutral samples rearm the detector', () => {
    const stableConfig = { ...config, rearmSamples: 3 };
    let result = updateTiltDetector(createTiltDetectorState(), 0, stableConfig);
    result = updateTiltDetector(result.state, 0, stableConfig);
    result = updateTiltDetector(result.state, 0.7, stableConfig);
    assert.equal(result.action, 'correct');

    result = updateTiltDetector(result.state, 0, stableConfig, false);
    assert.equal(result.rearmed, false);
    result = updateTiltDetector(result.state, 0, stableConfig, false);
    assert.equal(result.rearmed, false);
    result = updateTiltDetector(result.state, 0, stableConfig, false);
    assert.equal(result.rearmed, true);
    assert.equal(result.state.armed, true);
  });

  it('normalizes left-landscape readings', () => {
    assert.equal(normalizeLandscapeTilt(0.5, 90), 0.5);
    assert.equal(normalizeLandscapeTilt(0.5, -90), -0.5);
    assert.equal(normalizeLandscapeTilt(0.5, 0), null);
  });

  it('unwraps the gamma discontinuity without reversing the gesture', () => {
    const beforeBoundary = Math.PI / 2 - 0.04;
    const afterBoundary = -Math.PI / 2 + 0.04;
    const unwrapped = unwrapTiltAngle(afterBoundary, beforeBoundary, beforeBoundary);

    assert.ok(unwrapped > beforeBoundary);
    assert.ok(Math.abs(unwrapped - (beforeBoundary + 0.08)) < 0.001);
  });

  it('does not consume a return movement while feedback blocks input', () => {
    let result = updateTiltDetector(createTiltDetectorState(), 0, config, false);
    result = updateTiltDetector(result.state, 0, config, false);
    result = updateTiltDetector(result.state, -0.8, config, false);

    assert.equal(result.action, null);
    assert.equal(result.state.armed, true);
    assert.equal(result.state.candidateAction, null);
  });

  it('confirms a direction across multiple samples before acting', () => {
    const confirmedConfig = { ...config, confirmationSamples: 2 };
    let result = updateTiltDetector(createTiltDetectorState(), 0, confirmedConfig);
    result = updateTiltDetector(result.state, 0, confirmedConfig);
    result = updateTiltDetector(result.state, 0.7, confirmedConfig);
    assert.equal(result.action, null);

    result = updateTiltDetector(result.state, 0.72, confirmedConfig);
    assert.equal(result.action, 'correct');
  });

  it('recognizes a landscape phone held vertically against the forehead', () => {
    assert.equal(isForeheadPosition({ x: 9.2, y: 0.4, z: 1.1 }, 90), true);
    assert.equal(isForeheadPosition({ x: -9.2, y: 0.4, z: 1.1 }, -90), true);
    assert.equal(isForeheadPosition({ x: 0.2, y: 9.2, z: 1.1 }, 0), false);
    assert.equal(isForeheadPosition({ x: 1.0, y: 0.3, z: 9.4 }, 90), false);
  });
});

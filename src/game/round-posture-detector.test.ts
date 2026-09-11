import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyRoundPosture,
  createRoundPostureDetectorState,
  updateRoundPostureDetector,
} from './round-posture-detector';

describe('round posture detector', () => {
  it('separates upright portrait from forehead landscape', () => {
    assert.equal(classifyRoundPosture({ x: 0.5, y: 9.5, z: 1 }), 'portrait');
    assert.equal(
      classifyRoundPosture({ x: 0.8, y: 5, z: 8.3 }),
      'portrait',
      'a naturally face-up hand-held phone is still portrait',
    );
    assert.equal(classifyRoundPosture({ x: 9.2, y: 0.4, z: 1.5 }), 'landscape');
    assert.equal(classifyRoundPosture({ x: 0.2, y: 0.4, z: 9.7 }), 'other');
    assert.equal(classifyRoundPosture({ x: 0.3, y: 2.5, z: 9.4 }), 'other');
  });

  it('does not classify ordinary Correct or Pass tilts as portrait', () => {
    for (const gravity of [
      { x: 9.2, y: 0.3, z: 0.8 },
      { x: 7.8, y: 0.5, z: 4.8 },
      { x: 6.7, y: 0.6, z: 6.4 },
      { x: 5.2, y: 0.4, z: 8.1 },
      { x: 8.1, y: 0.5, z: 4.1 },
    ]) {
      assert.notEqual(classifyRoundPosture(gravity), 'portrait');
    }
  });

  it('requires a sustained portrait hold before changing posture', () => {
    let state = createRoundPostureDetectorState();
    for (let elapsed = 0; elapsed < 300; elapsed += 50) {
      const result = updateRoundPostureDetector(state, { x: 0.4, y: 9.5, z: 1 }, 50);
      state = result.state;
      assert.equal(result.changed, false);
    }
    const confirmed = updateRoundPostureDetector(state, { x: 0.4, y: 9.5, z: 1 }, 50);
    assert.equal(confirmed.changed, true);
    assert.equal(confirmed.state.posture, 'portrait');
  });

  it('resets a brief portrait candidate when normal play returns', () => {
    let state = createRoundPostureDetectorState();
    for (let elapsed = 0; elapsed < 250; elapsed += 50) {
      state = updateRoundPostureDetector(state, { x: 0.5, y: 9.4, z: 1 }, 50).state;
    }
    state = updateRoundPostureDetector(state, { x: 9.3, y: 0.4, z: 1 }, 50).state;
    assert.equal(state.posture, 'landscape');
    assert.equal(state.candidate, null);
    assert.equal(state.candidateDurationMs, 0);
  });

  it('uses a longer confirmation when returning to the forehead', () => {
    let state = createRoundPostureDetectorState('portrait');
    for (let elapsed = 0; elapsed < 600; elapsed += 50) {
      const result = updateRoundPostureDetector(state, { x: 9.3, y: 0.4, z: 1 }, 50);
      state = result.state;
      assert.equal(result.changed, false);
    }
    const confirmed = updateRoundPostureDetector(state, { x: 9.3, y: 0.4, z: 1 }, 50);
    assert.equal(confirmed.changed, true);
    assert.equal(confirmed.state.posture, 'landscape');
  });
});

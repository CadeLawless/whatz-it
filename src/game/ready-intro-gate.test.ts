import assert from 'node:assert/strict';
import test from 'node:test';

import { canStartReadyIntro, type ReadyIntroGateState } from './ready-intro-gate';

const ready: ReadyIntroGateState = {
  appActive: true,
  audioStartupGraceComplete: true,
  introStarted: false,
  isLeaving: false,
  orientationSettled: true,
  positionReady: true,
  recordingPrepared: true,
};

test('starts after the bounded audio grace without requiring audio readiness', () => {
  assert.equal(canStartReadyIntro(ready), true);
});

test('waits only while the bounded audio startup grace is active', () => {
  assert.equal(canStartReadyIntro({ ...ready, audioStartupGraceComplete: false }), false);
});

test('continues to enforce the non-audio round gates', () => {
  assert.equal(canStartReadyIntro({ ...ready, positionReady: false }), false);
  assert.equal(canStartReadyIntro({ ...ready, recordingPrepared: false }), false);
  assert.equal(canStartReadyIntro({ ...ready, introStarted: true }), false);
});

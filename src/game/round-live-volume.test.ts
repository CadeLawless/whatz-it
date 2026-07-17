import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  getRoundLiveVolumeScale,
  isRoundLiveVolumeControlActive,
  setInitialRoundSessionVolume,
  startRoundLiveVolumeControl,
  stopRoundLiveVolumeControl,
} from '../video/round-live-volume';

describe('round live volume control', () => {
  afterEach(stopRoundLiveVolumeControl);

  it('mutes a recording session when media volume was zero before the switch', () => {
    startRoundLiveVolumeControl(0);
    setInitialRoundSessionVolume(0.5);

    assert.equal(getRoundLiveVolumeScale(0.5), 0);
  });

  it('compensates for a louder recording-session volume', () => {
    startRoundLiveVolumeControl(0.25);
    setInitialRoundSessionVolume(0.5);

    assert.equal(getRoundLiveVolumeScale(0.5), 0.5);
  });

  it('keeps compensation stable while the user changes recording-session volume', () => {
    startRoundLiveVolumeControl(0.25);
    setInitialRoundSessionVolume(0.5);

    assert.equal(getRoundLiveVolumeScale(0.375), 0.5);
  });

  it('unmutes a pre-round mute when the user raises volume during the round', () => {
    startRoundLiveVolumeControl(0);
    setInitialRoundSessionVolume(0.5);

    assert.equal(getRoundLiveVolumeScale(0.375), 0);
    assert.equal(getRoundLiveVolumeScale(0.5), 1);
  });

  it('treats the lowest communication-volume step as mute after user adjustment', () => {
    startRoundLiveVolumeControl(0.5);
    setInitialRoundSessionVolume(0.5);

    assert.equal(getRoundLiveVolumeScale(1 / 16), 0);
  });

  it('does not mute an initially quiet session when preferred media volume was audible', () => {
    startRoundLiveVolumeControl(0.5);
    setInitialRoundSessionVolume(1 / 16);

    assert.equal(getRoundLiveVolumeScale(1 / 16), 1);
  });

  it('returns to unmodified playback after the round ends', () => {
    startRoundLiveVolumeControl(0);
    setInitialRoundSessionVolume(0.5);
    stopRoundLiveVolumeControl();

    assert.equal(isRoundLiveVolumeControlActive(), false);
    assert.equal(getRoundLiveVolumeScale(0.5), 1);
  });

  it('preserves the original media preference when recording preparation repeats', () => {
    startRoundLiveVolumeControl(0);
    setInitialRoundSessionVolume(0.5);
    startRoundLiveVolumeControl(0.5);
    setInitialRoundSessionVolume(0.5);

    assert.equal(getRoundLiveVolumeScale(0.5), 0);
  });
});

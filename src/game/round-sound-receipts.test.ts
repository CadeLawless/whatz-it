import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPendingRoundSoundCue,
  finalizeRoundSoundReceipts,
} from '../video/round-sound-receipts';

describe('round sound playback receipts', () => {
  it('keeps only cues explicitly included in export', () => {
    const audible = {
      ...createPendingRoundSoundCue('1', 'correct', 1_250, 1_000),
      includeInExport: true,
      wasAudible: true,
    };
    const silent = {
      ...createPendingRoundSoundCue('2', 'pass', 1_500, 1_000),
      includeInExport: false,
      wasAudible: false,
    };
    const pending = createPendingRoundSoundCue('3', 'flip', 1_750, 1_000);

    assert.deepEqual(finalizeRoundSoundReceipts([audible, silent, pending]), {
      exportCues: [{ atMs: 250, sound: 'correct' }],
      excludedCueCount: 2,
      pendingCueCount: 1,
      requestedCueCount: 3,
    });
  });

  it('exports a clean cue even when its live playback was deliberately suppressed', () => {
    const suppressed = {
      ...createPendingRoundSoundCue('1', 'final-tick', 2_000, 1_000),
      includeInExport: true,
      wasAudible: false,
    };

    assert.deepEqual(finalizeRoundSoundReceipts([suppressed]), {
      exportCues: [{ atMs: 1_000, sound: 'final-tick' }],
      excludedCueCount: 0,
      pendingCueCount: 0,
      requestedCueCount: 1,
    });
  });

  it('anchors cue timing to the request rather than the later playback result', () => {
    assert.deepEqual(createPendingRoundSoundCue('cue', 'round-start', 5_025, 5_000), {
      atMs: 25,
      requestId: 'cue',
      sound: 'round-start',
    });
  });

  it('clamps requests made before recording start to the beginning', () => {
    assert.equal(createPendingRoundSoundCue('cue', 'get-ready', 999, 1_000).atMs, 0);
  });
});

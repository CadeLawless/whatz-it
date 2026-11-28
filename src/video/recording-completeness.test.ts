import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  recordingCompletenessLabel,
  resolveRecordingCompleteness,
} from './recording-completeness';

describe('recording completeness metadata', () => {
  it('round-trips explicit complete, incomplete, and no-recording values', () => {
    assert.equal(resolveRecordingCompleteness({ recordingCompleteness: 'complete' }, false), 'complete');
    assert.equal(resolveRecordingCompleteness({ recordingCompleteness: 'incomplete' }, true), 'incomplete');
    assert.equal(resolveRecordingCompleteness({ recordingCompleteness: 'no-recording' }, true), 'no-recording');
  });

  it('preserves the legacy interpretation based on playable media', () => {
    assert.equal(resolveRecordingCompleteness({}, true), 'complete');
    assert.equal(resolveRecordingCompleteness({}, false), 'no-recording');
  });

  it('only labels degraded and absent recordings', () => {
    assert.equal(recordingCompletenessLabel('complete'), null);
    assert.equal(recordingCompletenessLabel('incomplete'), 'Incomplete Recording');
    assert.equal(recordingCompletenessLabel('no-recording'), 'No Recording');
  });
});

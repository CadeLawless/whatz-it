export type RecordingCompleteness = 'complete' | 'incomplete' | 'no-recording';

export type RecordingCompletenessMetadata = {
  recordingCompleteness?: RecordingCompleteness;
};

export function resolveRecordingCompleteness(
  metadata: RecordingCompletenessMetadata,
  hasPlayableVideo: boolean,
): RecordingCompleteness {
  return metadata.recordingCompleteness ?? (hasPlayableVideo ? 'complete' : 'no-recording');
}

export function recordingCompletenessLabel(value: RecordingCompleteness) {
  if (value === 'incomplete') return 'Incomplete Recording';
  if (value === 'no-recording') return 'No Recording';
  return null;
}

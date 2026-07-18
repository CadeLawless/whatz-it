import type { RoundSoundId, RoundVideoSoundCue } from '@/video/round-sounds';

export type PendingRoundVideoSoundCue = RoundVideoSoundCue & {
  includeInExport?: boolean;
  requestId: string;
  wasAudible?: boolean;
};

export function finalizeRoundSoundReceipts(cues: PendingRoundVideoSoundCue[]) {
  const exportCues = cues
    .filter((cue) => cue.includeInExport === true)
    .map<RoundVideoSoundCue>(({ atMs, sound }) => ({ atMs, sound }));

  return {
    exportCues,
    excludedCueCount: cues.length - exportCues.length,
    pendingCueCount: cues.filter((cue) => cue.includeInExport === undefined).length,
    requestedCueCount: cues.length,
  };
}

export function createPendingRoundSoundCue(
  requestId: string,
  sound: RoundSoundId,
  requestedAt: number,
  recordingStartedAt: number,
): PendingRoundVideoSoundCue {
  return {
    atMs: Math.max(0, requestedAt - recordingStartedAt),
    requestId,
    sound,
  };
}

import { requireNativeModule } from 'expo-modules-core';

export type VideoOverlayEvent = {
  atMs: number;
  kind: 'countdown' | 'card' | 'correct' | 'passed' | 'times-up';
  text: string;
  byline?: string;
  timerEndsAtMs?: number;
};

export type RoundAudioCue = {
  atMs: number;
  uri: string;
  volumeScale: number;
};

export type RecordingRoundSound = {
  sound: string;
  uri: string;
};

export type RoundVideoSegment = {
  videoUri: string;
  audioUri: string | null;
};

type WhatzItVideoExportNativeModule = {
  overlayExportVersion?: number;
  getSystemOutputVolume?(): number;
  exportOverlayVideo(
    inputUri: string,
    audioUri: string | null,
    events: VideoOverlayEvent[],
  ): Promise<string>;
  exportBrandedOverlayVideo?(
    inputUri: string,
    audioUri: string | null,
    events: VideoOverlayEvent[],
    headshotUri: string | null,
    wordmarkUri: string | null,
  ): Promise<string>;
  mixRoundAudio(
    videoUri: string,
    microphoneUri: string,
    microphoneOffsetMs: number,
    cues: RoundAudioCue[],
    cueVolume: number,
  ): Promise<string>;
  stitchRoundVideoSegments?(segments: RoundVideoSegment[]): Promise<string>;
  prepareRecordingAudio(): Promise<void>;
  reassertRecordingHaptics(): Promise<boolean>;
  playRoundHaptic(cue: string, countdownValue: number | null): Promise<string>;
  playRecordingRoundSound?(sound: string, volume: number): Promise<boolean>;
  getRecordingRoundSoundPlaybackStatus?(sound: string): string;
  getMicrophoneCapturePath?(): string;
  startMicrophoneRecordingWithSounds?(sounds: RecordingRoundSound[]): Promise<string>;
  startMicrophoneRecording(): Promise<string>;
  stopMicrophoneRecording(): Promise<string>;
  cancelMicrophoneRecording(): Promise<void>;
};

const nativeModule = requireNativeModule<WhatzItVideoExportNativeModule>('WhatzItVideoExport');

export function getSystemOutputVolume() {
  const volume = nativeModule.getSystemOutputVolume?.();
  return typeof volume === 'number' && Number.isFinite(volume) ? volume : null;
}

export function getIosVideoExportVersion() {
  return nativeModule.overlayExportVersion ?? 0;
}

export function supportsFixedIosOverlayExport() {
  return getIosVideoExportVersion() >= 2;
}

export function supportsReliableIosAudioExport() {
  return getIosVideoExportVersion() >= 3;
}

export function supportsRoundAudioMix() {
  return getIosVideoExportVersion() >= 11;
}

export function exportOverlayVideo(
  inputUri: string,
  audioUri: string | null,
  events: VideoOverlayEvent[],
  headshotUri: string | null,
  wordmarkUri: string | null,
) {
  return nativeModule.exportBrandedOverlayVideo
    ? nativeModule.exportBrandedOverlayVideo(
        inputUri,
        audioUri,
        events,
        headshotUri,
        wordmarkUri,
      )
    : nativeModule.exportOverlayVideo(inputUri, audioUri, events);
}

export function mixRoundAudio(
  videoUri: string,
  microphoneUri: string,
  microphoneOffsetMs: number,
  cues: RoundAudioCue[],
  cueVolume: number,
) {
  return nativeModule.mixRoundAudio(
    videoUri,
    microphoneUri,
    microphoneOffsetMs,
    cues,
    cueVolume,
  );
}

export function stitchRoundVideoSegments(segments: RoundVideoSegment[]) {
  if (!nativeModule.stitchRoundVideoSegments) {
    return Promise.reject(new Error('This app build cannot stitch interrupted round videos.'));
  }
  return nativeModule.stitchRoundVideoSegments(segments);
}

export function prepareRecordingAudio() {
  return nativeModule.prepareRecordingAudio();
}

export function reassertRecordingHaptics() {
  return nativeModule.reassertRecordingHaptics();
}

export function playRoundHaptic(cue: string, countdownValue: number | null) {
  return nativeModule.playRoundHaptic(cue, countdownValue);
}

export function playRecordingRoundSound(sound: string, volume: number) {
  return nativeModule.playRecordingRoundSound?.(sound, volume) ?? Promise.resolve(false);
}

export function getRecordingRoundSoundPlaybackStatus(sound: string) {
  return nativeModule.getRecordingRoundSoundPlaybackStatus?.(sound) ?? 'unsupported';
}

export function getMicrophoneCapturePath() {
  return nativeModule.getMicrophoneCapturePath?.() ?? 'unsupported';
}

export function supportsRecordingRoundSoundPlayback() {
  return (
    typeof nativeModule.playRecordingRoundSound === 'function' &&
    typeof nativeModule.startMicrophoneRecordingWithSounds === 'function'
  );
}

export function startMicrophoneRecording(sounds: RecordingRoundSound[] = []) {
  if (nativeModule.startMicrophoneRecordingWithSounds) {
    return nativeModule.startMicrophoneRecordingWithSounds(sounds);
  }
  return nativeModule.startMicrophoneRecording();
}

export function stopMicrophoneRecording() {
  return nativeModule.stopMicrophoneRecording();
}

export function cancelMicrophoneRecording() {
  return nativeModule.cancelMicrophoneRecording();
}

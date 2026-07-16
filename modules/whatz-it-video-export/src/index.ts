import { requireNativeModule } from 'expo-modules-core';

export type VideoOverlayEvent = {
  atMs: number;
  kind: 'countdown' | 'card' | 'correct' | 'passed' | 'times-up';
  text: string;
  timerEndsAtMs?: number;
};

export type RoundAudioCue = {
  atMs: number;
  uri: string;
};

export type RoundVideoSegment = {
  videoUri: string;
  audioUri: string | null;
};

type WhatzItVideoExportNativeModule = {
  overlayExportVersion?: number;
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
  startMicrophoneRecording(): Promise<string>;
  stopMicrophoneRecording(): Promise<string>;
  cancelMicrophoneRecording(): Promise<void>;
  probeSilentSwitch(): Promise<boolean>;
  prepareSystemSound(inputUri: string): Promise<void>;
  playSystemSound(inputUri: string): Promise<void>;
  stopSystemSound(inputUri: string): Promise<void>;
  beginOrientationScreenshotShield?(snapshotUri: string | null): Promise<boolean>;
  finishOrientationScreenshotShield?(): Promise<boolean>;
};

const nativeModule = requireNativeModule<WhatzItVideoExportNativeModule>('WhatzItVideoExport');

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

export function supportsSilentAwareSystemSounds() {
  return getIosVideoExportVersion() >= 13;
}

export function supportsSilentSwitchMonitoring() {
  return getIosVideoExportVersion() >= 14;
}

export function supportsOrientationScreenshotShield() {
  return getIosVideoExportVersion() >= 16 && !!nativeModule.beginOrientationScreenshotShield;
}

export function beginOrientationScreenshotShield(snapshotUri: string | null) {
  return nativeModule.beginOrientationScreenshotShield?.(snapshotUri) ?? Promise.resolve(false);
}

export function finishOrientationScreenshotShield() {
  return nativeModule.finishOrientationScreenshotShield?.() ?? Promise.resolve(false);
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

export function startMicrophoneRecording() {
  return nativeModule.startMicrophoneRecording();
}

export function stopMicrophoneRecording() {
  return nativeModule.stopMicrophoneRecording();
}

export function cancelMicrophoneRecording() {
  return nativeModule.cancelMicrophoneRecording();
}

export function probeSilentSwitch() {
  return nativeModule.probeSilentSwitch();
}

export function playSystemSound(inputUri: string) {
  return nativeModule.playSystemSound(inputUri);
}

export function prepareSystemSound(inputUri: string) {
  return nativeModule.prepareSystemSound(inputUri);
}

export function stopSystemSound(inputUri: string) {
  return nativeModule.stopSystemSound(inputUri);
}

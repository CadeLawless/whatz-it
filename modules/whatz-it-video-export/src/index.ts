import { requireNativeModule } from 'expo-modules-core';

export type VideoOverlayEvent = {
  atMs: number;
  kind: 'countdown' | 'card' | 'correct' | 'passed' | 'times-up';
  text: string;
};

export type RoundAudioCue = {
  atMs: number;
  uri: string;
};

type WhatzItVideoExportNativeModule = {
  exportOverlayVideo(
    inputUri: string,
    audioUri: string | null,
    events: VideoOverlayEvent[],
  ): Promise<string>;
  mixRoundAudio(
    videoUri: string,
    microphoneUri: string,
    microphoneOffsetMs: number,
    cues: RoundAudioCue[],
  ): Promise<string>;
  prepareRecordingAudio(): Promise<void>;
  startMicrophoneRecording(): Promise<string>;
  stopMicrophoneRecording(): Promise<string>;
  cancelMicrophoneRecording(): Promise<void>;
  playSystemSound(inputUri: string): Promise<void>;
};

const nativeModule = requireNativeModule<WhatzItVideoExportNativeModule>('WhatzItVideoExport');

export function exportOverlayVideo(
  inputUri: string,
  audioUri: string | null,
  events: VideoOverlayEvent[],
) {
  return nativeModule.exportOverlayVideo(inputUri, audioUri, events);
}

export function mixRoundAudio(
  videoUri: string,
  microphoneUri: string,
  microphoneOffsetMs: number,
  cues: RoundAudioCue[],
) {
  return nativeModule.mixRoundAudio(videoUri, microphoneUri, microphoneOffsetMs, cues);
}

export function prepareRecordingAudio() {
  return nativeModule.prepareRecordingAudio();
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

export function playSystemSound(inputUri: string) {
  return nativeModule.playSystemSound(inputUri);
}

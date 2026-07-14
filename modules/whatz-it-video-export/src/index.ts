import { requireNativeModule } from 'expo-modules-core';

export type VideoOverlayEvent = {
  atMs: number;
  kind: 'countdown' | 'card' | 'correct' | 'passed' | 'times-up';
  text: string;
};

type WhatzItVideoExportNativeModule = {
  exportOverlayVideo(inputUri: string, events: VideoOverlayEvent[]): Promise<string>;
  prepareRecordingAudio(): Promise<void>;
};

const nativeModule = requireNativeModule<WhatzItVideoExportNativeModule>('WhatzItVideoExport');

export function exportOverlayVideo(inputUri: string, events: VideoOverlayEvent[]) {
  return nativeModule.exportOverlayVideo(inputUri, events);
}

export function prepareRecordingAudio() {
  return nativeModule.prepareRecordingAudio();
}

import type { HybridObject } from 'react-native-nitro-modules';
import type { CameraOutput } from 'react-native-vision-camera';

export type LiveOverlayEvent = {
  atMs: number;
  kind: string;
  text: string;
  byline?: string;
  timerEndsAtMs?: number;
};

export type LiveOverlayRecordingResult = {
  uri: string;
  durationMs: number;
  encodedFrameCount: number;
  droppedFrameCount: number;
  width: number;
  height: number;
};

export interface LiveOverlayOutputFactory
  extends HybridObject<{ ios: 'swift' }> {
  readonly isRecording: boolean;
  createLiveOverlayOutput(): CameraOutput;
  startRecording(headshotPath?: string, wordmarkPath?: string): Promise<void>;
  appendOverlayEvent(event: LiveOverlayEvent): void;
  stopRecording(): Promise<LiveOverlayRecordingResult>;
  cancelRecording(): Promise<void>;
}

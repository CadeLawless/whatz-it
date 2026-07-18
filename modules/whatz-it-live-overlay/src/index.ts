import { NitroModules } from 'react-native-nitro-modules';
import type { CameraOutput } from 'react-native-vision-camera';

import type {
  LiveOverlayOutputFactory,
} from './specs/LiveOverlayOutput.nitro';

export type {
  LiveOverlayEvent,
  LiveOverlayRecordingResult,
} from './specs/LiveOverlayOutput.nitro';
import type {
  LiveOverlayEvent,
  LiveOverlayRecordingResult,
} from './specs/LiveOverlayOutput.nitro';

export type LiveOverlayOutput = {
  cameraOutput: CameraOutput;
  readonly isRecording: boolean;
  startRecording(headshotPath?: string, wordmarkPath?: string): Promise<void>;
  appendOverlayEvent(event: LiveOverlayEvent): void;
  stopRecording(): Promise<LiveOverlayRecordingResult>;
  cancelRecording(): Promise<void>;
};

let factory: LiveOverlayOutputFactory | null = null;

export function createLiveOverlayOutput(): LiveOverlayOutput {
  factory ??= NitroModules.createHybridObject<LiveOverlayOutputFactory>(
    'LiveOverlayOutputFactory',
  );
  const activeFactory = factory;
  const cameraOutput = activeFactory.createLiveOverlayOutput();
  return {
    cameraOutput,
    get isRecording() {
      return activeFactory.isRecording;
    },
    startRecording: (headshotPath, wordmarkPath) =>
      activeFactory.startRecording(headshotPath, wordmarkPath),
    appendOverlayEvent: (event) => activeFactory.appendOverlayEvent(event),
    stopRecording: () => activeFactory.stopRecording(),
    cancelRecording: () => activeFactory.cancelRecording(),
  };
}

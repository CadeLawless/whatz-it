import { setAudioModeAsync } from 'expo-audio';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import {
  Camera,
  type Recorder,
  VisionCamera,
  useCameraDevice,
  useVideoOutput,
} from 'react-native-vision-camera';

export type RoundCameraRef = {
  startRecording: (maxDuration: number) => Promise<boolean>;
  stopRecording: () => Promise<string | null>;
  cancelRecording: () => Promise<void>;
};

type RoundCameraProps = {
  enabled: boolean;
  onError: () => void;
  onReady: () => void;
};

export async function requestRoundCameraPermissions() {
  const cameraGranted =
    VisionCamera.cameraPermissionStatus === 'authorized' ||
    (await VisionCamera.requestCameraPermission());
  if (!cameraGranted) return false;

  const microphoneGranted =
    VisionCamera.microphonePermissionStatus === 'authorized' ||
    (await VisionCamera.requestMicrophonePermission());
  if (!microphoneGranted) return false;

  await setAudioModeAsync({
    allowsRecording: true,
    interruptionMode: 'doNotMix',
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
  });
  if (Platform.OS === 'ios') {
    try {
      const { prepareRecordingAudio } = await import('whatz-it-video-export');
      await prepareRecordingAudio();
    } catch {
      // Older development builds do not yet contain the native audio-session helper.
    }
  }
  return true;
}

export const RoundCamera = forwardRef<RoundCameraRef, RoundCameraProps>(
  function RoundCamera({ enabled, onError, onReady }, ref) {
    const device = useCameraDevice('front');
    const videoOutput = useVideoOutput({ enableAudio: true, fileType: 'mp4' });
    const recorderRef = useRef<Recorder | null>(null);
    const resultPromiseRef = useRef<Promise<string> | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        async startRecording(maxDuration) {
          if (!enabled || !device || recorderRef.current) return false;
          try {
            const recorder = await videoOutput.createRecorder({ maxDuration });
            recorderRef.current = recorder;
            let finishRecording!: (filePath: string) => void;
            let failRecording!: (error: Error) => void;
            resultPromiseRef.current = new Promise<string>((resolve, reject) => {
              finishRecording = (filePath) => resolve(toFileUri(filePath));
              failRecording = reject;
            });
            void resultPromiseRef.current.catch(() => undefined);
            await recorder.startRecording(finishRecording, failRecording);
            return true;
          } catch {
            recorderRef.current = null;
            resultPromiseRef.current = null;
            return false;
          }
        },
        async stopRecording() {
          const recorder = recorderRef.current;
          const result = resultPromiseRef.current;
          if (!recorder || !result) return null;
          try {
            if (recorder.isRecording) await recorder.stopRecording();
            return await result;
          } finally {
            recorderRef.current = null;
            resultPromiseRef.current = null;
          }
        },
        async cancelRecording() {
          const recorder = recorderRef.current;
          try {
            if (recorder) await recorder.cancelRecording();
          } finally {
            recorderRef.current = null;
            resultPromiseRef.current = null;
          }
        },
      }),
      [device, enabled, videoOutput],
    );

    if (!enabled || !device) return null;
    return (
      <Camera
        device={device}
        isActive
        mirrorMode="on"
        onError={onError}
        onStarted={onReady}
        outputs={[videoOutput]}
        pointerEvents="none"
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
    );
  },
);

function toFileUri(path: string) {
  return path.startsWith('file://') ? path : `file://${path}`;
}

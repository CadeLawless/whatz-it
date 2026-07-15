import { RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import {
  Camera,
  type Recorder,
  VisionCamera,
  useCameraDevice,
  useVideoOutput,
} from 'react-native-vision-camera';

export type RoundCameraRef = {
  startRecording: (maxDuration: number) => Promise<number | null>;
  stopRecording: () => Promise<RoundCapture | null>;
  cancelRecording: () => Promise<void>;
};

export type RoundCapture = {
  videoUri: string;
  microphoneUri?: string;
  microphoneOffsetMs: number;
};

type RoundCameraProps = {
  enabled: boolean;
  microphoneEnabled: boolean;
  onError: (error: unknown) => void;
  onReady: () => void;
};

export async function requestRoundCameraPermissions() {
  const cameraGranted =
    VisionCamera.cameraPermissionStatus === 'authorized' ||
    (await VisionCamera.requestCameraPermission());
  if (!cameraGranted) return { cameraGranted: false, microphoneGranted: false };

  const microphoneGranted =
    VisionCamera.microphonePermissionStatus === 'authorized' ||
    (await VisionCamera.requestMicrophonePermission());
  return { cameraGranted: true, microphoneGranted };
}

async function prepareRoundRecordingAudio() {
  await setAudioModeAsync({
    allowsRecording: true,
    interruptionMode: 'doNotMix',
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
  });
}

export const RoundCamera = forwardRef<RoundCameraRef, RoundCameraProps>(
  function RoundCamera({ enabled, microphoneEnabled, onError, onReady }, ref) {
    const device = useCameraDevice('front');
    const microphoneRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const videoOutput = useVideoOutput({
      // iOS microphone audio is recorded independently by expo-audio.
      // This avoids VisionCamera's intermittently missing iOS audio track.
      enableAudio: microphoneEnabled && Platform.OS !== 'ios',
      fileType: 'mp4',
    });
    const recorderRef = useRef<Recorder | null>(null);
    const resultPromiseRef = useRef<Promise<string> | null>(null);
    const microphoneRef = useRef<{ offsetMs: number } | null>(null);
    const microphonePreparedRef = useRef(false);

    const prepareMicrophone = useCallback(async () => {
      if (Platform.OS !== 'ios' || !microphoneEnabled) return microphoneEnabled;
      if (microphonePreparedRef.current) return true;
      try {
        await prepareRoundRecordingAudio();
        if (!microphoneRecorder.getStatus().canRecord) {
          await microphoneRecorder.prepareToRecordAsync();
        }
        microphonePreparedRef.current = true;
        return true;
      } catch (error) {
        console.warn('Microphone preparation failed; recording video without audio.', error);
        return false;
      }
    }, [microphoneEnabled, microphoneRecorder]);

    useImperativeHandle(
      ref,
      () => ({
        async startRecording(maxDuration) {
          if (!enabled || !device || recorderRef.current) return null;
          let recorder: Recorder | null = null;
          try {
            let microphonePrepared = await prepareMicrophone();
            if (microphonePrepared && Platform.OS !== 'ios') {
              try {
                await prepareRoundRecordingAudio();
              } catch (error) {
                microphonePrepared = false;
                console.warn('Microphone setup failed; recording video without audio.', error);
              }
            }
            recorder = await videoOutput.createRecorder({ maxDuration });
            recorderRef.current = recorder;
            let finishRecording!: (filePath: string) => void;
            let failRecording!: (error: Error) => void;
            resultPromiseRef.current = new Promise<string>((resolve, reject) => {
              finishRecording = (filePath) => resolve(toFileUri(filePath));
              failRecording = reject;
            });
            void resultPromiseRef.current.catch(() => undefined);
            await recorder.startRecording(finishRecording, failRecording);
            const videoStartedAt = Date.now();
            if (Platform.OS === 'ios' && microphonePrepared) {
              try {
                microphoneRecorder.record();
                microphoneRef.current = {
                  offsetMs: Math.max(0, Date.now() - videoStartedAt),
                };
              } catch (error) {
                // A microphone failure must not discard an otherwise valid video.
                console.warn('Microphone recording failed; continuing with video only.', error);
              }
            }
            return videoStartedAt;
          } catch (error) {
            console.warn('Video recording failed to start.', error);
            try {
              if (recorder?.isRecording) await recorder.cancelRecording();
            } catch {
              // The recorder may already have stopped while cleaning up a failed start.
            }
            if (Platform.OS === 'ios' && microphoneRecorder.isRecording) {
              try {
                await microphoneRecorder.stop();
              } catch {
                // There may be no microphone recorder to stop.
              }
            }
            recorderRef.current = null;
            resultPromiseRef.current = null;
            microphoneRef.current = null;
            microphonePreparedRef.current = false;
            return null;
          }
        },
        async stopRecording() {
          const recorder = recorderRef.current;
          const result = resultPromiseRef.current;
          if (!recorder || !result) return null;
          try {
            if (recorder.isRecording) await recorder.stopRecording();
            let microphoneUri: string | undefined;
            if (Platform.OS === 'ios' && microphoneRef.current) {
              await microphoneRecorder.stop();
              microphoneUri = microphoneRecorder.uri ?? undefined;
            }
            return {
              videoUri: await result,
              microphoneUri,
              microphoneOffsetMs: microphoneRef.current?.offsetMs ?? 0,
            };
          } finally {
            recorderRef.current = null;
            resultPromiseRef.current = null;
            microphoneRef.current = null;
            microphonePreparedRef.current = false;
          }
        },
        async cancelRecording() {
          const recorder = recorderRef.current;
          try {
            if (recorder) await recorder.cancelRecording();
          } catch {
            // Continue so the independently recorded microphone file is also removed.
          }
          try {
            if (Platform.OS === 'ios' && microphoneRecorder.isRecording) {
              await microphoneRecorder.stop();
              const microphoneUri = microphoneRecorder.uri;
              if (microphoneUri) {
                const { File } = await import('expo-file-system');
                const file = new File(microphoneUri);
                if (file.exists) file.delete();
              }
            }
          } catch {
            // There may be no native microphone recorder left to cancel.
          } finally {
            recorderRef.current = null;
            resultPromiseRef.current = null;
            microphoneRef.current = null;
            microphonePreparedRef.current = false;
          }
        },
      }),
      [device, enabled, microphoneRecorder, prepareMicrophone, videoOutput],
    );

    if (!enabled || !device) return null;
    return (
      <Camera
        device={device}
        isActive
        mirrorMode="on"
        onError={onError}
        onStarted={() => {
          // Prepare the microphone before ReadyScreen starts any countdown audio.
          void prepareMicrophone().then(() => onReady());
        }}
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

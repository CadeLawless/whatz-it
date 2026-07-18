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
import {
  prepareRecordingAudio,
  reassertRecordingHaptics,
} from 'whatz-it-video-export';

import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

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
  logVideoDiagnostic('permissions resolved', {
    cameraGranted,
    cameraStatus: VisionCamera.cameraPermissionStatus,
    microphoneGranted,
    microphoneStatus: VisionCamera.microphonePermissionStatus,
  });
  return { cameraGranted: true, microphoneGranted };
}

async function prepareRoundRecordingAudio() {
  logVideoDiagnostic('recording audio session configuration started', {
    platform: Platform.OS,
  });
  await setAudioModeAsync({
    allowsRecording: true,
    interruptionMode: 'doNotMix',
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
  });
  // Expo Audio configures playback/recording but does not expose iOS's
  // setAllowHapticsAndSystemSoundsDuringRecording. Our native module enables it
  // while preserving the play-and-record speaker session used by the round.
  await prepareRecordingAudio();
  logVideoDiagnostic('recording audio session configured with haptics enabled', {
    platform: Platform.OS,
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
    const microphoneRef = useRef<{ uri: string; offsetMs: number } | null>(null);
    const microphonePreparedRef = useRef(false);

    const prepareMicrophone = useCallback(async () => {
      if (Platform.OS !== 'ios') return microphoneEnabled;
      if (microphonePreparedRef.current) return true;
      try {
        const statusBefore = microphoneRecorder.getStatus();
        logVideoDiagnostic('microphone preparation started', { statusBefore });
        if (statusBefore.isRecording) {
          logVideoDiagnostic('stale microphone recording stopped before preparation', {
            statusBefore,
            uri: microphoneRecorder.uri,
          });
          await microphoneRecorder.stop();
        }
        await prepareRoundRecordingAudio();
        if (!microphoneEnabled) {
          logVideoDiagnostic('recording haptics prepared without microphone capture');
          return false;
        }
        if (!microphoneRecorder.getStatus().canRecord) {
          await microphoneRecorder.prepareToRecordAsync();
        }
        microphonePreparedRef.current = true;
        logVideoDiagnostic('microphone preparation completed', {
          statusAfter: microphoneRecorder.getStatus(),
          uri: microphoneRecorder.uri,
        });
        return true;
      } catch (error) {
        warnVideoDiagnostic('microphone preparation failed', error, {
          status: microphoneRecorder.getStatus(),
          uri: microphoneRecorder.uri,
        });
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
            logVideoDiagnostic('recording start requested', {
              microphoneEnabled,
              platform: Platform.OS,
            });
            let microphonePrepared = await prepareMicrophone();
            if (microphonePrepared && Platform.OS !== 'ios') {
              try {
                await prepareRoundRecordingAudio();
              } catch (error) {
                microphonePrepared = false;
                warnVideoDiagnostic('microphone setup failed; recording video without audio', error);
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
                const microphoneUri = microphoneRecorder.uri;
                const microphoneStatus = microphoneRecorder.getStatus();
                if (!microphoneStatus.isRecording || !microphoneUri) {
                  throw new Error('The prepared microphone recorder did not enter recording state.');
                }
                let recordingHapticsEnabled = false;
                try {
                  recordingHapticsEnabled = await reassertRecordingHaptics();
                } catch (error) {
                  warnVideoDiagnostic(
                    'recording haptics flag could not be reasserted; microphone recording will continue',
                    error,
                  );
                }
                microphoneRef.current = {
                  uri: microphoneUri,
                  offsetMs: Math.max(0, Date.now() - videoStartedAt),
                };
                logVideoDiagnostic('microphone recording started', {
                  offsetMs: microphoneRef.current.offsetMs,
                  recordingHapticsEnabled,
                  status: microphoneStatus,
                  uri: microphoneUri,
                });
              } catch (error) {
                // A microphone failure must not discard an otherwise valid video.
                warnVideoDiagnostic('microphone recording failed; continuing with video only', error, {
                  status: microphoneRecorder.getStatus(),
                  uri: microphoneRecorder.uri,
                });
                if (microphoneRecorder.getStatus().isRecording) {
                  try {
                    await microphoneRecorder.stop();
                  } catch {
                    // The recorder may already have stopped while cleaning up the failed start.
                  }
                }
                microphoneRef.current = null;
                microphonePreparedRef.current = false;
              }
            } else if (Platform.OS === 'ios') {
              try {
                const recordingHapticsEnabled = await reassertRecordingHaptics();
                logVideoDiagnostic('recording haptics reasserted without microphone capture', {
                  recordingHapticsEnabled,
                });
              } catch (error) {
                warnVideoDiagnostic(
                  'recording haptics could not be reasserted without microphone capture',
                  error,
                );
              }
            }
            logVideoDiagnostic('video recording started', { videoStartedAt });
            return videoStartedAt;
          } catch (error) {
            warnVideoDiagnostic('video recording failed to start', error);
            try {
              if (recorder?.isRecording) await recorder.cancelRecording();
            } catch {
              // The recorder may already have stopped while cleaning up a failed start.
            }
            if (Platform.OS === 'ios' && microphoneRecorder.getStatus().isRecording) {
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
          const stopStartedAt = Date.now();
          const recorder = recorderRef.current;
          const result = resultPromiseRef.current;
          if (!recorder || !result) return null;
          try {
            logVideoDiagnostic('recording stop requested', {
              microphoneStatus: microphoneRecorder.getStatus(),
              microphoneUri: microphoneRef.current?.uri,
              videoRecorderActive: recorder.isRecording,
            });
            if (recorder.isRecording) {
              const recorderStopStartedAt = Date.now();
              await recorder.stopRecording();
              logVideoDiagnostic('native video recorder stop command completed', {
                elapsedMs: Date.now() - recorderStopStartedAt,
              });
            }
            let microphoneUri: string | undefined;
            if (Platform.OS === 'ios') {
              const microphoneCapture = microphoneRef.current;
              try {
                const microphoneStopStartedAt = Date.now();
                if (microphoneRecorder.getStatus().isRecording) {
                  await microphoneRecorder.stop();
                }
                microphoneUri = microphoneCapture?.uri;
                logVideoDiagnostic('Expo microphone stop completed', {
                  elapsedMs: Date.now() - microphoneStopStartedAt,
                  hadMicrophoneCapture: !!microphoneCapture,
                });
              } catch (error) {
                warnVideoDiagnostic('microphone recording failed to stop cleanly', error, {
                  status: microphoneRecorder.getStatus(),
                  uri: microphoneCapture?.uri ?? microphoneRecorder.uri,
                });
              }
            }
            const recorderResultStartedAt = Date.now();
            const videoUri = await result;
            logVideoDiagnostic('native video recorder result received', {
              elapsedMs: Date.now() - recorderResultStartedAt,
            });
            const fileInspectionStartedAt = Date.now();
            const { File } = await import('expo-file-system');
            const microphoneFile = microphoneUri ? new File(microphoneUri) : null;
            const videoFile = new File(videoUri);
            logVideoDiagnostic('recording stopped', {
              microphoneFileExists: microphoneFile?.exists ?? false,
              microphoneFileSize: microphoneFile?.size ?? 0,
              microphoneStatus: microphoneRecorder.getStatus(),
              microphoneUri,
              videoFileExists: videoFile.exists,
              videoFileSize: videoFile.size,
              videoUri,
              fileInspectionElapsedMs: Date.now() - fileInspectionStartedAt,
              totalStopElapsedMs: Date.now() - stopStartedAt,
            });
            return {
              videoUri,
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
            if (Platform.OS === 'ios' && microphoneRecorder.getStatus().isRecording) {
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
      [device, enabled, microphoneEnabled, microphoneRecorder, prepareMicrophone, videoOutput],
    );

    if (!enabled || !device) return null;
    return (
      <Camera
        device={device}
        isActive
        // Toggle the recorded front-camera image from the prior behavior so it
        // has the expected left/right orientation in playback and exports.
        mirrorMode="off"
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

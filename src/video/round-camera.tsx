import { RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import {
  Camera,
  CommonResolutions,
  type Recorder,
  VisionCamera,
  useCameraDevice,
  useVideoOutput,
} from 'react-native-vision-camera';
import {
  prepareRecordingAudio,
  reassertRecordingHaptics,
} from 'whatz-it-video-export';
import {
  createLiveOverlayOutput,
  type LiveOverlayEvent,
  type LiveOverlayOutput,
  type LiveOverlayRecordingResult,
} from 'whatz-it-live-overlay';

import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

const ROUND_VIDEO_TARGET_BIT_RATE = 5_000_000;

export type RoundCameraRef = {
  startRecording: (maxDuration: number) => Promise<number | null>;
  stopRecording: () => Promise<RoundCapture | null>;
  cancelRecording: () => Promise<void>;
  recordOverlayEvent: (event: LiveOverlayEvent) => void;
};

export type RoundCapture = {
  videoUri: string;
  microphoneUri?: string;
  microphoneOffsetMs: number;
  liveOverlay?: LiveOverlayRecordingResult;
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
      // The saved round is rendered at 720p. Capturing at the same resolution
      // avoids making the exporter decode and scale 1080p frames first.
      targetResolution: CommonResolutions.HD_16_9,
      targetBitRate: ROUND_VIDEO_TARGET_BIT_RATE,
      // iOS microphone audio is recorded independently by expo-audio.
      // This avoids VisionCamera's intermittently missing iOS audio track.
      enableAudio: microphoneEnabled && Platform.OS !== 'ios',
      fileType: 'mp4',
    });
    const liveOverlayOutput = useMemo<LiveOverlayOutput | null>(() => {
      if (Platform.OS !== 'ios') return null;
      try {
        return createLiveOverlayOutput();
      } catch (error) {
        warnVideoDiagnostic('live overlay output unavailable; using standard recorder', error);
        return null;
      }
    }, []);
    const cameraOutputs = useMemo(
      // The live path replaces the normal iOS recorder. Attaching both outputs
      // makes the camera encode two 720p streams and was the main source of
      // stalls in the first prototype.
      () => (liveOverlayOutput ? [liveOverlayOutput.cameraOutput] : [videoOutput]),
      [liveOverlayOutput, videoOutput],
    );
    const recorderRef = useRef<Recorder | null>(null);
    const resultPromiseRef = useRef<Promise<string> | null>(null);
    const microphoneRef = useRef<{ uri: string; offsetMs: number } | null>(null);
    const microphonePreparedRef = useRef(false);
    const liveOverlayActiveRef = useRef(false);

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
          if (!enabled || !device || recorderRef.current || liveOverlayActiveRef.current) return null;
          let recorder: Recorder | null = null;
          try {
            logVideoDiagnostic('recording start requested', {
              captureTargetBitRate: ROUND_VIDEO_TARGET_BIT_RATE,
              liveOverlayEnabled: !!liveOverlayOutput,
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
            if (liveOverlayOutput) {
              const branding = await loadLiveOverlayBrandingUris();
              await liveOverlayOutput.startRecording(
                branding?.headshotUri ?? undefined,
                branding?.wordmarkUri ?? undefined,
              );
              liveOverlayActiveRef.current = true;
              logVideoDiagnostic('single-output live overlay recorder armed', {
                hasHeadshot: !!branding?.headshotUri,
                hasWordmark: !!branding?.wordmarkUri,
                maxDuration,
              });
            } else {
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
            }
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
            try {
              if (liveOverlayActiveRef.current && liveOverlayOutput) {
                await liveOverlayOutput.cancelRecording();
              }
            } catch {
              // The experimental recorder may not have armed before the start failure.
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
            liveOverlayActiveRef.current = false;
            return null;
          }
        },
        async stopRecording() {
          const stopStartedAt = Date.now();
          const recorder = recorderRef.current;
          const result = resultPromiseRef.current;
          const stoppingLiveOverlay = liveOverlayActiveRef.current && !!liveOverlayOutput;
          if (!stoppingLiveOverlay && (!recorder || !result)) return null;
          try {
            logVideoDiagnostic('recording stop requested', {
              liveOverlayActive: stoppingLiveOverlay,
              microphoneStatus: microphoneRecorder.getStatus(),
              microphoneUri: microphoneRef.current?.uri,
              videoRecorderActive: recorder?.isRecording ?? false,
            });
            const liveOverlayResultPromise =
              stoppingLiveOverlay && liveOverlayOutput
                ? liveOverlayOutput.stopRecording()
                : Promise.resolve(undefined);
            liveOverlayActiveRef.current = false;
            if (recorder?.isRecording) {
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
            const liveOverlay = await liveOverlayResultPromise;
            const recorderResultStartedAt = Date.now();
            const videoUri = liveOverlay?.uri ?? (result ? await result : undefined);
            if (!videoUri) {
              throw new Error('The video recorder stopped without producing a file.');
            }
            logVideoDiagnostic('native video result received', {
              elapsedMs: Date.now() - recorderResultStartedAt,
              liveOverlay,
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
              liveOverlay,
            });
            return {
              videoUri,
              microphoneUri,
              microphoneOffsetMs: microphoneRef.current?.offsetMs ?? 0,
              liveOverlay,
            };
          } finally {
            recorderRef.current = null;
            resultPromiseRef.current = null;
            microphoneRef.current = null;
            microphonePreparedRef.current = false;
            liveOverlayActiveRef.current = false;
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
            if (liveOverlayActiveRef.current && liveOverlayOutput) {
              await liveOverlayOutput.cancelRecording();
            }
          } catch {
            // The live output may already have stopped; microphone cleanup still continues.
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
            liveOverlayActiveRef.current = false;
          }
        },
        recordOverlayEvent(event) {
          if (!liveOverlayActiveRef.current || !liveOverlayOutput) return;
          try {
            liveOverlayOutput.appendOverlayEvent(event);
          } catch (error) {
            warnVideoDiagnostic('live overlay event append failed', error, {
              atMs: event.atMs,
              kind: event.kind,
            });
          }
        },
      }),
      [
        device,
        enabled,
        liveOverlayOutput,
        microphoneEnabled,
        microphoneRecorder,
        prepareMicrophone,
        videoOutput,
      ],
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
          // Prepare native resources before ReadyScreen starts any countdown audio.
          void Promise.all([prepareMicrophone(), loadLiveOverlayBrandingUris()]).then(() => onReady());
        }}
        outputs={cameraOutputs}
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

let liveOverlayBrandingPromise: ReturnType<typeof resolveLiveOverlayBrandingUris> | null = null;

function loadLiveOverlayBrandingUris() {
  if (Platform.OS !== 'ios') return Promise.resolve(null);
  liveOverlayBrandingPromise ??= resolveLiveOverlayBrandingUris();
  return liveOverlayBrandingPromise;
}

async function resolveLiveOverlayBrandingUris() {
  try {
    const { Asset } = await import('expo-asset');
    const [headshot, wordmark] = await Asset.loadAsync([
      require('../../assets/images/branding/albert-headshot.png'),
      require('../../assets/images/branding/whatz-it-wordmark.png'),
    ]);
    return {
      headshotUri: headshot.localUri ?? headshot.uri,
      wordmarkUri: wordmark.localUri ?? wordmark.uri,
    };
  } catch (error) {
    warnVideoDiagnostic('live overlay branding assets unavailable', error);
    return null;
  }
}

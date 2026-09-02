import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { Platform } from 'react-native';

import { getRecentRoundTiltCalibration } from '@/game/round-tilt-calibration';
import type { TiltAction } from '@/game/tilt-detector';
import {
  createTiltDetectorState,
  ANDROID_TILT_CONFIG,
  DEFAULT_TILT_CONFIG,
  getPortraitMotionSample,
  updateTiltDetector,
} from '@/game/tilt-detector';
import { getRoundMotionAccess } from '@/utils/round-motion-permission';
import { logRoundDiagnostic, warnRoundDiagnostic } from '@/video/video-diagnostics';

export type TiltControlStatus = 'checking' | 'calibrating' | 'ready' | 'unavailable' | 'denied';

type UseTiltControlsOptions = {
  enabled: boolean;
  acceptingInput: boolean;
  onAction: (action: TiltAction) => void;
  onRearmed: () => void;
};

export function useTiltControls({ enabled, acceptingInput, onAction, onRearmed }: UseTiltControlsOptions) {
  const [status, setStatus] = useState<TiltControlStatus>('checking');
  const detector = useRef(createTiltDetectorState());
  const acceptingInputRef = useRef(acceptingInput);
  const enabledRef = useRef(enabled);
  const onActionRef = useRef(onAction);
  const onRearmedRef = useRef(onRearmed);
  const awaitingFeedbackCommit = useRef(false);
  const pendingRearm = useRef(false);

  useLayoutEffect(() => {
    acceptingInputRef.current = acceptingInput && !awaitingFeedbackCommit.current;
    enabledRef.current = enabled;
    onActionRef.current = onAction;
    onRearmedRef.current = onRearmed;
    if (!enabled) {
      awaitingFeedbackCommit.current = false;
      pendingRearm.current = false;
    } else if (!acceptingInput && awaitingFeedbackCommit.current) {
      awaitingFeedbackCommit.current = false;
      if (pendingRearm.current) {
        pendingRearm.current = false;
        onRearmed();
      }
    }
  }, [acceptingInput, enabled, onAction, onRearmed]);

  useEffect(() => {
    logRoundDiagnostic('tilt input acceptance changed', { acceptingInput, enabled });
  }, [acceptingInput, enabled]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;
    let readyPublished = false;
    let lastTimestamp: number | undefined;

    const connect = async () => {
      const connectStartedAt = Date.now();
      setStatus('checking');
      detector.current = createTiltDetectorState();

      const motionAccess = await getRoundMotionAccess();
      if (!active) return;
      if (motionAccess === 'unavailable') {
        setStatus('unavailable');
        logRoundDiagnostic('tilt controls unavailable');
        return;
      }
      if (motionAccess === 'denied') {
        setStatus('denied');
        warnRoundDiagnostic('tilt controls permission denied', new Error('DeviceMotion denied'));
        return;
      }

      // Feedback is cleared as soon as the player returns the phone to center.
      // A 40 ms cadence keeps the two-sample action confirmation responsive
      // without weakening it or burdening the JS thread.
      const updateIntervalMs = Platform.OS === 'android' ? 40 : 50;
      const config = Platform.OS === 'android' ? ANDROID_TILT_CONFIG : DEFAULT_TILT_CONFIG;
      DeviceMotion.setUpdateInterval(updateIntervalMs);
      const recentCalibration = getRecentRoundTiltCalibration();
      if (recentCalibration) {
        detector.current = createTiltDetectorState(recentCalibration.baseline);
        setStatus('ready');
        readyPublished = true;
        logRoundDiagnostic('tilt controls reused ready-screen baseline', {
          baseline: recentCalibration.baseline,
          baselineAgeMs: recentCalibration.ageMs,
          connectElapsedMs: Date.now() - connectStartedAt,
        });
      } else {
        setStatus('calibrating');
        logRoundDiagnostic('tilt controls started fallback calibration', {
          connectElapsedMs: Date.now() - connectStartedAt,
          updateIntervalMs,
        });
      }
      try {
        subscription = DeviceMotion.addListener((measurement) => {
          if (!active || !enabledRef.current) return;
          // Android dispatches on display frames; a frame may contain the same
          // rotation sample. It must not count twice toward confirmation.
          const timestamp = measurement.rotation?.timestamp;
          if (Platform.OS === 'android' && timestamp !== undefined) {
            if (timestamp === lastTimestamp) return;
            lastTimestamp = timestamp;
          }
          // Ready/Game remain portrait-locked at the native level and rotate their
          // canvas visually. DeviceMotion.orientation therefore cannot determine
          // whether these screens are being used in landscape.
          const sample = getPortraitMotionSample(measurement);
          if (!sample) return;
          const { angle } = sample;
          const result = updateTiltDetector(
            detector.current,
            angle,
            config,
            acceptingInputRef.current,
          );
          detector.current = result.state;

          if (result.calibrated && !readyPublished) {
            readyPublished = true;
            logRoundDiagnostic('tilt controls fallback calibration completed', {
              baseline: result.state.baseline,
              connectElapsedMs: Date.now() - connectStartedAt,
              sampleCount: result.state.calibrationCount,
            });
            setStatus('ready');
          }
          if (result.action && acceptingInputRef.current) {
            acceptingInputRef.current = false;
            awaitingFeedbackCommit.current = true;
            logRoundDiagnostic('tilt action detected', {
              action: result.action,
              delta: result.delta,
              elapsedSinceConnectMs: Date.now() - connectStartedAt,
            });
            onActionRef.current(result.action);
          }
          if (result.rearmed) {
            logRoundDiagnostic('tilt controls rearmed', {
              delta: result.delta,
              elapsedSinceConnectMs: Date.now() - connectStartedAt,
            });
            // A batch of queued sensor events may include both the answer and
            // center before React commits feedback. Deliver rearm with the
            // committed feedback callback, otherwise ADVANCE sees old state.
            if (awaitingFeedbackCommit.current) pendingRearm.current = true;
            else onRearmedRef.current();
          }
        });
      } catch (error) {
        setStatus('unavailable');
        warnRoundDiagnostic('tilt controls listener failed', error);
      }
    };

    connect();
    return () => {
      active = false;
      subscription?.remove();
    };
  }, [enabled]);

  return status;
}

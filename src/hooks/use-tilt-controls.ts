import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { Platform } from 'react-native';

import { getRecentRoundTiltCalibration } from '@/game/round-tilt-calibration';
import {
  createRoundPostureDetectorState,
  type RoundDevicePosture,
  type RoundPostureZone,
  updateRoundPostureDetector,
} from '@/game/round-posture-detector';
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
import { startAndroidGameplayTrace, stopAndroidGameplayTrace, traceAndroidGameplay, traceAndroidGesture } from '@/utils/android-gameplay-trace';

export type TiltControlStatus = 'checking' | 'calibrating' | 'ready' | 'unavailable' | 'denied';

export type RoundMotionState = {
  status: TiltControlStatus;
  posture: RoundDevicePosture;
  postureZone: RoundPostureZone;
};

type UseTiltControlsOptions = {
  enabled: boolean;
  acceptingInput: boolean;
  onAction: (action: TiltAction) => void;
  onPostureChange?: (posture: RoundDevicePosture) => void;
  onRearmed: () => void;
};

export function useTiltControls({
  enabled,
  acceptingInput,
  onAction,
  onPostureChange,
  onRearmed,
}: UseTiltControlsOptions) {
  const [status, setStatus] = useState<TiltControlStatus>('checking');
  const [posture, setPosture] = useState<RoundDevicePosture>('landscape');
  const [postureZone, setPostureZone] = useState<RoundPostureZone>('other');
  const detector = useRef(createTiltDetectorState());
  const postureDetector = useRef(createRoundPostureDetectorState());
  const postureRef = useRef<RoundDevicePosture>('landscape');
  const acceptingInputRef = useRef(acceptingInput);
  const enabledRef = useRef(enabled);
  const onActionRef = useRef(onAction);
  const onPostureChangeRef = useRef(onPostureChange);
  const onRearmedRef = useRef(onRearmed);
  const awaitingFeedbackCommit = useRef(false);
  const pendingRearm = useRef(false);

  useLayoutEffect(() => {
    acceptingInputRef.current = acceptingInput && !awaitingFeedbackCommit.current;
    enabledRef.current = enabled;
    onActionRef.current = onAction;
    onPostureChangeRef.current = onPostureChange;
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
  }, [acceptingInput, enabled, onAction, onPostureChange, onRearmed]);

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
      postureDetector.current = createRoundPostureDetectorState(postureRef.current);
      setPostureZone('other');

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
      // Android dispatches only on display frames: 40 ms becomes ~50 ms at
      // 60 Hz, easily skipping a quick neutral crossing. Observe each frame;
      // elapsed-time filtering/confirmation preserve the scoring safeguards.
      const updateIntervalMs = Platform.OS === 'android' ? 16 : 50;
      const config = Platform.OS === 'android' ? ANDROID_TILT_CONFIG : DEFAULT_TILT_CONFIG;
      startAndroidGameplayTrace();
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
          traceAndroidGameplay('sensor.js-receipt', { sampleMs: (measurement.rotation?.timestamp ?? 0) * 1000 });
          // Android dispatches on display frames; a frame may contain the same
          // rotation sample. It must not count twice toward confirmation.
          const timestamp = measurement.rotation?.timestamp;
          let elapsedMs = 50;
          if (Platform.OS === 'android' && timestamp !== undefined) {
            if (!Number.isFinite(timestamp) || (lastTimestamp !== undefined && timestamp <= lastTimestamp)) return;
            if (lastTimestamp !== undefined) elapsedMs = (timestamp - lastTimestamp) * 1000;
            lastTimestamp = timestamp;
          }
          // Ready/Game remain portrait-locked at the native level and rotate their
          // canvas visually. DeviceMotion.orientation therefore cannot determine
          // whether these screens are being used in landscape.
          const sample = getPortraitMotionSample(measurement);
          if (!sample) return;
          const { angle, gravity } = sample;
          const postureResult = updateRoundPostureDetector(
            postureDetector.current,
            gravity,
            elapsedMs,
          );
          const previousPostureZone = postureDetector.current.zone;
          postureDetector.current = postureResult.state;
          if (postureResult.state.zone !== previousPostureZone) {
            setPostureZone(postureResult.state.zone);
            logRoundDiagnostic('round device posture zone changed', {
              zone: postureResult.state.zone,
              gravity,
            });
          }
          if (postureResult.changed) {
            postureRef.current = postureResult.state.posture;
            setPosture(postureResult.state.posture);
            onPostureChangeRef.current?.(postureResult.state.posture);
            logRoundDiagnostic('round device posture changed', {
              posture: postureResult.state.posture,
              gravity,
            });
          }
          const result = updateTiltDetector(
            detector.current,
            angle,
            config,
            acceptingInputRef.current && postureResult.state.zone !== 'portrait',
            elapsedMs,
          );
          detector.current = result.state;
          traceAndroidGameplay('sensor.classified', {
            sampleMs: (timestamp ?? 0) * 1000, raw: angle,
            baseline: result.state.baseline, filtered: result.state.filteredAngle,
            candidate: result.state.candidateAction, candidateMs: result.state.candidateDurationMs,
            action: result.action, rearmed: result.rearmed,
          });

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
            traceAndroidGesture();
            if (Platform.OS === 'android') onActionRef.current(result.action);
            logRoundDiagnostic('tilt action detected', {
              action: result.action,
              delta: result.delta,
              sampleIntervalMs: elapsedMs,
              elapsedSinceConnectMs: Date.now() - connectStartedAt,
            });
            if (Platform.OS !== 'android') onActionRef.current(result.action);
            traceAndroidGameplay('answer.callback-returned');
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
      stopAndroidGameplayTrace();
    };
  }, [enabled]);

  return { status, posture, postureZone } satisfies RoundMotionState;
}

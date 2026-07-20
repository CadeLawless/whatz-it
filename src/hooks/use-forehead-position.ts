import { useEffect, useState } from 'react';
import { DeviceMotion } from 'expo-sensors';

import {
  clearRoundTiltCalibration,
  rememberRoundTiltCalibration,
} from '@/game/round-tilt-calibration';
import { isForeheadPosition, normalizePortraitCanvasTilt } from '@/game/tilt-detector';
import { getRoundMotionAccess } from '@/utils/round-motion-permission';
import { logRoundDiagnostic } from '@/video/video-diagnostics';

export type ForeheadPositionStatus =
  | 'checking'
  | 'waiting'
  | 'ready'
  | 'unavailable'
  | 'denied';

const REQUIRED_STABLE_SAMPLES = 6;

export function useForeheadPosition(enabled: boolean) {
  const [status, setStatus] = useState<ForeheadPositionStatus>('checking');

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let stableSamples = 0;
    let baselineLogged = false;
    const tiltSamples: number[] = [];
    let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;

    const connect = async () => {
      // Never let a recently completed round seed a new one. This screen owns
      // the baseline and republishes it only after the current placement check.
      clearRoundTiltCalibration();
      setStatus('checking');
      const motionAccess = await getRoundMotionAccess();
      if (!active) return;
      if (motionAccess === 'unavailable') {
        setStatus('unavailable');
        return;
      }
      if (motionAccess === 'denied') {
        setStatus('denied');
        return;
      }

      DeviceMotion.setUpdateInterval(80);
      setStatus('waiting');
      logRoundDiagnostic('forehead motion monitoring started', {
        requiredStableSamples: REQUIRED_STABLE_SAMPLES,
        updateIntervalMs: 80,
      });
      try {
        subscription = DeviceMotion.addListener((measurement) => {
          const gravity = measurement.accelerationIncludingGravity;
          const physicalOrientation = Math.abs(gravity.x) >= 6.5 ? 90 : 0;
          if (isForeheadPosition(gravity, physicalOrientation)) {
            stableSamples += 1;
            tiltSamples.push(normalizePortraitCanvasTilt(measurement.rotation.gamma));
            if (tiltSamples.length > REQUIRED_STABLE_SAMPLES) tiltSamples.shift();
            if (stableSamples >= REQUIRED_STABLE_SAMPLES) {
              const baseline =
                tiltSamples.reduce((total, angle) => total + angle, 0) / tiltSamples.length;
              rememberRoundTiltCalibration(baseline);
              setStatus('ready');
              if (!baselineLogged) {
                baselineLogged = true;
                logRoundDiagnostic('forehead tilt baseline captured for game', {
                  baseline,
                  stableSamples,
                });
              }
            }
          } else {
            stableSamples = 0;
            tiltSamples.length = 0;
            clearRoundTiltCalibration();
            setStatus((current) => (current === 'ready' ? current : 'waiting'));
          }
        });
      } catch {
        setStatus('unavailable');
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

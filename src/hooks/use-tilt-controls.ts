import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';

import type { TiltAction } from '@/game/tilt-detector';
import {
  createTiltDetectorState,
  isLandscapeOrientation,
  normalizeLandscapeTilt,
  updateTiltDetector,
} from '@/game/tilt-detector';

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
  const landscapeOrientation = useRef<90 | -90 | null>(null);
  const acceptingInputRef = useRef(acceptingInput);
  const onActionRef = useRef(onAction);
  const onRearmedRef = useRef(onRearmed);

  useEffect(() => {
    acceptingInputRef.current = acceptingInput;
  }, [acceptingInput]);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    onRearmedRef.current = onRearmed;
  }, [onRearmed]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;

    const connect = async () => {
      setStatus('checking');
      detector.current = createTiltDetectorState();
      landscapeOrientation.current = null;

      // Browser support varies widely and some Expo web implementations report
      // availability without exposing the listener API. The web MVP therefore
      // uses the reliable button controls and reserves tilt input for native apps.
      if (Platform.OS === 'web') {
        setStatus('unavailable');
        return;
      }

      const available = await DeviceMotion.isAvailableAsync().catch(() => false);
      if (!active) return;
      if (!available) {
        setStatus('unavailable');
        return;
      }

      const currentPermission = await DeviceMotion.getPermissionsAsync().catch(() => null);
      let granted = currentPermission?.granted ?? true;
      if (!granted && currentPermission?.canAskAgain) {
        const requested = await DeviceMotion.requestPermissionsAsync().catch(() => null);
        granted = requested?.granted ?? false;
      }
      if (!active) return;
      if (!granted) {
        setStatus('denied');
        return;
      }

      DeviceMotion.setUpdateInterval(50);
      setStatus('calibrating');
      try {
        subscription = DeviceMotion.addListener((measurement) => {
          if (!isLandscapeOrientation(measurement.orientation)) return;
          if (landscapeOrientation.current === null) {
            landscapeOrientation.current = measurement.orientation;
          }
          if (measurement.orientation !== landscapeOrientation.current) return;

          const angle = normalizeLandscapeTilt(measurement.rotation.gamma, measurement.orientation);
          if (angle === null) return;
          const result = updateTiltDetector(
            detector.current,
            angle,
            undefined,
            acceptingInputRef.current,
          );
          detector.current = result.state;

          if (result.calibrated) setStatus((current) => (current === 'ready' ? current : 'ready'));
          if (result.action && acceptingInputRef.current) onActionRef.current(result.action);
          if (result.rearmed) onRearmedRef.current();
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

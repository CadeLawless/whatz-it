import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';

import { isForeheadPosition } from '@/game/tilt-detector';

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
    let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;

    const connect = async () => {
      setStatus('checking');
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

      DeviceMotion.setUpdateInterval(80);
      setStatus('waiting');
      try {
        subscription = DeviceMotion.addListener((measurement) => {
          if (isForeheadPosition(measurement.accelerationIncludingGravity, measurement.orientation)) {
            stableSamples += 1;
            if (stableSamples >= REQUIRED_STABLE_SAMPLES) setStatus('ready');
          } else {
            stableSamples = 0;
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

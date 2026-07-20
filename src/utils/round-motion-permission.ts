import { DeviceMotion } from 'expo-sensors';
import { Platform } from 'react-native';

export type RoundMotionAccess = 'granted' | 'denied' | 'unavailable';

export async function requestRoundMotionAccess(): Promise<RoundMotionAccess> {
  return resolveRoundMotionAccess(true);
}

export async function getRoundMotionAccess(): Promise<RoundMotionAccess> {
  return resolveRoundMotionAccess(false);
}

async function resolveRoundMotionAccess(
  requestIfNeeded: boolean,
): Promise<RoundMotionAccess> {
  if (Platform.OS === 'web') return 'unavailable';

  const available = await DeviceMotion.isAvailableAsync().catch(() => false);
  if (!available) return 'unavailable';

  const currentPermission = await DeviceMotion.getPermissionsAsync().catch(() => null);
  if (!currentPermission) return 'unavailable';
  if (currentPermission.granted) return 'granted';
  if (!requestIfNeeded || !currentPermission.canAskAgain) return 'denied';

  const requestedPermission = await DeviceMotion.requestPermissionsAsync().catch(() => null);
  if (!requestedPermission) return 'unavailable';
  return requestedPermission.granted ? 'granted' : 'denied';
}

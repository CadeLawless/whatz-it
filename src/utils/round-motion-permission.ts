import { DeviceMotion } from 'expo-sensors';
import { Platform } from 'react-native';

export type RoundMotionAccess = 'granted' | 'denied' | 'unavailable';
export type RoundMotionPermissionStatus = RoundMotionAccess | 'not-determined';

export async function requestRoundMotionAccess(): Promise<RoundMotionAccess> {
  const currentStatus = await getRoundMotionPermissionStatus();
  if (currentStatus !== 'not-determined') return currentStatus;

  const requestedPermission = await DeviceMotion.requestPermissionsAsync().catch(() => null);
  if (!requestedPermission) return 'unavailable';
  return requestedPermission.granted ? 'granted' : 'denied';
}

export async function getRoundMotionAccess(): Promise<RoundMotionAccess> {
  const currentStatus = await getRoundMotionPermissionStatus();
  return currentStatus === 'not-determined' ? 'denied' : currentStatus;
}

export async function getRoundMotionPermissionStatus(): Promise<RoundMotionPermissionStatus> {
  if (Platform.OS === 'web') return 'unavailable';

  const available = await DeviceMotion.isAvailableAsync().catch(() => false);
  if (!available) return 'unavailable';

  const currentPermission = await DeviceMotion.getPermissionsAsync().catch(() => null);
  if (!currentPermission) return 'unavailable';
  if (currentPermission.granted) return 'granted';
  return currentPermission.canAskAgain ? 'not-determined' : 'denied';
}

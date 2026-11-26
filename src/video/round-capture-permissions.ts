import { Linking } from 'react-native';
import { type PermissionStatus, VisionCamera } from 'react-native-vision-camera';

export type RoundCameraPermissionState =
  | 'authorized'
  | 'requestable'
  | 'denied'
  | 'restricted';

export type RoundCameraPermissionRecovery =
  | 'granted'
  | 'denied'
  | 'settings-opened'
  | 'settings-error';

function cameraPermissionState(status: PermissionStatus): RoundCameraPermissionState {
  if (status === 'authorized') return 'authorized';
  if (status === 'not-determined') return 'requestable';
  if (status === 'restricted') return 'restricted';
  return 'denied';
}

export async function prepareRoundCameraPermissions(
  { microphone = true }: { microphone?: boolean } = {},
) {
  const cameraState = cameraPermissionState(VisionCamera.cameraPermissionStatus);
  if (cameraState !== 'authorized') {
    return { cameraGranted: false, cameraState, microphoneGranted: false };
  }

  const microphoneGranted = microphone && (VisionCamera.microphonePermissionStatus === 'authorized' ||
    await VisionCamera.requestMicrophonePermission().catch(() => false));
  return { cameraGranted: true, cameraState, microphoneGranted };
}

export async function recoverRoundCameraPermission(): Promise<RoundCameraPermissionRecovery> {
  const cameraState = cameraPermissionState(VisionCamera.cameraPermissionStatus);
  if (cameraState === 'authorized') return 'granted';
  if (cameraState === 'requestable') {
    return await VisionCamera.requestCameraPermission() ? 'granted' : 'denied';
  }
  try {
    await Linking.openSettings();
    return 'settings-opened';
  } catch {
    return 'settings-error';
  }
}

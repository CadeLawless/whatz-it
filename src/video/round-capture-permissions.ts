import { VisionCamera } from 'react-native-vision-camera';

export async function requestRoundCameraPermissions({ microphone = true }: { microphone?: boolean } = {}) {
  const cameraGranted = VisionCamera.cameraPermissionStatus === 'authorized' ||
    await VisionCamera.requestCameraPermission();
  if (!cameraGranted) return { cameraGranted: false, microphoneGranted: false };

  const microphoneGranted = microphone && (VisionCamera.microphonePermissionStatus === 'authorized' ||
    await VisionCamera.requestMicrophonePermission().catch(() => false));
  return { cameraGranted: true, microphoneGranted };
}

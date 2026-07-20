import { useCallback } from 'react';
import { useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';

export function useRoundCameraPermissions() {
  const {
    canRequestPermission: canRequestCameraPermission,
    hasPermission: hasCameraPermission,
    requestPermission: requestCameraPermission,
    status: cameraStatus,
  } = useCameraPermission();
  const {
    canRequestPermission: canRequestMicrophonePermission,
    requestPermission: requestMicrophonePermission,
    status: microphoneStatus,
  } = useMicrophonePermission();

  const requestPendingPermissions = useCallback(async () => {
    let cameraGranted = hasCameraPermission;

    if (canRequestCameraPermission) {
      cameraGranted = await requestCameraPermission();
    }

    if (!cameraGranted || !canRequestMicrophonePermission) return;
    await requestMicrophonePermission();
  }, [
    canRequestCameraPermission,
    canRequestMicrophonePermission,
    hasCameraPermission,
    requestCameraPermission,
    requestMicrophonePermission,
  ]);

  return {
    cameraStatus,
    microphoneStatus,
    requestPendingPermissions,
  };
}

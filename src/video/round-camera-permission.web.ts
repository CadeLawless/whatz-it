export function useRoundCameraPermissions() {
  return {
    cameraStatus: 'authorized' as const,
    microphoneStatus: 'authorized' as const,
    requestPendingPermissions: async () => undefined,
  };
}

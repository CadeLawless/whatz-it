export function useRoundCameraPermissions() {
  return {
    cameraStatus: 'authorized' as const,
    requestPendingPermissions: async () => undefined,
  };
}

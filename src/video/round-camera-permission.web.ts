export function useRoundCameraPermissions() {
  return {
    cameraStatus: 'authorized' as const,
    microphoneStatus: 'authorized' as const,
    requestPendingPermissions: async (_options?: { microphone?: boolean }) => undefined,
    requestCameraAccess: async () => false,
    requestMicrophoneAccess: async () => false,
  };
}

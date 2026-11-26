import { forwardRef } from 'react';

import type { RoundCameraRef } from './round-camera';

export async function prepareRoundCameraPermissions() {
  return { cameraGranted: false, cameraState: 'restricted' as const, microphoneGranted: false };
}

export async function recoverRoundCameraPermission() {
  return 'settings-error' as const;
}

export const RoundCamera = forwardRef<RoundCameraRef, { enabled: boolean }>(
  function RoundCamera() {
    return null;
  },
);

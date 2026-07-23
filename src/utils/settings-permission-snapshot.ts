import { VisionCamera } from 'react-native-vision-camera';

import type { SettingsPermissionSnapshot } from '@/storage/settings-return';
import { getRoundMotionPermissionStatus } from '@/utils/round-motion-permission';

export async function getSettingsPermissionSnapshot(): Promise<SettingsPermissionSnapshot> {
  const motion = await getRoundMotionPermissionStatus();
  return {
    camera: VisionCamera.cameraPermissionStatus,
    microphone: VisionCamera.microphonePermissionStatus,
    motion,
  };
}

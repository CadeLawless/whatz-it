import type { SettingsPermissionSnapshot } from '@/storage/settings-return';

export async function getSettingsPermissionSnapshot(): Promise<SettingsPermissionSnapshot> {
  return {
    camera: 'authorized',
    microphone: 'authorized',
    motion: 'unavailable',
  };
}

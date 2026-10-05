import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { SharePlayInvitation, SharePlaySnapshot, WhatzItSharePlayModuleEvents } from './WhatzItSharePlay.types';

declare class WhatzItSharePlayModule extends NativeModule<WhatzItSharePlayModuleEvents> {
  startAsync(environment: string): Promise<SharePlaySnapshot>;
  stopAsync(): Promise<void>;
  getSnapshotAsync(): Promise<SharePlaySnapshot>;
  inviteAsync(activity: SharePlayInvitation): Promise<'success' | 'cancelled'>;
  joinAsync(): Promise<void>;
  sendAsync(body: string, recipientIds: string[]): Promise<void>;
  leaveAsync(): Promise<void>;
  endAsync(): Promise<void>;
}

export default Platform.OS === 'ios'
  ? requireOptionalNativeModule<WhatzItSharePlayModule>('WhatzItSharePlay')
  : null;

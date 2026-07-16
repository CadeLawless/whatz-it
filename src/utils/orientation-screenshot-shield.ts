import type { RefObject } from 'react';
import { Platform, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import {
  beginOrientationScreenshotShield,
  finishOrientationScreenshotShield,
  supportsOrientationScreenshotShield,
} from 'whatz-it-video-export';

import { lockLandscapeOrientation, lockPortraitOrientation } from '@/utils/orientation';

export type ScreenOrientationOption = 'portrait' | 'landscape_right';

type ChangeOrientationWithScreenshotShieldOptions = {
  screenRef: RefObject<View | null>;
  setScreenOrientation: (orientation: ScreenOrientationOption) => void;
  target: 'landscape' | 'portrait';
};

export async function changeOrientationWithScreenshotShield({
  screenRef,
  setScreenOrientation,
  target,
}: ChangeOrientationWithScreenshotShieldOptions) {
  if (Platform.OS === 'web') return true;

  let snapshotUri: string | null = null;
  let shieldActive = false;

  if (Platform.OS === 'ios' && supportsOrientationScreenshotShield()) {
    snapshotUri = await captureRef(screenRef, {
      format: 'png',
      result: 'tmpfile',
    }).catch(() => null);
    shieldActive = await beginOrientationScreenshotShield(snapshotUri).catch(() => false);
    if (snapshotUri) releaseCapture(snapshotUri);
  }

  try {
    setScreenOrientation(target === 'landscape' ? 'landscape_right' : 'portrait');
    return target === 'landscape'
      ? await lockLandscapeOrientation()
      : await lockPortraitOrientation();
  } finally {
    if (shieldActive) {
      await finishOrientationScreenshotShield().catch(() => false);
    }
  }
}

import * as ScreenOrientation from 'expo-screen-orientation';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

export function usePortraitOrientation() {
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const lockPortrait = async () => {
        await ScreenOrientation.unlockAsync().catch(() => undefined);
        if (active) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
            () => undefined,
          );
        }
      };

      lockPortrait();
      const retry = setTimeout(lockPortrait, 250);
      return () => {
        active = false;
        clearTimeout(retry);
      };
    }, []),
  );
}

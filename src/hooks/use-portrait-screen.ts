import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { lockPortraitOrientation } from '@/utils/orientation';

export function usePortraitScreen() {
  const { width, height } = useWindowDimensions();
  const isPortrait = Platform.OS === 'web' || height >= width;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return undefined;

      let active = true;
      let retry: ReturnType<typeof setTimeout> | undefined;

      const enforcePortrait = async () => {
        const locked = await lockPortraitOrientation();
        if (!active || (locked && isPortrait)) return;
        retry = setTimeout(enforcePortrait, 100);
      };

      enforcePortrait();
      return () => {
        active = false;
        if (retry) clearTimeout(retry);
      };
    }, [isPortrait]),
  );

  return isPortrait;
}

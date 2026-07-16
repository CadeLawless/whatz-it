import { Platform, useWindowDimensions } from 'react-native';

export function usePortraitScreen() {
  const { width, height } = useWindowDimensions();
  const isPortrait = Platform.OS === 'web' || height >= width;

  return isPortrait;
}

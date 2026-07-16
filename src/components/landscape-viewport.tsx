import type { PropsWithChildren } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { colors } from '@/theme';

type LandscapeViewportProps = PropsWithChildren<{ backgroundColor?: string }>;

export function LandscapeViewport({ children, backgroundColor }: LandscapeViewportProps) {
  return (
    <View style={[styles.viewport, backgroundColor ? { backgroundColor } : undefined]}>
      {children}
    </View>
  );
}

export function useLandscapeDimensions() {
  const { width, height } = useWindowDimensions();
  return { width, height };
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden', backgroundColor: colors.play },
});

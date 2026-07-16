import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { colors } from '@/theme';

type LandscapeViewportProps = PropsWithChildren<{ backgroundColor?: string }>;

export function LandscapeViewport({ children, backgroundColor }: LandscapeViewportProps) {
  const { width, height } = useWindowDimensions();

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.web, backgroundColor ? { backgroundColor } : undefined]}>
        {children}
      </View>
    );
  }

  if (width > height) {
    return (
      <View style={[styles.viewport, backgroundColor ? { backgroundColor } : undefined]}>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.viewport, backgroundColor ? { backgroundColor } : undefined]}>
      <View
        style={[
          styles.rotated,
          {
            width: height,
            height: width,
            left: (width - height) / 2,
            top: (height - width) / 2,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function useLandscapeDimensions() {
  const { width, height } = useWindowDimensions();
  if (Platform.OS === 'web') return { width, height };
  return { width: Math.max(width, height), height: Math.min(width, height) };
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden', backgroundColor: colors.play },
  rotated: {
    position: 'absolute',
    transform: [{ rotate: '90deg' }],
  },
  web: { flex: 1 },
});

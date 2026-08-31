import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type RecordingIndicatorProps = {
  position?: 'bottom-left' | 'top-left';
};

export function RecordingIndicator({
  position = 'bottom-left',
}: RecordingIndicatorProps) {
  const reduceMotion = useReducedMotion();
  const dotOpacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      dotOpacity.value = 1;
      return;
    }

    dotOpacity.value = withRepeat(withTiming(0.2, { duration: 650 }), -1, true);
    return () => cancelAnimation(dotOpacity);
  }, [dotOpacity, reduceMotion]);

  const animatedDotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  return (
    <View
      accessibilityLabel="Recording in progress"
      accessibilityRole="text"
      accessible
      pointerEvents="none"
      style={[
        styles.container,
        position === 'top-left' && styles.topLeft,
      ]}
    >
      <Animated.View accessibilityElementsHidden style={[styles.dot, animatedDotStyle]} />
      <Text accessible={false} style={styles.label}>
        REC
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 30,
    bottom: 28,
    zIndex: 90,
    elevation: 90,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  topLeft: {
    top: 37,
    bottom: 'auto',
    left: 90,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 1.1,
  },
});

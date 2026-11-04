import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';

export function HandoffTapCue() {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(0);
    if (!reduceMotion) {
      pulse.set(withRepeat(withTiming(1, {
        duration: 650, easing: Easing.bezier(0.42, 0, 0.58, 1),
      }), -1, true));
    }
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - pulse.get() * 0.22,
    transform: [{ scale: 1 + pulse.get() * 0.12 }],
  }));

  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    pointerEvents="none" style={[styles.frame, animatedStyle]}>
    <SymbolView name={{ ios: 'hand.tap.fill', android: 'touch_app', web: 'touch_app' }}
      size={72} tintColor={colors.white} style={styles.icon} accessibilityElementsHidden />
  </Animated.View>;
}

const styles = StyleSheet.create({
  frame: { width: 96, height: 96, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  icon: { width: 80, height: 80 },
});

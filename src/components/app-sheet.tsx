import {
  forwardRef,
  PropsWithChildren,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
} from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type AppSheetProps = PropsWithChildren<{
  accessibilityLabel: string;
  heightFraction: number;
  onClose: () => void;
}>;

export type AppSheetRef = {
  close: () => void;
};

const DISMISS_DISTANCE = 72;
const DISMISS_VELOCITY = 720;
const MAX_SHEET_WIDTH = 680;

export const AppSheet = forwardRef<AppSheetRef, AppSheetProps>(function AppSheet(
  { accessibilityLabel, children, heightFraction, onClose },
  ref,
) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const sheetHeight = Math.min(
    height * Math.max(0.35, Math.min(heightFraction, 0.94)),
    height - insets.top - 20,
  );
  const sheetWidth = Math.min(width, MAX_SHEET_WIDTH);
  const translateY = useSharedValue(sheetHeight + 32);
  const backdropOpacity = useSharedValue(0);
  const closing = useSharedValue(false);

  useEffect(() => {
    translateY.set(
      reduceMotion
        ? 0
        : withSpring(0, {
            damping: 26,
            mass: 0.86,
            stiffness: 260,
          }),
    );
    backdropOpacity.set(
      reduceMotion ? 1 : withTiming(1, { duration: 180 }),
    );
  }, [backdropOpacity, reduceMotion, translateY]);

  const finishClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const close = useCallback(() => {
    if (closing.get()) return;
    closing.set(true);

    if (reduceMotion) {
      finishClose();
      return;
    }

    backdropOpacity.set(withTiming(0, { duration: 160 }));
    translateY.set(
      withTiming(sheetHeight + 32, { duration: 220 }, (finished) => {
        if (finished) runOnJS(finishClose)();
      }),
    );
  }, [backdropOpacity, closing, finishClose, reduceMotion, sheetHeight, translateY]);

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .failOffsetX([-28, 28])
        .onUpdate(({ translationY }) => {
          translateY.set(Math.max(0, translationY));
        })
        .onEnd(({ translationY, velocityY }) => {
          if (
            translationY >= DISMISS_DISTANCE ||
            velocityY >= DISMISS_VELOCITY
          ) {
            runOnJS(close)();
            return;
          }

          translateY.set(
            reduceMotion
              ? 0
              : withSpring(0, {
                  damping: 24,
                  stiffness: 280,
                }),
          );
        }),
    [close, reduceMotion, translateY],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get(),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  useImperativeHandle(ref, () => ({ close }), [close]);

  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable
          accessibilityLabel="Close sheet"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        accessibilityLabel={accessibilityLabel}
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { height: sheetHeight, width: sheetWidth },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={dragGesture}>
          <View accessibilityElementsHidden style={styles.grabberArea}>
            <View style={styles.grabber} />
          </View>
        </GestureDetector>
        <View style={styles.content}>{children}</View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
  },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: '#FFFFFF',
    boxShadow: '0 -8px 36px rgba(15, 23, 42, 0.16)',
  },
  grabberArea: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(60, 60, 67, 0.28)',
  },
  content: { flex: 1 },
});

import { StatusBar } from 'expo-status-bar';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { releaseCapture } from 'react-native-view-shot';

import {
  beginOrientationSnapshotTransition,
  finishOrientationSnapshotTransition,
  supportsOrientationSnapshotTransitions,
} from 'whatz-it-video-export';

export type ScreenshotDestination =
  | 'home'
  | 'deck'
  | 'ready'
  | 'results'
  | 'video'
  | 'video-return';
type SlideDirection = 'left' | 'right';

type ScreenshotTransition = {
  destination: ScreenshotDestination;
  direction: SlideDirection;
  uri?: string;
  orientationChange?: boolean;
  nativeOverlay?: boolean;
};

type ScreenshotTransitionContextValue = {
  beginTransition: (transition: Omit<ScreenshotTransition, 'nativeOverlay'>) => Promise<void>;
  revealTransition: (destination: ScreenshotDestination) => Promise<void>;
};

const ScreenshotTransitionContext = createContext<ScreenshotTransitionContextValue | null>(null);

export function ScreenshotTransitionProvider({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const [transition, setTransition] = useState<ScreenshotTransition | null>(null);
  const transitionRef = useRef<ScreenshotTransition | null>(null);
  const imageReady = useRef<(() => void) | null>(null);
  const isRevealing = useRef(false);
  const revealPromise = useRef<Promise<void> | null>(null);
  const [translateX] = useState(() => new Animated.Value(0));

  const beginTransition = useCallback(
    async (nextTransition: Omit<ScreenshotTransition, 'nativeOverlay'>) => {
      translateX.setValue(0);
      isRevealing.current = false;
      revealPromise.current = null;

      if (
        nextTransition.orientationChange &&
        Platform.OS === 'ios' &&
        supportsOrientationSnapshotTransitions()
      ) {
        const nativeOverlay = await beginOrientationSnapshotTransition(
          nextTransition.uri ?? null,
        ).catch(() => false);
        if (nativeOverlay) {
          const nativeTransition = { ...nextTransition, nativeOverlay: true };
          transitionRef.current = nativeTransition;
          return;
        }
      }

      if (!nextTransition.uri) return;
      transitionRef.current = nextTransition;
      setTransition(nextTransition);

      return new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          imageReady.current = null;
          resolve();
        };
        imageReady.current = finish;
        setTimeout(finish, 300);
      });
    },
    [translateX],
  );

  const revealTransition = useCallback(
    (destination: ScreenshotDestination) => {
      const current = transitionRef.current;
      if (!current || current.destination !== destination) return Promise.resolve();
      if (isRevealing.current) return revealPromise.current ?? Promise.resolve();
      isRevealing.current = true;

      if (current.nativeOverlay) {
        const promise = finishOrientationSnapshotTransition(current.direction)
          .catch(() => false)
          .then(() => {
            transitionRef.current = null;
            isRevealing.current = false;
            revealPromise.current = null;
            if (current.uri) releaseCapture(current.uri);
          });
        revealPromise.current = promise;
        return promise;
      }

      const promise = new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            Animated.timing(translateX, {
              toValue: current.direction === 'right' ? width * 1.15 : -width * 1.15,
              duration: 380,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(() => {
              transitionRef.current = null;
              setTransition(null);
              isRevealing.current = false;
              revealPromise.current = null;

              // Let React remove the overlay before releasing its image. Resetting
              // the animation here can briefly redraw it at its starting point.
              if (current.uri) setTimeout(() => releaseCapture(current.uri!), 0);
              resolve();
            });
          });
        });
      });
      revealPromise.current = promise;
      return promise;
    },
    [translateX, width],
  );

  return (
    <ScreenshotTransitionContext.Provider value={{ beginTransition, revealTransition }}>
      <View style={styles.root}>
        {children}
        {transition && (
          <Animated.View
            pointerEvents="none"
            style={[styles.overlay, { transform: [{ translateX }] }]}
          >
            <StatusBar hidden animated={false} />
            <Animated.Image
              fadeDuration={0}
              onLoad={() => imageReady.current?.()}
              resizeMode="cover"
              source={{ uri: transition.uri! }}
              style={styles.snapshot}
            />
          </Animated.View>
        )}
      </View>
    </ScreenshotTransitionContext.Provider>
  );
}

export function useScreenshotTransition() {
  const context = useContext(ScreenshotTransitionContext);
  if (!context) throw new Error('useScreenshotTransition must be used inside its provider');
  return context;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10_000,
    elevation: 10_000,
    overflow: 'hidden',
  },
  snapshot: { ...StyleSheet.absoluteFill },
});

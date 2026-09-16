import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { CatalogDeck } from '@/catalog/catalog-snapshot';
import { colors, radius, spacing } from '@/theme';
import type { Card } from '@/types/deck';

const HOLD_DURATION = 2500;
const SWIPE_DURATION = 280;
const TUCK_DURATION = 280;
const STEP_DURATION = HOLD_DURATION + SWIPE_DURATION + TUCK_DURATION;
const HOLD_END = HOLD_DURATION / STEP_DURATION;
const SWIPE_END = (HOLD_DURATION + SWIPE_DURATION) / STEP_DURATION;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1).factory();
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1).factory();
const CARD_DRAG_DISTANCE = 0.82;

type StackItem =
  | { key: string; kind: 'cover' }
  | { card: Card; key: string; kind: 'featured-card' };

export function FeaturedCardsDeckStack({
  active = true,
  deck,
  interaction = 'swipe',
  width,
}: {
  active?: boolean;
  deck: CatalogDeck;
  interaction?: 'swipe' | 'tap';
  width: number;
}) {
  const featuredCards = deck.featuredCards ?? [];
  const items: StackItem[] = [
    { key: `${deck.id}-cover`, kind: 'cover' },
    ...featuredCards.map((card) => ({
      card,
      key: `${deck.id}-${card.id}`,
      kind: 'featured-card' as const,
    })),
  ];
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const interactive = useSharedValue(false);
  const dragStart = useSharedValue(0);
  const settleTarget = useSharedValue(0);
  const itemKey = items.map(({ key }) => key).join(':');

  const restartAutoplay = useCallback((step: number) => {
    if (!active) return;
    progress.set(step);
    settleTarget.set(step);
    interactive.set(false);
    if (reduceMotion || items.length < 2) return;
    progress.set(
      withRepeat(
        withTiming(step + items.length, {
          duration: items.length * STEP_DURATION,
          easing: Easing.linear,
        }),
        -1,
        false,
      ),
    );
  }, [active, interactive, items.length, progress, reduceMotion, settleTarget]);

  useEffect(() => {
    cancelAnimation(progress);
    restartAutoplay(0);

    return () => cancelAnimation(progress);
  }, [itemKey, progress, restartAutoplay]);

  const tapGesture = useMemo(() => Gesture.Tap()
    .enabled(active && items.length > 1)
    .onEnd(() => {
      const current = beginInteraction(progress, interactive);
      const target = Math.max(Math.floor(current) + 1, settleTarget.get() + 1);
      settleTarget.set(target);
      progress.set(withSpring(target, {
        duration: 400,
        dampingRatio: 1,
        reduceMotion: reduceMotion ? ReduceMotion.Always : ReduceMotion.Never,
      }, (finished) => {
        if (finished) scheduleOnRN(restartAutoplay, target);
      }));
    }), [active, interactive, items.length, progress, reduceMotion, restartAutoplay, settleTarget]);

  const advanceForAccessibility = useCallback(() => {
    if (!active || items.length < 2) return;
    const current = progress.get();
    cancelAnimation(progress);
    let manualProgress = current;
    if (!interactive.get()) {
      const step = Math.floor(current);
      manualProgress = step + Math.max(0, (current - step - HOLD_END) / (1 - HOLD_END));
      interactive.set(true);
      progress.set(manualProgress);
    }
    const target = Math.max(Math.floor(manualProgress) + 1, settleTarget.get() + 1);
    settleTarget.set(target);
    progress.set(withSpring(target, {
      duration: 400,
      dampingRatio: 1,
      reduceMotion: reduceMotion ? ReduceMotion.Always : ReduceMotion.Never,
    }, (finished) => {
      if (finished) scheduleOnRN(restartAutoplay, target);
    }));
  }, [active, interactive, items.length, progress, reduceMotion, restartAutoplay, settleTarget]);

  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(active && interaction === 'swipe' && items.length > 1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-18, 18])
    .onStart(() => {
      dragStart.set(beginInteraction(progress, interactive));
    })
    .onUpdate(({ translationX }) => {
      const start = dragStart.get();
      const base = Math.floor(start);
      progress.set(Math.max(base - 1, Math.min(base + 1,
        start + translationX / (width * CARD_DRAG_DISTANCE))));
    })
    .onEnd(({ velocityX }) => {
      const projected = progress.get() + velocityX * 0.12 / (width * CARD_DRAG_DISTANCE);
      const base = Math.floor(dragStart.get());
      const target = Math.max(
        base - 1,
        Math.min(base + 1, Math.round(projected)),
      );
      settleTarget.set(target);
      progress.set(withSpring(target, {
        duration: 400,
        dampingRatio: 0.8,
        overshootClamping: true,
        velocity: velocityX / (width * CARD_DRAG_DISTANCE),
        reduceMotion: reduceMotion ? ReduceMotion.Always : ReduceMotion.Never,
      }, (finished) => {
        if (finished) scheduleOnRN(restartAutoplay, target);
      }));
    })
    .onFinalize((_event, success) => {
      if (success || !interactive.get()) return;
      const target = Math.round(progress.get());
      settleTarget.set(target);
      progress.set(withSpring(target, {
        duration: 400,
        dampingRatio: 1,
        reduceMotion: reduceMotion ? ReduceMotion.Always : ReduceMotion.Never,
      }, (finished) => {
        if (finished) scheduleOnRN(restartAutoplay, target);
      }));
    }), [active, dragStart, interaction, interactive, items.length, progress, reduceMotion, restartAutoplay, settleTarget, width]);

  const gesture = useMemo(
    () => interaction === 'tap' ? tapGesture : Gesture.Exclusive(panGesture, tapGesture),
    [interaction, panGesture, tapGesture],
  );

  const accessibilityLabel = featuredCards.length
    ? `Deck cover and featured card previews. ${featuredCards
        .map((card) => card.text)
        .join('. ')}`
    : `Deck cover for ${deck.title}`;

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityActions={[{ name: 'activate' }]}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={interaction === 'tap'
          ? 'Double tap to show the next card'
          : 'Swipe right for the next card or left for the previous card. Double tap to advance.'}
        accessibilityRole="button"
        accessibilityState={{ disabled: !active || items.length < 2 }}
        accessible
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') advanceForAccessibility();
        }}
        style={[styles.stack, { width }]}
      >
        {items.map((item, index) => (
          <DeckStackItem
            deck={deck}
            index={index}
            item={item}
            itemCount={items.length}
            key={item.key}
            progress={progress}
            interactive={interactive}
            reduceMotion={reduceMotion}
            width={width}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

function beginInteraction(progress: SharedValue<number>, interactive: SharedValue<boolean>) {
  'worklet';
  const current = progress.get();
  cancelAnimation(progress);
  if (interactive.get()) return current;
  const step = Math.floor(current);
  const phase = current - step;
  const manualProgress = step + Math.max(0, (phase - HOLD_END) / (1 - HOLD_END));
  interactive.set(true);
  progress.set(manualProgress);
  return manualProgress;
}

function DeckStackItem({
  deck,
  index,
  item,
  itemCount,
  progress,
  interactive,
  reduceMotion,
  width,
}: {
  deck: CatalogDeck;
  index: number;
  item: StackItem;
  itemCount: number;
  progress: SharedValue<number>;
  interactive: SharedValue<boolean>;
  reduceMotion: boolean;
  width: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const rawProgress = progress.get();
    const wholeStep = Math.floor(rawProgress);
    const step = ((wholeStep % itemCount) + itemCount) % itemCount;
    const fraction = rawProgress - wholeStep;
    const phase = interactive.get()
      ? HOLD_END + fraction * (1 - HOLD_END)
      : fraction;
    const distanceFromFront = (index - step + itemCount) % itemCount;

    if (distanceFromFront === 0) {
      if (phase <= HOLD_END || reduceMotion) {
        return {
          opacity: 1,
          transform: [
            { translateX: 0 },
            { translateY: 0 },
            { scale: 1 },
            { rotate: '-10deg' },
          ],
          zIndex: 3,
        };
      }

      if (phase <= SWIPE_END) {
        const swipeProgress = EASE_IN_OUT(
          (phase - HOLD_END) / (SWIPE_END - HOLD_END),
        );
        return {
          opacity: 1,
          transform: [
            { translateX: swipeProgress * width * 0.82 },
            { translateY: swipeProgress * 3 },
            { scale: 1 - swipeProgress * 0.02 },
            { rotate: `${-10 + swipeProgress * 18}deg` },
          ],
          zIndex: 3,
        };
      }

      const tuckProgress = EASE_OUT(
        (phase - SWIPE_END) / (1 - SWIPE_END),
      );
      return {
        opacity: 1,
        transform: [
          { translateX: width * 0.82 * (1 - tuckProgress) },
          { translateY: 3 + tuckProgress * 4 },
          { scale: 0.98 - tuckProgress * 0.04 },
          { rotate: `${8 - tuckProgress * 26}deg` },
        ],
        zIndex: 0,
      };
    }

    if (distanceFromFront === 1) {
      const revealProgress =
        phase <= HOLD_END
          ? 0
          : EASE_OUT((phase - HOLD_END) / (1 - HOLD_END));
      return {
        opacity: 1,
        transform: [
          { translateX: -6 + revealProgress * 6 },
          { translateY: 4 - revealProgress * 4 },
          { scale: 0.96 + revealProgress * 0.04 },
          { rotate: `${-16 + revealProgress * 6}deg` },
        ],
        zIndex: phase > SWIPE_END ? 3 : 2,
      };
    }

    if (distanceFromFront === 2) {
      const advanceProgress =
        phase <= HOLD_END
          ? 0
          : EASE_OUT((phase - HOLD_END) / (1 - HOLD_END));
      return {
        opacity: 0.62 + advanceProgress * 0.38,
        transform: [
          { translateX: -10 + advanceProgress * 4 },
          { translateY: 8 - advanceProgress * 4 },
          { scale: 0.92 + advanceProgress * 0.04 },
          { rotate: `${-21 + advanceProgress * 5}deg` },
        ],
        zIndex: phase > SWIPE_END ? 2 : 1,
      };
    }

    if (distanceFromFront === 3) {
      const advanceProgress =
        phase <= HOLD_END
          ? 0
          : EASE_OUT((phase - HOLD_END) / (1 - HOLD_END));
      return {
        opacity: advanceProgress * 0.62,
        transform: [
          { translateX: -13 + advanceProgress * 3 },
          { translateY: 11 - advanceProgress * 3 },
          { scale: 0.89 + advanceProgress * 0.03 },
          { rotate: `${-24 + advanceProgress * 3}deg` },
        ],
        zIndex: phase > SWIPE_END ? 1 : 0,
      };
    }

    return {
      opacity: 0,
      transform: [
        { translateX: 0 },
        { translateY: 8 },
        { scale: 0.92 },
        { rotate: '-21deg' },
      ],
      zIndex: 0,
    };
  });

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.item, animatedStyle]}
    >
      {item.kind === 'cover' ? (
        deck.coverUri || deck.coverImage ? (
          <Image
            contentFit="cover"
            source={deck.coverUri || deck.coverImage}
            style={styles.coverImage}
          />
        ) : (
          <View style={styles.coverFallback}>
            <Text style={styles.coverFallbackText}>{deck.title}</Text>
          </View>
        )
      ) : (
        <FeaturedCardFace card={item.card} posterWidth={width} />
      )}
    </Animated.View>
  );
}

function FeaturedCardFace({
  card,
  posterWidth,
}: {
  card: Card;
  posterWidth: number;
}) {
  const posterHeight = posterWidth * 1.5;

  return (
    <View
      style={[
        styles.featuredCardOutline,
        {
          height: posterWidth,
          left: (posterWidth - posterHeight) / 2,
          top: (posterHeight - posterWidth) / 2,
          width: posterHeight,
        },
      ]}
    >
      <View style={styles.featuredCard}>
        <Text numberOfLines={4} style={styles.featuredCardText}>
          {card.text}
        </Text>
        {card.byline ? (
          <Text numberOfLines={1} style={styles.featuredCardByline}>
            by {card.byline}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    aspectRatio: 2 / 3,
    position: 'relative',
  },
  item: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    borderRadius: 7,
    backgroundColor: colors.surface,
    boxShadow: '-10px 8px 9px rgba(0, 0, 0, 0.3)',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    borderRadius: 7,
  },
  coverFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.playSoft,
  },
  coverFallbackText: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: 'Inter_900Black',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  featuredCardOutline: {
    position: 'absolute',
    padding: 4,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    transform: [{ rotate: '90deg' }],
  },
  featuredCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radius.md,
    backgroundColor: colors.play,
  },
  featuredCardText: {
    color: colors.white,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: 'Inter_900Black',
    textAlign: 'center',
  },
  featuredCardByline: {
    color: colors.white,
    fontSize: 12,
    lineHeight: 15,
    fontFamily: 'Inter_700Bold',
    opacity: 0.78,
    textAlign: 'center',
  },
});

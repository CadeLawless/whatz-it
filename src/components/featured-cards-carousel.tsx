import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';
import type { Card } from '@/types/deck';

const CARD_WIDTH = 172;
const CARD_HEIGHT = 90;
const CARD_GAP = 12;
const PIXELS_PER_SECOND = 50;
const MANUAL_PAUSE_MS = 1_000;
const COAST_DURATION_MS = 320;
const COAST_DISTANCE_PER_VELOCITY = 0.18;
const MAX_COAST_DISTANCE = 240;
const MINIMUM_FEATURED_CARDS = 3;

function loopOffset(value: number, cycleWidth: number) {
  'worklet';
  return -1.5 * cycleWidth + (((value + 1.5 * cycleWidth) % cycleWidth) + cycleWidth) % cycleWidth;
}

export function FeaturedCardsCarousel({
  cards,
  isBundleDeck,
}: {
  cards: Card[] | undefined;
  isBundleDeck: boolean;
}) {
  const featuredCards = cards ?? [];
  const canAnimate = featuredCards.length >= MINIMUM_FEATURED_CARDS;
  const cycleWidth = featuredCards.length * (CARD_WIDTH + CARD_GAP);
  const cardKey = featuredCards.map((card) => card.id).join(':');
  const offset = useSharedValue(-cycleWidth);
  const dragStart = useSharedValue(0);
  const dragging = useSharedValue(false);
  const coasting = useSharedValue(false);
  const pauseRemaining = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(offset);
    offset.set(-cycleWidth);
    dragging.set(false);
    coasting.set(false);
    pauseRemaining.set(0);
    return () => cancelAnimation(offset);
  }, [cardKey, cycleWidth, offset, dragging, coasting, pauseRemaining]);

  useFrameCallback((frame) => {
    if (!canAnimate || cycleWidth === 0) return;
    const elapsedMs = Math.min(frame.timeSincePreviousFrame ?? 0, 50);
    if (pauseRemaining.get() > 0) {
      pauseRemaining.set(Math.max(0, pauseRemaining.get() - elapsedMs));
    }
    if (dragging.get() || coasting.get() || pauseRemaining.get() > 0) return;
    offset.set(loopOffset(offset.get() - PIXELS_PER_SECOND * elapsedMs / 1000, cycleWidth));
  });

  const panGesture = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .hitSlop({ left: -32 })
    .onTouchesDown(() => {
      if (dragging.get()) return;
      cancelAnimation(offset);
      dragStart.set(offset.get());
      dragging.set(true);
      coasting.set(false);
      pauseRemaining.set(0);
    })
    .onStart(() => {
      if (!dragging.get()) {
        cancelAnimation(offset);
        dragStart.set(offset.get());
        dragging.set(true);
        coasting.set(false);
      }
    })
    .onUpdate((event) => {
      offset.set(dragStart.get() + event.translationX);
    })
    .onEnd((event) => {
      dragging.set(false);
      pauseRemaining.set(MANUAL_PAUSE_MS);
      const travel = Math.max(
        -MAX_COAST_DISTANCE,
        Math.min(MAX_COAST_DISTANCE, event.velocityX * COAST_DISTANCE_PER_VELOCITY),
      );
      if (Math.abs(travel) < 4) {
        offset.set(loopOffset(offset.get(), cycleWidth));
        return;
      }
      coasting.set(true);
      offset.set(withTiming(offset.get() + travel, {
        duration: COAST_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      }, (finished) => {
        if (finished) offset.set(loopOffset(offset.get(), cycleWidth));
        coasting.set(false);
      }));
    })
    .onFinalize(() => {
      if (!dragging.get()) return;
      dragging.set(false);
      pauseRemaining.set(MANUAL_PAUSE_MS);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cycleWidth > 0 ? loopOffset(offset.get(), cycleWidth) : 0 }],
  }));

  if (!canAnimate) return null;

  return (
    <View style={[styles.section, isBundleDeck && styles.bundleSection]}>
      <Text accessibilityRole="header" style={styles.label}>A PEEK INSIDE</Text>
      <GestureDetector gesture={panGesture}>
        <View style={styles.viewport}>
          <Animated.View style={[styles.track, { width: cycleWidth * 3 + spacing.lg }, animatedStyle]}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <CardSequence cards={featuredCards} />
            </View>
            <CardSequence cards={featuredCards} />
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <CardSequence cards={featuredCards} />
            </View>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

function CardSequence({ cards }: { cards: Card[] }) {
  return (
    <View style={styles.sequence}>
      {cards.map((card) => <PreviewCard card={card} key={card.id} />)}
    </View>
  );
}

function PreviewCard({ card }: { card: Card }) {
  return (
    <View
      accessible
      accessibilityLabel={card.byline ? `${card.text}, by ${card.byline}` : card.text}
      style={styles.cardOutline}
    >
      <View style={styles.card}>
        <Text numberOfLines={3} style={styles.cardText}>{card.text}</Text>
        {card.byline ? (
          <Text numberOfLines={1} style={styles.byline}>by {card.byline}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginHorizontal: -spacing.lg,
  },
  bundleSection: {marginHorizontal: 0},
  label: {
    paddingHorizontal: spacing.lg,
    color: colors.play,
    fontSize: 18,
    fontFamily: 'Inter_900Black',
    letterSpacing: 0.2,
  },
  viewport: {
    overflow: 'hidden',
    paddingVertical: 5,
  },
  track: {
    flexDirection: 'row',
    paddingLeft: spacing.lg,
  },
  sequence: {
    flexDirection: 'row',
    flexShrink: 0,
    gap: CARD_GAP,
    paddingRight: CARD_GAP,
  },
  cardOutline: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderWidth: 3,
    borderColor: '#439EFE',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: '0 4px 9px rgba(15, 23, 42, 0.18)',
  },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.md,
    borderRadius: radius.lg - 3,
    backgroundColor: colors.surface,
  },
  cardText: {
    color: colors.play,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: 'Inter_900Black',
    textAlign: 'center',
  },
  byline: {
    color: colors.play,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: 'Inter_700Bold',
    opacity: 0.82,
    textAlign: 'center',
  },
});

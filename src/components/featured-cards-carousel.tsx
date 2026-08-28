import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';
import type { Card } from '@/types/deck';

const CARD_WIDTH = 172;
const CARD_HEIGHT = 90;
const CARD_GAP = 12;
const PIXELS_PER_SECOND = 34;
const MINIMUM_FEATURED_CARDS = 3;

export function FeaturedCardsCarousel({ cards }: { cards: Card[] | undefined }) {
  const featuredCards = cards ?? [];
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const cycleWidth = featuredCards.length * (CARD_WIDTH + CARD_GAP);
  const cardKey = featuredCards.map((card) => card.id).join(':');

  useEffect(() => {
    cancelAnimation(offset);
    offset.set(0);
    if (reduceMotion || featuredCards.length < MINIMUM_FEATURED_CARDS) return;

    offset.set(
      withRepeat(
        withTiming(-cycleWidth, {
          duration: Math.round((cycleWidth / PIXELS_PER_SECOND) * 1000),
          easing: Easing.linear,
        }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(offset);
  }, [cardKey, cycleWidth, featuredCards.length, offset, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));

  if (featuredCards.length < MINIMUM_FEATURED_CARDS) return null;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.label}>A PEEK INSIDE</Text>
      {reduceMotion ? (
        <ScrollView
          horizontal
          contentContainerStyle={styles.staticTrack}
          showsHorizontalScrollIndicator={false}
        >
          {featuredCards.map((card) => <PreviewCard card={card} key={card.id} />)}
        </ScrollView>
      ) : (
        <View style={styles.viewport}>
          <Animated.View style={[styles.animatedTrack, animatedStyle]}>
            <CardSequence cards={featuredCards} />
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <CardSequence cards={featuredCards} />
            </View>
          </Animated.View>
        </View>
      )}
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
  label: {
    paddingHorizontal: spacing.lg,
    color: colors.play,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  viewport: {
    overflow: 'hidden',
    paddingVertical: 5,
  },
  animatedTrack: {
    flexDirection: 'row',
    paddingLeft: spacing.lg,
  },
  staticTrack: {
    gap: CARD_GAP,
    paddingHorizontal: spacing.lg,
    paddingVertical: 5,
  },
  sequence: {
    flexDirection: 'row',
    gap: CARD_GAP,
    paddingRight: CARD_GAP,
  },
  cardOutline: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    padding: 3,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    boxShadow: '0 4px 9px rgba(15, 23, 42, 0.18)',
  },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radius.md,
    backgroundColor: colors.play,
  },
  cardText: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  byline: {
    color: colors.white,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    opacity: 0.78,
    textAlign: 'center',
  },
});

import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

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

type StackItem =
  | { key: string; kind: 'cover' }
  | { card: Card; key: string; kind: 'featured-card' };

export function FeaturedCardsDeckStack({
  deck,
  width,
}: {
  deck: CatalogDeck;
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
  const itemKey = items.map(({ key }) => key).join(':');

  useEffect(() => {
    cancelAnimation(progress);
    progress.set(0);

    if (reduceMotion || items.length < 2) return;

    progress.set(
      withRepeat(
        withTiming(items.length, {
          duration: items.length * STEP_DURATION,
          easing: Easing.linear,
        }),
        -1,
        false,
      ),
    );

    return () => cancelAnimation(progress);
  }, [itemKey, items.length, progress, reduceMotion]);

  const accessibilityLabel = featuredCards.length
    ? `Deck cover and featured card previews. ${featuredCards
        .map((card) => card.text)
        .join('. ')}`
    : `Deck cover for ${deck.title}`;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessible
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
          reduceMotion={reduceMotion}
          width={width}
        />
      ))}
    </View>
  );
}

function DeckStackItem({
  deck,
  index,
  item,
  itemCount,
  progress,
  reduceMotion,
  width,
}: {
  deck: CatalogDeck;
  index: number;
  item: StackItem;
  itemCount: number;
  progress: SharedValue<number>;
  reduceMotion: boolean;
  width: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const rawProgress = progress.get();
    const step = Math.floor(rawProgress) % itemCount;
    const phase = rawProgress - Math.floor(rawProgress);
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
    fontWeight: '900',
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
    fontWeight: '900',
    textAlign: 'center',
  },
  featuredCardByline: {
    color: colors.white,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    opacity: 0.78,
    textAlign: 'center',
  },
});

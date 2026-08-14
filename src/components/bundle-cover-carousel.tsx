import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { CatalogDeck } from '@/catalog/catalog-snapshot';
import { colors, spacing } from '@/theme';

const CARD_WIDTH = 138;
const CARD_GAP = 14;
const AUTO_ADVANCE_MS = 5_500;
const MANUAL_PAUSE_MS = 12_000;

export function BundleCoverCarousel({
  decks,
  onDeckPress,
}: {
  decks: CatalogDeck[];
  onDeckPress: (deck: CatalogDeck) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const currentIndex = useRef(0);
  const manualPauseUntil = useRef(0);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotionEnabled(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotionEnabled,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotionEnabled || decks.length < 2) return;
    const timer = setInterval(() => {
      if (Date.now() < manualPauseUntil.current) return;
      const nextIndex = (currentIndex.current + 1) % decks.length;
      currentIndex.current = nextIndex;
      scrollRef.current?.scrollTo({
        animated: true,
        x: nextIndex * (CARD_WIDTH + CARD_GAP),
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [decks.length, reduceMotionEnabled]);

  const handleMomentumEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    currentIndex.current = Math.max(
      0,
      Math.min(
        decks.length - 1,
        Math.round(event.nativeEvent.contentOffset.x / (CARD_WIDTH + CARD_GAP)),
      ),
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>INCLUDED DECKS</Text>
        <Text style={styles.count}>{decks.length}</Text>
      </View>
      <ScrollView
        accessibilityLabel={`${decks.length} included decks`}
        contentContainerStyle={styles.track}
        decelerationRate="fast"
        horizontal
        onMomentumScrollEnd={handleMomentumEnd}
        onScrollBeginDrag={() => {
          manualPauseUntil.current = Date.now() + MANUAL_PAUSE_MS;
        }}
        ref={scrollRef}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_GAP}
      >
        {decks.map((deck, index) => (
          <Pressable
            accessibilityHint="Opens a deck preview"
            accessibilityLabel={`${deck.title}, deck ${index + 1} of ${decks.length}`}
            accessibilityRole="button"
            key={deck.id}
            onPress={() => onDeckPress(deck)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <View style={styles.cover}>
              {deck.coverUri || deck.coverImage ? (
                <Image
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  source={deck.coverUri || deck.coverImage}
                  style={StyleSheet.absoluteFill}
                />
              ) : (
                <View style={styles.coverFallback}>
                  <Text style={styles.coverFallbackText}>{deck.title}</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
      {reduceMotionEnabled && decks.length > 1 && (
        <Text accessibilityLiveRegion="polite" style={styles.motionNote}>
          Automatic movement is off. Swipe to browse included decks.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    color: colors.play,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  count: {
    minWidth: 30,
    paddingVertical: 5,
    paddingHorizontal: 9,
    overflow: 'hidden',
    borderRadius: 15,
    backgroundColor: '#EAF4FF',
    color: colors.play,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  track: { gap: CARD_GAP, paddingRight: spacing.lg },
  item: { width: CARD_WIDTH },
  cover: {
    width: CARD_WIDTH,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: colors.playSoft,
    boxShadow: '0 5px 14px rgba(15, 23, 42, 0.16)',
  },
  coverFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  coverFallbackText: {
    color: colors.ink,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '900',
  },
  motionNote: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});

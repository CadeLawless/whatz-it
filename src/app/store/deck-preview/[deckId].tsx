import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInLeft,
  FadeInRight,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCatalog } from '@/catalog/catalog-provider';
import { DeckDetailsHeader } from '@/components/deck-details-header';
import { colors, radius, spacing } from '@/theme';

export default function DeckPreviewSheet() {
  const { catalog } = useCatalog();
  const { bundleId, deckId } = useLocalSearchParams<{
    bundleId?: string;
    deckId: string;
  }>();
  const router = useRouter();
  const bundle = catalog.getBundleById(bundleId);
  const [activeDeckId, setActiveDeckId] = useState(deckId);
  const [slideDirection, setSlideDirection] = useState<'previous' | 'next' | null>(null);
  const reduceMotion = useReducedMotion();
  const deck = catalog.getDeckById(activeDeckId);
  const bundleDecks = useMemo(() => bundle?.decks ?? [], [bundle]);
  const activeIndex = bundleDecks.findIndex(({ id }) => id === activeDeckId);
  const canBrowseBundle = bundleDecks.length > 1 && activeIndex >= 0;

  const showAdjacentDeck = useCallback(
    (offset: -1 | 1) => {
      const currentIndex = bundleDecks.findIndex(({ id }) => id === activeDeckId);
      const adjacentDeck = bundleDecks[currentIndex + offset];
      if (!adjacentDeck) return;

      setSlideDirection(offset > 0 ? 'next' : 'previous');
      setActiveDeckId(adjacentDeck.id);
    },
    [activeDeckId, bundleDecks],
  );

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canBrowseBundle)
        .activeOffsetX([-24, 24])
        .failOffsetY([-18, 18])
        .onEnd(({ translationX, velocityX }) => {
          if (translationX <= -54 || velocityX <= -520) {
            runOnJS(showAdjacentDeck)(1);
          } else if (translationX >= 54 || velocityX >= 520) {
            runOnJS(showAdjacentDeck)(-1);
          }
        }),
    [canBrowseBundle, showAdjacentDeck],
  );

  const enteringAnimation =
    reduceMotion || !slideDirection
      ? undefined
      : slideDirection === 'next'
        ? FadeInRight.duration(180)
        : FadeInLeft.duration(180);

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {deck ? (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityLabel="Close preview"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.pressed,
            ]}
          >
            <Text accessibilityElementsHidden style={styles.closeButtonText}>
              ×
            </Text>
          </Pressable>
          <GestureDetector gesture={swipeGesture}>
            <Animated.View
              entering={enteringAnimation}
              key={deck.id}
              style={styles.previewBody}
            >
              <DeckDetailsHeader
                backLabel="Close Preview"
                deck={deck}
                onBack={() => router.back()}
                showBackButton={false}
              />
              {canBrowseBundle && (
                <View style={styles.deckNavigation}>
                  <Pressable
                    accessibilityLabel="Previous deck"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: activeIndex <= 0 }}
                    disabled={activeIndex <= 0}
                    hitSlop={8}
                    onPress={() => showAdjacentDeck(-1)}
                    style={({ pressed }) => [
                      styles.deckNavigationButton,
                      activeIndex <= 0 && styles.deckNavigationButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text accessibilityElementsHidden style={styles.deckNavigationArrow}>‹</Text>
                  </Pressable>
                  <View style={styles.deckNavigationCopy}>
                    <Text style={styles.deckNavigationHint}>SWIPE TO BROWSE</Text>
                    <Text style={styles.deckNavigationCount}>
                      {activeIndex + 1} OF {bundleDecks.length}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Next deck"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: activeIndex >= bundleDecks.length - 1 }}
                    disabled={activeIndex >= bundleDecks.length - 1}
                    hitSlop={8}
                    onPress={() => showAdjacentDeck(1)}
                    style={({ pressed }) => [
                      styles.deckNavigationButton,
                      activeIndex >= bundleDecks.length - 1 &&
                        styles.deckNavigationButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text accessibilityElementsHidden style={styles.deckNavigationArrow}>›</Text>
                  </Pressable>
                </View>
              )}
              {bundle && (
                <View style={styles.copy}>
                  <Text style={styles.bundleName}>From {bundle.title}</Text>
                </View>
              )}
              {deck.access === 'paid' && (
                <View style={styles.purchaseArea}>
                  <View
                    accessibilityLabel="Purchase Single Deck, coming soon"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: true }}
                    style={styles.purchaseButton}
                  >
                    <Text style={styles.purchaseButtonText}>
                      PURCHASE SINGLE DECK
                    </Text>
                  </View>
                  <Text style={styles.purchaseNote}>
                    Secure in-app purchasing is coming soon.
                  </Text>
                </View>
              )}
            </Animated.View>
          </GestureDetector>
        </ScrollView>
      ) : (
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>Deck not found</Text>
          <Text style={styles.description}>This deck is no longer available.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    flexGrow: 1,
    gap: spacing.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  closeButton: {
    alignSelf: 'flex-end',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.surface,
    boxShadow: '0 4px 12px rgba(100, 116, 139, 0.18)',
  },
  closeButtonText: {
    color: colors.ink,
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '300',
  },
  previewBody: { gap: spacing.xl },
  deckNavigation: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  deckNavigationButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: colors.surface,
    boxShadow: '0 3px 10px rgba(100, 116, 139, 0.17)',
  },
  deckNavigationButtonDisabled: { opacity: 0.28 },
  deckNavigationArrow: {
    color: colors.ink,
    fontSize: 35,
    lineHeight: 38,
    fontWeight: '300',
  },
  deckNavigationCopy: { flex: 1, alignItems: 'center', gap: 3 },
  deckNavigationHint: {
    color: colors.play,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  deckNavigationCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  copy: { gap: 10 },
  bundleName: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  purchaseArea: { gap: spacing.sm },
  purchaseButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: '#CBD5E1',
  },
  purchaseButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  purchaseNote: {
    color: colors.muted,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
  },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  notFoundTitle: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});

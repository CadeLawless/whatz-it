import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
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
  const { width } = useWindowDimensions();
  const bundle = catalog.getBundleById(bundleId);
  const [activeDeckId, setActiveDeckId] = useState(deckId);
  const reduceMotion = useReducedMotion();
  const headerTranslation = useSharedValue(0);
  const deck = catalog.getDeckById(activeDeckId);
  const bundleDecks = useMemo(() => bundle?.decks ?? [], [bundle]);
  const activeIndex = bundleDecks.findIndex(({ id }) => id === activeDeckId);
  const canBrowseBundle = bundleDecks.length > 1 && activeIndex >= 0;

  const commitAdjacentDeck = useCallback(
    (offset: -1 | 1) => {
      const currentIndex = bundleDecks.findIndex(({ id }) => id === activeDeckId);
      const adjacentDeck = bundleDecks[currentIndex + offset];
      if (!adjacentDeck) return;

      if (!reduceMotion) {
        headerTranslation.set(offset * width);
      } else {
        headerTranslation.set(0);
      }
      setActiveDeckId(adjacentDeck.id);

      if (!reduceMotion) {
        requestAnimationFrame(() => {
          headerTranslation.set(withTiming(0, { duration: 180 }));
        });
      }
    },
    [activeDeckId, bundleDecks, headerTranslation, reduceMotion, width],
  );

  const showAdjacentDeck = useCallback(
    (offset: -1 | 1) => {
      const currentIndex = bundleDecks.findIndex(({ id }) => id === activeDeckId);
      if (!bundleDecks[currentIndex + offset]) return;

      if (reduceMotion) {
        commitAdjacentDeck(offset);
        return;
      }

      headerTranslation.set(
        withTiming(-offset * width, { duration: 140 }, (finished) => {
          if (finished) runOnJS(commitAdjacentDeck)(offset);
        }),
      );
    },
    [
      activeDeckId,
      bundleDecks,
      commitAdjacentDeck,
      headerTranslation,
      reduceMotion,
      width,
    ],
  );

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canBrowseBundle)
        .activeOffsetX([-24, 24])
        .failOffsetY([-18, 18])
        .onBegin(() => {
          cancelAnimation(headerTranslation);
        })
        .onUpdate(({ translationX }) => {
          const isPastFirstDeck = translationX > 0 && activeIndex <= 0;
          const isPastLastDeck =
            translationX < 0 && activeIndex >= bundleDecks.length - 1;
          headerTranslation.set(
            isPastFirstDeck || isPastLastDeck
              ? translationX * 0.18
              : translationX,
          );
        })
        .onEnd(({ translationX, velocityX }) => {
          if (
            activeIndex < bundleDecks.length - 1 &&
            (translationX <= -54 || velocityX <= -520)
          ) {
            runOnJS(showAdjacentDeck)(1);
          } else if (
            activeIndex > 0 &&
            (translationX >= 54 || velocityX >= 520)
          ) {
            runOnJS(showAdjacentDeck)(-1);
          } else {
            headerTranslation.set(
              withSpring(0, {
                damping: 20,
                stiffness: 240,
              }),
            );
          }
        }),
    [
      activeIndex,
      bundleDecks.length,
      canBrowseBundle,
      headerTranslation,
      showAdjacentDeck,
    ],
  );

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: headerTranslation.get() }],
  }));

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
          <View style={styles.previewBody}>
            <GestureDetector gesture={swipeGesture}>
              <Animated.View style={headerAnimatedStyle}>
                <DeckDetailsHeader
                  backLabel="Close Preview"
                  deck={deck}
                  onBack={() => router.back()}
                  showBackButton={false}
                />
              </Animated.View>
            </GestureDetector>
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
                  <Text
                    accessibilityElementsHidden
                    style={styles.deckNavigationArrow}
                  >
                    ‹
                  </Text>
                </Pressable>
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.deckNavigationCount}
                >
                  {activeIndex + 1} OF {bundleDecks.length}
                </Text>
                <Pressable
                  accessibilityLabel="Next deck"
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: activeIndex >= bundleDecks.length - 1,
                  }}
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
                  <Text
                    accessibilityElementsHidden
                    style={styles.deckNavigationArrow}
                  >
                    ›
                  </Text>
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
                  accessibilityLabel={`Purchase ${deck.title}, coming soon`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  style={styles.purchaseButton}
                >
                  <Text style={styles.purchaseButtonText}>
                    PURCHASE THIS DECK
                  </Text>
                </View>
                <Text style={styles.purchaseNote}>
                  Secure in-app purchasing is coming soon.
                </Text>
              </View>
            )}
          </View>
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
  deckNavigationCount: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
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

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
  const bundleDecks = useMemo(() => bundle?.decks ?? [], [bundle]);
  const initialIndex = Math.max(
    0,
    bundleDecks.findIndex(({ id }) => id === deckId),
  );
  const [activeDeckId, setActiveDeckId] = useState(deckId);
  const reduceMotion = useReducedMotion();
  const pageOffset = useSharedValue(-initialIndex);
  const gestureStartOffset = useSharedValue(-initialIndex);
  const deck = catalog.getDeckById(activeDeckId);
  const carouselDecks = bundleDecks.length > 0 ? bundleDecks : deck ? [deck] : [];
  const activeIndex = bundleDecks.findIndex(({ id }) => id === activeDeckId);
  const visibleCarouselIndex = Math.max(0, activeIndex);
  const canBrowseBundle = bundleDecks.length > 1 && activeIndex >= 0;
  const pageWidth = Math.max(1, width - spacing.lg * 2);
  const pageStride = pageWidth + spacing.md;

  const showDeckAtIndex = useCallback(
    (targetIndex: number) => {
      const targetDeck = bundleDecks[targetIndex];
      if (!targetDeck) return;

      setActiveDeckId(targetDeck.id);
      pageOffset.set(
        reduceMotion
          ? -targetIndex
          : withTiming(-targetIndex, { duration: 180 }),
      );
    },
    [bundleDecks, pageOffset, reduceMotion],
  );

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canBrowseBundle)
        .activeOffsetX([-24, 24])
        .failOffsetY([-18, 18])
        .onStart(() => {
          cancelAnimation(pageOffset);
          gestureStartOffset.set(pageOffset.get());
        })
        .onUpdate(({ translationX }) => {
          const proposedOffset =
            gestureStartOffset.get() + translationX / pageStride;
          const lastOffset = -(bundleDecks.length - 1);

          if (proposedOffset > 0) {
            pageOffset.set(proposedOffset * 0.18);
          } else if (proposedOffset < lastOffset) {
            pageOffset.set(
              lastOffset + (proposedOffset - lastOffset) * 0.18,
            );
          } else {
            pageOffset.set(proposedOffset);
          }
        })
        .onEnd(({ translationX, velocityX }) => {
          let targetIndex = activeIndex;

          if (
            activeIndex < bundleDecks.length - 1 &&
            (translationX <= -54 || velocityX <= -520)
          ) {
            targetIndex += 1;
          } else if (
            activeIndex > 0 &&
            (translationX >= 54 || velocityX >= 520)
          ) {
            targetIndex -= 1;
          }

          if (targetIndex !== activeIndex) {
            runOnJS(showDeckAtIndex)(targetIndex);
            return;
          }

          pageOffset.set(
            reduceMotion
              ? -activeIndex
              : withSpring(-activeIndex, {
                  damping: 20,
                  stiffness: 240,
                }),
          );
        }),
    [
      activeIndex,
      bundleDecks.length,
      canBrowseBundle,
      gestureStartOffset,
      pageOffset,
      pageStride,
      reduceMotion,
      showDeckAtIndex,
    ],
  );

  const carouselAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pageOffset.get() * pageStride }],
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
          <View style={styles.sheetHeader}>
            <Text numberOfLines={2} style={styles.sheetTitle}>
              {bundle?.title ?? 'Deck Preview'}
            </Text>
            <Pressable
              accessibilityLabel="Close preview"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.back()}
              style={styles.closeButton}
            >
              <Text accessibilityElementsHidden style={styles.closeButtonText}>
                ×
              </Text>
            </Pressable>
          </View>
          <View style={styles.previewBody}>
            <GestureDetector gesture={swipeGesture}>
              <View style={styles.carouselViewport}>
                <Animated.View
                  style={[styles.carouselTrack, carouselAnimatedStyle]}
                >
                  {carouselDecks.map((carouselDeck, index) => (
                    <View
                      accessibilityElementsHidden={
                        index !== visibleCarouselIndex
                      }
                      importantForAccessibility={
                        index === visibleCarouselIndex
                          ? 'auto'
                          : 'no-hide-descendants'
                      }
                      key={carouselDeck.id}
                      style={[styles.carouselPage, { width: pageWidth }]}
                    >
                      <DeckDetailsHeader
                        backLabel="Close Preview"
                        deck={carouselDeck}
                        onBack={() => router.back()}
                        showBackButton={false}
                      />
                    </View>
                  ))}
                </Animated.View>
              </View>
            </GestureDetector>
            {canBrowseBundle && (
              <View style={styles.deckNavigation}>
                <Pressable
                  accessibilityLabel="Previous deck"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: activeIndex <= 0 }}
                  disabled={activeIndex <= 0}
                  hitSlop={8}
                  onPress={() => showDeckAtIndex(activeIndex - 1)}
                  style={[
                    styles.deckNavigationButton,
                    activeIndex <= 0 && styles.deckNavigationButtonDisabled,
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
                  onPress={() => showDeckAtIndex(activeIndex + 1)}
                  style={[
                    styles.deckNavigationButton,
                    activeIndex >= bundleDecks.length - 1 &&
                      styles.deckNavigationButtonDisabled,
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
  sheetHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  sheetTitle: {
    flex: 1,
    color: colors.ink,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
  },
  closeButton: {
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
  carouselViewport: { overflow: 'hidden' },
  carouselTrack: { flexDirection: 'row', gap: spacing.md },
  carouselPage: { flexShrink: 0 },
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
});

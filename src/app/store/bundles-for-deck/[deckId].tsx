import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCatalog } from '@/catalog/catalog-provider';
import { AppSheet, type AppSheetRef } from '@/components/app-sheet';
import { CatalogCoverImage } from '@/components/catalog-cover-image';
import { CircularCloseButton } from '@/components/circular-close-button';
import { colors, radius, spacing } from '@/theme';

const FAN_WIDTH = 96;
const FAN_CARD_WIDTH = 48;
const FAN_SPREAD = 8;

export default function BundlesForDeckSheet() {
  const { catalog } = useCatalog();
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const router = useRouter();
  const sheetRef = useRef<AppSheetRef>(null);
  const deck = catalog.getDeckById(deckId);
  const bundles = catalog.getBundlesForDeck(deckId);

  return (
    <AppSheet
      accessibilityLabel="Bundles containing this deck"
      heightFraction={0.62}
      onClose={() => router.back()}
      ref={sheetRef}
    >
      <SafeAreaView edges={['bottom']} style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Bundles</Text>
            <Text style={styles.subtitle}>
              {deck ? `Bundles containing ${deck.title}` : 'Bundles containing this deck'}
            </Text>
          </View>
          <CircularCloseButton
            accessibilityLabel="Close bundle list"
            appearance="sheet"
            onPress={() => sheetRef.current?.close()}
            style={styles.closeButton}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
        >
          {bundles.map((bundle) => {
            const previewDecks = bundle.decks.slice(0, 4);
            const fanCenter = (previewDecks.length - 1) / 2;
            const fanStart = (FAN_WIDTH - (FAN_CARD_WIDTH + (previewDecks.length - 1) * FAN_SPREAD)) / 2;
            return (
              <Pressable
                accessibilityHint="Opens bundle details"
                accessibilityRole="link"
                key={bundle.id}
                onPress={() =>
                  router.replace({
                    pathname: '/store/bundle/[bundleId]',
                    params: { bundleId: bundle.id, fromDeckId: deckId },
                  })
                }
                style={({ pressed }) => [styles.bundleRow, pressed && styles.pressed]}
              >
                <View accessibilityElementsHidden style={styles.bundleFanFrame}>
                  <View style={[styles.bundleFan, { transform: [{ rotate: `${-fanCenter * 8}deg` }] }]}>
                    {previewDecks.map((previewDeck, index) => {
                      const fanIndex = previewDecks.length - 1 - index;
                      return (
                        <View
                          key={previewDeck.id}
                          style={[
                            styles.fanCard,
                            {
                              left: fanStart + fanIndex * FAN_SPREAD,
                              top: 9 + Math.abs(fanIndex - fanCenter) * 2.5,
                              transform: [{ rotate: `${(fanIndex - fanCenter) * 8}deg` }],
                              zIndex: previewDecks.length - index,
                            },
                          ]}
                        >
                          <CatalogCoverImage
                            cachePolicy="memory-disk"
                            contentFit="cover"
                            deck={previewDeck}
                            fallback={<View style={styles.coverFallback} />}
                            style={StyleSheet.absoluteFill}
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.bundleCopy}>
                  <Text style={styles.bundleTitle}>{bundle.title}</Text>
                  <Text numberOfLines={2} style={styles.bundleDescription}>
                    {bundle.description || `${bundle.decks.length} decks in one collection.`}
                  </Text>
                  <Text style={styles.bundleMeta}>{bundle.decks.length} DECKS</Text>
                </View>
                <Text accessibilityElementsHidden style={styles.rowChevron}>›</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </AppSheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    zIndex: 10,
    elevation: 10,
    backgroundColor: colors.surface,
  },
  headerCopy: { flex: 1, gap: 3 },
  closeButton: {
    position: 'relative',
  },
  title: { color: colors.ink, fontSize: 28, fontFamily: 'Inter_900Black', fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  list: { gap: 12, padding: spacing.lg, paddingTop: spacing.sm },
  bundleRow: {
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  bundleFanFrame: { width: FAN_WIDTH, height: 92, justifyContent: 'center', alignItems: 'center' },
  bundleFan: { width: FAN_WIDTH, height: 92 },
  fanCard: {
    width: FAN_CARD_WIDTH,
    aspectRatio: 2 / 3,
    position: 'absolute',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    borderRadius: 6,
    backgroundColor: colors.playSoft,
    boxShadow: '0 3px 7px rgba(15, 23, 42, 0.20)',
  },
  coverFallback: { flex: 1, backgroundColor: colors.playSoft },
  bundleCopy: { flex: 1, gap: 6 },
  bundleTitle: { color: colors.ink, fontSize: 17, fontFamily: 'Inter_900Black', fontWeight: '900' },
  bundleDescription: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  bundleMeta: {
    color: colors.play,
    fontSize: 10,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.45,
  },
  rowChevron: { color: colors.play, fontSize: 28, fontFamily: 'Inter_400Regular', fontWeight: '400' },
  pressed: { opacity: 0.72 },
});

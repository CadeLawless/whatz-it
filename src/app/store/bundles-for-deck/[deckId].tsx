import { Image } from 'expo-image';
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
import { CircularCloseButton } from '@/components/circular-close-button';
import { colors, radius, spacing } from '@/theme';

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
            onPress={() => sheetRef.current?.close()}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
        >
          {bundles.map((bundle) => {
            const previewDeck = bundle.decks[0];
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
                <View style={styles.bundleCover}>
                  {previewDeck?.coverUri || previewDeck?.coverImage ? (
                    <Image
                      accessibilityLabel={`${bundle.title} bundle preview`}
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      source={previewDeck.coverUri || previewDeck.coverImage}
                      style={StyleSheet.absoluteFill}
                    />
                  ) : (
                    <View style={styles.coverFallback} />
                  )}
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
  },
  headerCopy: { flex: 1, gap: 3 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
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
  bundleCover: {
    width: 68,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    borderRadius: 7,
    backgroundColor: colors.playSoft,
  },
  coverFallback: { flex: 1, backgroundColor: colors.playSoft },
  bundleCopy: { flex: 1, gap: 6 },
  bundleTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  bundleDescription: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  bundleMeta: {
    color: colors.play,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.45,
  },
  rowChevron: { color: colors.play, fontSize: 28, fontWeight: '400' },
  pressed: { opacity: 0.72 },
});

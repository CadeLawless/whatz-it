import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCatalog } from '@/catalog/catalog-provider';
import { colors, radius, spacing } from '@/theme';

export default function DeckPreviewSheet() {
  const { catalog } = useCatalog();
  const { bundleId, deckId } = useLocalSearchParams<{
    bundleId?: string;
    deckId: string;
  }>();
  const router = useRouter();
  const deck = catalog.getDeckById(deckId);
  const bundle = catalog.getBundleById(bundleId);
  const uniqueTags = deck
    ? [
        ...new Map(
          deck.tags
            .map((tag) => tag.trim())
            .filter(Boolean)
            .map((tag) => [tag.toLocaleLowerCase(), tag]),
        ).values(),
      ]
    : [];

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>DECK PREVIEW</Text>
          {bundle && <Text style={styles.bundleName}>From {bundle.title}</Text>}
        </View>
        <Pressable
          accessibilityLabel="Close deck preview"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>

      {deck ? (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.cover}>
            {deck.coverUri || deck.coverImage ? (
              <Image
                accessibilityLabel={`${deck.title} cover`}
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
          <View style={styles.copy}>
            <Text style={styles.title}>{deck.title}</Text>
            <Text style={styles.description}>{deck.description}</Text>
            <Text style={styles.cardCount}>{deck.cardCount} CARDS</Text>
            {uniqueTags.length > 0 && (
              <View style={styles.tags}>
                {uniqueTags.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          {deck.access === 'paid' && (
            <Pressable
              accessibilityHint="Opens individual deck details"
              accessibilityRole="button"
              onPress={() =>
                router.replace({
                  pathname: '/store/deck/[deckId]',
                  params: { deckId: deck.id },
                })
              }
              style={({ pressed }) => [styles.detailsButton, pressed && styles.pressed]}
            >
              <Text style={styles.detailsButtonText}>VIEW DECK DETAILS</Text>
            </Pressable>
          )}
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
  eyebrow: {
    color: colors.play,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  bundleName: { color: colors.muted, fontSize: 13 },
  closeButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  closeText: { color: colors.ink, fontSize: 28, lineHeight: 30, fontWeight: '500' },
  content: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  cover: {
    width: '52%',
    maxWidth: 220,
    aspectRatio: 2 / 3,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: colors.playSoft,
    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
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
    fontSize: 20,
    fontWeight: '900',
  },
  copy: { alignSelf: 'stretch', gap: 10 },
  title: { color: colors.ink, fontSize: 28, lineHeight: 33, fontWeight: '900' },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  cardCount: {
    color: colors.play,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#EAF4FF',
  },
  tagText: {
    color: colors.play,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  detailsButton: {
    minHeight: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.play,
  },
  detailsButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  notFoundTitle: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});

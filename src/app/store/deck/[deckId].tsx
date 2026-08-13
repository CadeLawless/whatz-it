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
import { PortraitTransition } from '@/components/orientation-transition';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { colors, spacing } from '@/theme';

export default function StoreDeckDetailsScreen() {
  const { catalog } = useCatalog();
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const router = useRouter();
  const isPortrait = usePortraitScreen();
  const deck = catalog.getDeckById(deckId);
  const bundles = catalog.getBundlesForDeck(deckId);
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

  if (!isPortrait) {
    return <PortraitTransition style={styles.orientationGate} />;
  }

  if (!deck) {
    return (
      <SafeAreaView style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.notFoundTitle}>Deck not found</Text>
        <Text style={styles.notFoundText}>
          This deck may have moved or is not available yet.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>BACK TO EXPLORE</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityLabel="Back to Explore"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backText}>Back to Explore</Text>
          </Pressable>

          <View style={styles.coverShadow}>
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
          </View>

          <View style={styles.copy}>
            <Text style={styles.title}>{deck.title}</Text>
            <Text style={styles.description}>{deck.description}</Text>

            <View style={styles.metadata}>
              <Text style={styles.metadataText}>{deck.cardCount} CARDS</Text>
              {bundles.length > 0 && (
                <Text style={styles.metadataText}>
                  IN {bundles.length} {bundles.length === 1 ? 'BUNDLE' : 'BUNDLES'}
                </Text>
              )}
            </View>

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

          <View style={styles.purchaseCard}>
            <Text style={styles.purchaseTitle}>Purchasing is coming soon</Text>
            <Text style={styles.purchaseCopy}>
              This preview lets you browse the complete catalog. Secure in-app
              purchasing will be connected in the next phase.
            </Text>
            <View accessibilityState={{ disabled: true }} style={styles.purchaseButton}>
              <Text style={styles.purchaseButtonText}>COMING SOON</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    alignItems: 'center',
    gap: 24,
    paddingHorizontal: spacing.lg,
    paddingBottom: 36,
  },
  backLink: {
    minHeight: 44,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  backChevron: { color: '#2563EB', fontSize: 34, lineHeight: 36 },
  backText: { color: '#2563EB', fontSize: 16, fontWeight: '800' },
  coverShadow: {
    width: '64%',
    maxWidth: 260,
    aspectRatio: 2 / 3,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.20)',
  },
  cover: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#DBEAFE',
  },
  coverFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  coverFallbackText: {
    color: '#1E3A8A',
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
  },
  copy: { alignSelf: 'stretch', gap: 13 },
  title: { color: '#111827', fontSize: 30, lineHeight: 34, fontWeight: '900' },
  description: { color: '#64748B', fontSize: 16, lineHeight: 24 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  metadataText: {
    color: '#2563EB',
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
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  purchaseCard: {
    alignSelf: 'stretch',
    gap: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
  },
  purchaseTitle: { color: '#111827', fontSize: 18, fontWeight: '900' },
  purchaseCopy: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  purchaseButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    borderRadius: 24,
    backgroundColor: '#CBD5E1',
  },
  purchaseButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
    backgroundColor: colors.background,
  },
  notFoundTitle: { color: '#111827', fontSize: 24, fontWeight: '900' },
  notFoundText: { color: '#64748B', textAlign: 'center', fontSize: 15 },
  backButton: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: '#459EFE',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  pressed: { opacity: 0.72 },
  orientationGate: { backgroundColor: colors.background },
});

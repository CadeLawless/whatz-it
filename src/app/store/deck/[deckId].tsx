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
import { DeckDetailsHeader } from '@/components/deck-details-header';
import { PortraitTransition } from '@/components/orientation-transition';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { colors, radius, spacing, typography } from '@/theme';

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
          <DeckDetailsHeader
            backLabel="Back to Explore"
            deck={deck}
            onBack={() => router.back()}
          />

          <View style={styles.copy}>
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
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  copy: { gap: 13, marginTop: spacing.xl },
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
    gap: 10,
    marginTop: spacing.xl,
    padding: 20,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  purchaseTitle: { color: '#111827', fontSize: 18, fontWeight: '900' },
  purchaseCopy: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  purchaseButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    borderRadius: radius.pill,
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
    backgroundColor: colors.surface,
  },
  notFoundTitle: { ...typography.title, color: colors.ink },
  notFoundText: { ...typography.body, color: colors.muted, textAlign: 'center' },
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
  orientationGate: { flex: 1 },
});

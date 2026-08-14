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
          <DeckDetailsHeader
            backLabel="Close Preview"
            deck={deck}
            onBack={() => router.back()}
            showBackButton={false}
          />
          <View style={styles.copy}>
            {bundle && <Text style={styles.bundleName}>From {bundle.title}</Text>}
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
            <View style={styles.purchaseArea}>
              <View
                accessibilityLabel="Purchase Single Deck, coming soon"
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                style={styles.purchaseButton}
              >
                <Text style={styles.purchaseButtonText}>PURCHASE SINGLE DECK</Text>
              </View>
              <Text style={styles.purchaseNote}>
                Secure in-app purchasing is coming soon.
              </Text>
            </View>
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
  copy: { gap: 10 },
  bundleName: { color: colors.muted, fontSize: 13, fontWeight: '700' },
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

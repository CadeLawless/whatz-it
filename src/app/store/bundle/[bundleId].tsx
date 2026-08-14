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
import { BundleCoverCarousel } from '@/components/bundle-cover-carousel';
import { PortraitTransition } from '@/components/orientation-transition';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { colors, radius, spacing, typography } from '@/theme';

export default function BundleDetailsScreen() {
  const { catalog } = useCatalog();
  const { bundleId, fromDeckId } = useLocalSearchParams<{
    bundleId: string;
    fromDeckId?: string;
  }>();
  const router = useRouter();
  const isPortrait = usePortraitScreen();
  const bundle = catalog.getBundleById(bundleId);
  const sourceDeck = fromDeckId ? catalog.getDeckById(fromDeckId) : undefined;
  const backLabel = sourceDeck ? `Back to ${sourceDeck.title}` : 'Back to Explore';

  if (!isPortrait) return <PortraitTransition style={styles.orientationGate} />;

  if (!bundle) {
    return (
      <SafeAreaView style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.notFoundTitle}>Bundle not found</Text>
        <Text style={styles.notFoundText}>
          This bundle may have moved or is not available yet.
        </Text>
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
            accessibilityLabel={backLabel}
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text numberOfLines={1} style={styles.backText}>{backLabel}</Text>
          </Pressable>

          <View style={styles.hero}>
            <Text style={styles.eyebrow}>BUNDLE</Text>
            <Text style={styles.title}>{bundle.title}</Text>
            <Text style={styles.description}>{bundle.description}</Text>
          </View>

          <BundleCoverCarousel
            decks={bundle.decks}
            onDeckPress={(deck) =>
              router.push({
                pathname: '/store/deck-preview/[deckId]',
                params: { bundleId: bundle.id, deckId: deck.id },
              })
            }
          />

          <View style={styles.purchaseCard}>
            <Text style={styles.purchaseTitle}>Bundle purchasing is coming soon</Text>
            <Text style={styles.purchaseCopy}>
              Current localized pricing and secure purchasing will appear here
              after Phase 4 connects verified App Store products.
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
  content: { gap: spacing.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  backButton: {
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: '0 5px 12px rgba(100, 116, 139, 0.16)',
  },
  backChevron: {
    color: '#000000',
    fontSize: 35,
    lineHeight: 38,
    fontWeight: '300',
  },
  backText: {
    flexShrink: 1,
    color: '#000000',
    fontSize: 17,
    fontWeight: '500',
    marginLeft: 2,
  },
  hero: {
    gap: 8,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.play,
    boxShadow: '0 7px 13px rgba(100, 116, 139, 0.18)',
  },
  eyebrow: {
    color: '#BDEBFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    color: colors.white,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  description: { color: colors.white, fontSize: 15, lineHeight: 21 },
  purchaseCard: {
    gap: 10,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  purchaseTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  purchaseCopy: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  purchaseButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    borderRadius: radius.pill,
    backgroundColor: '#CBD5E1',
  },
  purchaseButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  notFoundTitle: { ...typography.title, color: colors.ink },
  notFoundText: { ...typography.body, color: colors.muted, textAlign: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  orientationGate: { flex: 1 },
});

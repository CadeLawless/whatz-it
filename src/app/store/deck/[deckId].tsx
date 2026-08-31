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
import { CommercePurchaseCard } from '@/components/commerce-purchase-card';
import { DeckDetailsHeader } from '@/components/deck-details-header';
import { PortraitTransition } from '@/components/orientation-transition';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { useCommerceProduct } from '@/storefront/commerce-provider';
import { colors, radius, spacing, typography } from '@/theme';

export default function StoreDeckDetailsScreen() {
  const { catalog } = useCatalog();
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const router = useRouter();
  const isPortrait = usePortraitScreen();
  const deck = catalog.getDeckById(deckId);
  const bundles = catalog.getBundlesForDeck(deckId);
  const commerceTarget = deck
    ? {
        access: deck.access,
        id: deck.id,
        installationStatus: deck.installationStatus,
        kind: 'deck' as const,
        title: deck.title,
      }
    : null;
  const resolvedCommerceTarget =
    commerceTarget ?? {
      access: 'paid',
      id: deckId,
      kind: 'deck' as const,
      title: 'Deck',
    };
  const commerce = useCommerceProduct(resolvedCommerceTarget);

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
            {bundles.length > 0 && (
              <Pressable
                accessibilityHint="Shows every bundle that includes this deck"
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: '/store/bundles-for-deck/[deckId]',
                    params: { deckId: deck.id },
                  })
                }
                style={({ pressed }) => [
                  styles.seeBundlesButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.seeBundlesText}>SEE BUNDLES</Text>
                <Text style={styles.seeBundlesChevron}>›</Text>
              </Pressable>
            )}

          </View>
        </ScrollView>

        <View style={styles.purchaseFooter}>
          <CommercePurchaseCard
            onOwned={() =>
              router.push({
                pathname: '/deck/[deckId]',
                params: { deckId: deck.id, transition: 'apple-slide' },
              })
            }
            onPurchase={commerce.purchase}
            onRetry={commerce.retry}
            state={commerce.state}
            target={resolvedCommerceTarget}
          />
        </View>
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
  seeBundlesButton: {
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    backgroundColor: '#EAF4FF',
  },
  seeBundlesText: {
    color: '#2563EB',
    fontSize: 12,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  seeBundlesChevron: {
    color: '#2563EB',
    fontSize: 24,
    lineHeight: 26,
    fontFamily: 'Inter_500Medium',
    fontWeight: '500',
  },
  purchaseFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
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
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  pressed: { opacity: 0.72 },
  orientationGate: { flex: 1 },
});

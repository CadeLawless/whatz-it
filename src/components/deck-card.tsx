import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CatalogDeck } from '@/catalog/catalog-snapshot';
import { colors, spacing } from '@/theme';

type DeckCardProps = {
  deck: CatalogDeck;
  showNewBadge?: boolean;
};

export function DeckCard({ deck, showNewBadge = false }: DeckCardProps) {
  const router = useRouter();

  return (
    <View style={styles.shadow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={showNewBadge ? `${deck.title}, new` : deck.title}
        onPress={() =>
          router.push({
            pathname: '/deck/[deckId]',
            params: { deckId: deck.id, transition: 'apple-slide' },
          })
        }
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: colors.play },
          pressed && styles.cardPressed,
        ]}
      >
        {deck.coverUri || deck.coverImage ? (
          <Image
            accessibilityLabel={deck.title}
            cachePolicy="memory-disk"
            contentFit="cover"
            priority="high"
            source={deck.coverUri || deck.coverImage}
            style={styles.coverImage}
          />
        ) : (
          <View style={styles.fallback}>
            <Text maxFontSizeMultiplier={1.1} style={styles.fallbackTitle}>
              {deck.title}
            </Text>
          </View>
        )}
        {showNewBadge && (
          <View accessibilityElementsHidden style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    flex: 1,
    borderRadius: 6,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 5,
  },
  card: {
    flex: 1,
    minHeight: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  cardPressed: { transform: [{ scale: 0.96 }], opacity: 0.88 },
  coverImage: { flex: 1, width: '100%' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  fallbackTitle: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  newBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 2px 7px rgba(15, 23, 42, 0.22)',
  },
  newBadgeText: {
    color: colors.play,
    fontSize: 9,
    lineHeight: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
});

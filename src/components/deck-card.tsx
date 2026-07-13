import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import type { Deck } from '@/types/deck';

type DeckCardProps = { deck: Deck };

export function DeckCard({ deck }: DeckCardProps) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={deck.title}
      onPress={() => router.push({ pathname: '/deck/[deckId]', params: { deckId: deck.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: deck.color },
        pressed && styles.cardPressed,
      ]}
    >
      {deck.coverImage ? (
        <Image
          accessibilityLabel={deck.title}
          contentFit="cover"
          source={deck.coverImage}
          style={styles.coverImage}
        />
      ) : (
        <View style={styles.fallback}>
          <Text maxFontSizeMultiplier={1.1} style={styles.fallbackTitle}>
            {deck.title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(24,35,29,0.12)',
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
    color: colors.ink,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
});

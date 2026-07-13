import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme';
import type { Deck } from '@/types/deck';

type DeckCardProps = { deck: Deck };

export function DeckCard({ deck }: DeckCardProps) {
  return (
    <Link href={{ pathname: '/deck/[deckId]', params: { deckId: deck.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={deck.title}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: deck.color },
          pressed && styles.cardPressed,
        ]}
      >
        <View style={styles.placeholderGraphic}>
          <View style={styles.sun} />
          <View style={styles.swoop} />
          <View style={styles.dotLarge} />
          <View style={styles.dotSmall} />
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    aspectRatio: 0.72,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(24,35,29,0.12)',
  },
  cardPressed: { transform: [{ scale: 0.96 }], opacity: 0.88 },
  placeholderGraphic: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sun: {
    position: 'absolute',
    width: '72%',
    aspectRatio: 1,
    borderRadius: 999,
    top: '13%',
    left: '14%',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  swoop: {
    position: 'absolute',
    width: '145%',
    height: '50%',
    left: '-22%',
    bottom: '-14%',
    borderRadius: 999,
    backgroundColor: colors.ink,
    transform: [{ rotate: '-10deg' }],
  },
  dotLarge: {
    position: 'absolute',
    width: '22%',
    aspectRatio: 1,
    borderRadius: 999,
    right: '9%',
    bottom: '22%',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  dotSmall: {
    position: 'absolute',
    width: '10%',
    aspectRatio: 1,
    borderRadius: 999,
    left: '13%',
    top: '10%',
    backgroundColor: colors.ink,
  },
});

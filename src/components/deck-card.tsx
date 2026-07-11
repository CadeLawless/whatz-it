import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import type { Deck } from '@/types/deck';

type DeckCardProps = { deck: Deck };

export function DeckCard({ deck }: DeckCardProps) {
  return (
    <Link href={{ pathname: '/deck/[deckId]', params: { deckId: deck.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${deck.title}, ${deck.cards.length} cards`}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: deck.color },
          pressed && styles.cardPressed,
        ]}
      >
        <View style={styles.copy}>
          <View style={styles.freePill}>
            <Text style={styles.freeText}>FREE</Text>
          </View>
          <Text style={styles.title}>{deck.title}</Text>
          <Text style={styles.description} numberOfLines={2}>
            {deck.description}
          </Text>
          <Text style={styles.count}>{deck.cards.length} CARDS</Text>
        </View>
        <Text style={styles.icon}>{deck.icon}</Text>
        <View style={styles.arrowCircle}>
          <Text style={styles.arrow}>→</Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 210,
    borderRadius: radius.xl,
    padding: spacing.lg,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  copy: { maxWidth: '70%', zIndex: 1 },
  freePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.78)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  freeText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 29, fontWeight: '900', letterSpacing: -0.7 },
  description: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
    marginTop: spacing.xs,
    opacity: 0.78,
  },
  count: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: spacing.md,
    opacity: 0.65,
  },
  icon: {
    position: 'absolute',
    right: spacing.lg,
    top: spacing.lg,
    fontSize: 70,
    transform: [{ rotate: '7deg' }],
  },
  arrowCircle: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: { color: colors.white, fontSize: 23, fontWeight: '700', marginTop: -2 },
});

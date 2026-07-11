import { Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDeckById } from '@/data/decks';
import { colors, radius, spacing, typography } from '@/theme';

export default function DeckDetailsScreen() {
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const deck = getDeckById(deckId);

  if (!deck) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.notFoundTitle}>Deck not found</Text>
        <Text style={styles.notFoundText}>This deck may have moved or is not available yet.</Text>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: deck.title }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={[styles.heroCard, { backgroundColor: deck.color }]}>
          <Text style={styles.deckIcon}>{deck.icon}</Text>
          <View style={styles.freePill}>
            <Text style={styles.freeText}>FREE DECK</Text>
          </View>
          <Text style={styles.deckTitle}>{deck.title}</Text>
          <Text style={styles.deckDescription}>{deck.description}</Text>
          <Text style={styles.cardCount}>{deck.cards.length} cards</Text>
        </View>

        <Text style={styles.sectionLabel}>QUICK PREVIEW</Text>
        <View style={styles.previewList}>
          {deck.cards.slice(0, 3).map((card, index) => (
            <View key={card.id} style={styles.previewRow}>
              <Text style={styles.previewNumber}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={styles.previewText}>{card.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonTitle}>Round setup is next</Text>
          <Text style={styles.comingSoonText}>
            Timer selection, countdown, and the playable game loop arrive in Milestone 2.
          </Text>
        </View>

        <Pressable accessibilityRole="button" disabled style={styles.startButton}>
          <Text style={styles.startButtonText}>COMING NEXT: START ROUND</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  notFoundTitle: { ...typography.title, color: colors.ink },
  notFoundText: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  heroCard: {
    minHeight: 320,
    borderRadius: radius.xl,
    padding: spacing.xl,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  deckIcon: {
    position: 'absolute',
    right: spacing.lg,
    top: spacing.lg,
    fontSize: 76,
    transform: [{ rotate: '8deg' }],
  },
  freePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  freeText: { color: colors.ink, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  deckTitle: { ...typography.hero, color: colors.ink },
  deckDescription: {
    ...typography.body,
    color: colors.ink,
    marginTop: spacing.sm,
    maxWidth: 360,
  },
  cardCount: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    marginTop: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.7,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  previewList: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  previewNumber: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  previewText: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  comingSoon: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
  },
  comingSoonTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  comingSoonText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  startButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.58,
  },
  startButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
});

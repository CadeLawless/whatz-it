import { type Href, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TimerPicker } from '@/components/timer-picker';
import { getDeckById } from '@/data/decks';
import { useRound } from '@/game/round-context';
import { clampRoundDuration, DEFAULT_ROUND_DURATION } from '@/game/round-duration';
import {
  loadRoundDuration,
  saveRoundDuration,
} from '@/storage/preferences';
import { colors, radius, spacing, typography } from '@/theme';
import { lockLandscapeOrientation } from '@/utils/orientation';

export default function DeckDetailsScreen() {
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const deck = getDeckById(deckId);
  const router = useRouter();
  const { configureRound } = useRound();
  const [duration, setDuration] = useState(DEFAULT_ROUND_DURATION);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    loadRoundDuration().then(setDuration);
  }, []);

  if (!deck) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.notFoundTitle}>Deck not found</Text>
        <Text style={styles.notFoundText}>This deck may have moved or is not available yet.</Text>
      </SafeAreaView>
    );
  }

  const handleStart = async () => {
    if (isStarting) return;
    const safeDuration = clampRoundDuration(duration);
    if (!configureRound(deck.id, safeDuration)) return;
    setIsStarting(true);
    saveRoundDuration(safeDuration).catch(() => undefined);
    await lockLandscapeOrientation();
    router.push('/ready' as Href);
  };

  return (
    <>
      <Stack.Screen options={{ title: deck.title }} />
      <View style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={[styles.heroCard, { backgroundColor: colors.play }]}>
          <View style={styles.freePill}>
            <Text style={styles.freeText}>FREE DECK</Text>
          </View>
          <Text style={styles.deckTitle}>{deck.title}</Text>
          <Text style={styles.deckDescription}>{deck.description}</Text>
          <Text style={styles.cardCount}>{deck.cards.length} cards</Text>
        </View>

        <Text style={styles.sectionLabel}>ROUND LENGTH</Text>
        <TimerPicker value={duration} onChange={(value) => setDuration(clampRoundDuration(value))} />

        {/* <Text style={styles.sectionLabel}>QUICK PREVIEW</Text>
        <View style={styles.previewList}>
          {deck.cards.slice(0, 3).map((card, index) => (
            <View key={card.id} style={styles.previewRow}>
              <Text style={styles.previewNumber}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={styles.previewText}>{card.text}</Text>
            </View>
          ))}
        </View> */}

        <Pressable
          accessibilityRole="button"
          disabled={isStarting}
          onPress={handleStart}
          style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
        >
          <Text style={styles.startButtonText}>GET READY</Text>
          <Text style={styles.startArrow}>→</Text>
        </Pressable>
      </ScrollView>
      {isStarting && (
        <View style={styles.startingOverlay}>
          <StatusBar hidden animated={false} />
        </View>
      )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  startingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: colors.play,
  },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  notFoundTitle: { ...typography.title, color: colors.ink },
  notFoundText: { ...typography.body, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },
  heroCard: {
    minHeight: 300,
    borderRadius: radius.xl,
    padding: spacing.xl,
    justifyContent: 'flex-end',
    overflow: 'hidden',
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
  deckTitle: { ...typography.hero, color: colors.white },
  deckDescription: { ...typography.body, color: colors.white, marginTop: spacing.sm, maxWidth: 360 },
  cardCount: {
    color: colors.white,
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
  startButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    minHeight: 62,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  startButtonPressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  startButtonText: { color: colors.white, fontSize: 15, fontWeight: '900', letterSpacing: 1.1 },
  startArrow: { color: colors.white, fontSize: 25, fontWeight: '700' },
});

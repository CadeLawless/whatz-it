import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDeckById } from '@/data/decks';
import { useRound } from '@/game/round-context';
import { colors, radius, spacing, typography } from '@/theme';

export default function ReadyScreen() {
  const router = useRouter();
  const { round, startRound, resetRound } = useRound();
  const deck = getDeckById(round.deckId ?? undefined);
  const [count, setCount] = useState(3);
  const launched = useRef(false);

  useEffect(() => {
    if (!deck || round.status !== 'ready') {
      router.replace('/');
      return;
    }

    if (count === 0 && !launched.current) {
      launched.current = true;
      startRound();
      router.replace('/game' as Href);
      return;
    }

    const timeout = setTimeout(() => setCount((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timeout);
  }, [count, deck, round.status, router, startRound]);

  if (!deck) return null;

  const handleCancel = () => {
    resetRound();
    router.replace(`/deck/${deck.id}`);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: deck.color }]}>
      <View style={styles.topRow}>
        <Text style={styles.deckName}>{deck.icon} {deck.title}</Text>
        <Text style={styles.duration}>{round.durationSeconds}s</Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.kicker}>HOLD THE PHONE TO YOUR FOREHEAD</Text>
        <Text style={styles.count}>{count || 'GO!'}</Text>
        <Text style={styles.instructions}>Use the buttons for now.{`\n`}Motion controls arrive next.</Text>
      </View>

      <Pressable accessibilityRole="button" onPress={handleCancel} style={styles.cancelButton}>
        <Text style={styles.cancelText}>CANCEL</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, padding: spacing.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deckName: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  duration: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '900',
    backgroundColor: 'rgba(255,255,255,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.ink, fontSize: 12, fontWeight: '900', letterSpacing: 1.8, textAlign: 'center' },
  count: { color: colors.ink, fontSize: 150, lineHeight: 170, fontWeight: '900', letterSpacing: -8 },
  instructions: { ...typography.body, color: colors.ink, textAlign: 'center', opacity: 0.72 },
  cancelButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  cancelText: { color: colors.ink, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
});

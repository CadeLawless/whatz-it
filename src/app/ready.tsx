import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDeckById } from '@/data/decks';
import { formatRoundClock } from '@/game/round-duration';
import { useRound } from '@/game/round-context';
import { useForeheadPosition } from '@/hooks/use-forehead-position';
import { usePortraitOrientation } from '@/hooks/use-portrait-orientation';
import { colors, radius, spacing, typography } from '@/theme';

export default function ReadyScreen() {
  usePortraitOrientation();
  const router = useRouter();
  const { round, resetRound } = useRound();
  const deck = getDeckById(round.deckId ?? undefined);
  const [count, setCount] = useState(3);
  const [manualReady, setManualReady] = useState(false);
  const launched = useRef(false);
  const foreheadStatus = useForeheadPosition(round.status === 'ready');
  const positionReady = foreheadStatus === 'ready' || manualReady;

  useEffect(() => {
    if (!deck || round.status === 'idle') {
      router.replace('/');
      return;
    }

    if (round.status === 'playing' || round.status === 'feedback') {
      router.replace('/game' as Href);
      return;
    }

    if (round.status === 'finished') {
      router.replace('/results' as Href);
      return;
    }

    if (!positionReady) return;

    const timeout = setTimeout(() => {
      if (count === 1 && !launched.current) {
        launched.current = true;
        router.replace('/game' as Href);
        return;
      }

      setCount((value) => Math.max(1, value - 1));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [count, deck, positionReady, round.status, router]);

  if (!deck) return null;

  const handleCancel = () => {
    resetRound();
    router.replace(`/deck/${deck.id}`);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: deck.color }]}>
      <View style={styles.topRow}>
        <Text style={styles.duration}>{formatRoundClock(round.durationSeconds)}</Text>
        <Text style={typography.deckName}>{deck.icon} {deck.title}</Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.kicker}>HOLD THE PHONE TO YOUR FOREHEAD</Text>
        {positionReady ? (
          <>
            <Text style={styles.count}>{count}</Text>
            <Text style={styles.instructions}>Hold steady - your round is about to begin.</Text>
          </>
        ) : (
          <>
            <Text style={styles.phoneIcon}>▭</Text>
            <Text style={styles.positionTitle}>{getPositionMessage(foreheadStatus)}</Text>
            <Text style={styles.instructions}>
              Keep the phone sideways with the screen facing away from you.
            </Text>
            {(foreheadStatus === 'unavailable' || foreheadStatus === 'denied') && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setManualReady(true)}
                style={styles.manualButton}
              >
                <Text style={styles.manualButtonText}>START COUNTDOWN</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      <Pressable accessibilityRole="button" onPress={handleCancel} style={styles.cancelButton}>
        <Text style={styles.cancelText}>CANCEL</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function getPositionMessage(status: ReturnType<typeof useForeheadPosition>) {
  switch (status) {
    case 'checking':
      return 'Checking device motion...';
    case 'waiting':
      return 'Place the phone on your forehead';
    case 'ready':
      return 'Ready';
    case 'denied':
      return 'Motion access is off';
    case 'unavailable':
      return 'Motion detection is unavailable';
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, padding: spacing.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  phoneIcon: {
    color: colors.ink,
    fontSize: 120,
    lineHeight: 130,
    fontWeight: '300',
    transform: [{ rotate: '90deg' }],
  },
  positionTitle: { ...typography.title, color: colors.ink, textAlign: 'center', marginBottom: spacing.sm },
  instructions: {
    ...typography.body,
    color: colors.ink,
    textAlign: 'center',
    opacity: 0.72,
    maxWidth: 460,
  },
  manualButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  manualButtonText: { color: colors.white, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  cancelButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  cancelText: { color: colors.ink, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
});

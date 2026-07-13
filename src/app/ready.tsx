import * as ScreenOrientation from 'expo-screen-orientation';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDeckById } from '@/data/decks';
import { formatRoundClock } from '@/game/round-duration';
import { useRound } from '@/game/round-context';
import { useForeheadPosition } from '@/hooks/use-forehead-position';
import { colors, radius, spacing, typography } from '@/theme';

export default function ReadyScreen() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const { round, resetRound } = useRound();
  const deck = getDeckById(round.deckId ?? undefined);
  const [count, setCount] = useState(3);
  const [manualReady, setManualReady] = useState(false);
  const launched = useRef(false);
  const foreheadStatus = useForeheadPosition(round.status === 'ready');
  const positionReady = foreheadStatus === 'ready' || manualReady;
  const isLandscapeLayout = width > height;

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
  }, []);

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

    if (!positionReady || !isLandscapeLayout) return;

    const timeout = setTimeout(() => {
      if (count === 1 && !launched.current) {
        launched.current = true;
        router.replace('/game' as Href);
        return;
      }

      setCount((value) => Math.max(1, value - 1));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [count, deck, isLandscapeLayout, positionReady, round.status, router]);

  if (!deck) return null;

  if (!isLandscapeLayout) {
    return (
      <View style={[styles.rotationShell, { backgroundColor: deck.color }]}>
        <Text style={styles.rotationText}>Turning sideways...</Text>
      </View>
    );
  }

  const countSize = Math.max(92, Math.min(138, height * 0.34));

  const handleCancel = () => {
    resetRound();
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
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
            <Text style={[styles.count, { fontSize: countSize, lineHeight: countSize * 1.05 }]}>
              {count}
            </Text>
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

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={handleCancel} style={styles.cancelButton}>
          <Text style={styles.cancelText}>CANCEL</Text>
        </Pressable>
      </View>
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
  rotationShell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rotationText: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  safeArea: { flex: 1, padding: spacing.lg, overflow: 'hidden' },
  topRow: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  duration: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '900',
    backgroundColor: 'rgba(255,255,255,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  center: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  kicker: { color: colors.ink, fontSize: 12, fontWeight: '900', letterSpacing: 1.8, textAlign: 'center' },
  count: { color: colors.ink, fontWeight: '900', letterSpacing: -8 },
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
  footer: { flexShrink: 0, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.sm },
  cancelButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  cancelText: { color: colors.ink, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
});

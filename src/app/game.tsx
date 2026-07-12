import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDeckById } from '@/data/decks';
import { useRound } from '@/game/round-context';
import { formatRoundClock } from '@/game/round-duration';
import { useRoundTimer } from '@/hooks/use-round-timer';
import { useTiltControls } from '@/hooks/use-tilt-controls';
import { colors, radius, spacing, typography } from '@/theme';

export default function GameScreen() {
  useKeepAwake();
  const router = useRouter();
  const { round, answerCard, advanceCard, finishRound, startRound } = useRound();
  const deck = getDeckById(round.deckId ?? undefined);
  const currentCardId = round.cardOrder[round.currentCardIndex];
  const currentCard = deck?.cards.find((card) => card.id === currentCardId);
  const handleExpire = useCallback(() => finishRound(), [finishRound]);
  const remainingSeconds = useRoundTimer({
    endsAt: round.endsAt,
    active: round.status === 'playing' || round.status === 'feedback',
    onExpire: handleExpire,
  });
  const handleAnswer = useCallback(
    (outcome: 'correct' | 'passed') => {
      if (outcome === 'correct') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      }
      answerCard(outcome);
    },
    [answerCard],
  );
  const tiltStatus = useTiltControls({
    enabled:
      round.status === 'ready' || round.status === 'playing' || round.status === 'feedback',
    acceptingInput: round.status === 'playing',
    onAction: handleAnswer,
  });

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!deck || !currentCard || round.status === 'idle') {
      router.replace('/');
    }
  }, [currentCard, deck, round.status, router]);

  useEffect(() => {
    if (round.status !== 'ready') return;
    if (tiltStatus === 'ready' || tiltStatus === 'unavailable' || tiltStatus === 'denied') {
      startRound();
    }
  }, [round.status, startRound, tiltStatus]);

  useEffect(() => {
    if (round.status !== 'feedback') return;
    const timeout = setTimeout(advanceCard, 550);
    return () => clearTimeout(timeout);
  }, [advanceCard, round.status]);

  useEffect(() => {
    if (round.status === 'finished') router.replace('/results' as Href);
  }, [round.status, router]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && (round.status === 'playing' || round.status === 'feedback')) {
        finishRound();
      }
    });
    return () => subscription.remove();
  }, [finishRound, round.status]);

  if (!deck || !currentCard) return null;

  const locked = round.status !== 'playing';
  const feedbackColor = round.latestOutcome === 'correct' ? colors.correct : colors.pass;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: deck.color }]}>
      <View style={styles.topRow}>
        <View style={styles.timerPill}>
          <Text style={styles.timer}>
            {formatRoundClock(round.status === 'ready' ? round.durationSeconds : remainingSeconds)}
          </Text>
          <Text style={styles.timerLabel}>TIME</Text>
        </View>
        <Text style={[typography.deckName]}>{deck.icon} {deck.title}</Text>
        {/* <Text style={styles.progress}>
          {round.currentCardIndex + 1} / {round.cardOrder.length}
        </Text> */}
      </View>

      {/* <View style={styles.sensorRow}>
        <View style={[styles.sensorDot, tiltStatus === 'ready' && styles.sensorDotReady]} />
        <Text style={styles.sensorText}>{getTiltStatusLabel(tiltStatus)}</Text>
      </View> */}

      <View style={styles.cardArea}>
        <Text style={styles.cardLabel}>YOUR CARD</Text>
        <Text adjustsFontSizeToFit numberOfLines={3} minimumFontScale={0.55} style={styles.cardText}>
          {currentCard.text}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => handleAnswer('passed')}
          style={({ pressed }) => [styles.control, styles.passButton, pressed && styles.controlPressed]}
        >
          <Text style={styles.controlIcon}>↑</Text>
          <Text style={styles.controlText}>PASS</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => handleAnswer('correct')}
          style={({ pressed }) => [styles.control, styles.correctButton, pressed && styles.controlPressed]}
        >
          <Text style={styles.controlIcon}>↓</Text>
          <Text style={styles.controlText}>CORRECT</Text>
        </Pressable>
      </View>

      {round.status === 'feedback' && (
        <View style={[styles.feedback, { backgroundColor: feedbackColor }]}>
          <Text style={styles.feedbackIcon}>{round.latestOutcome === 'correct' ? '✓' : '↗'}</Text>
          <Text style={styles.feedbackText}>
            {round.latestOutcome === 'correct' ? 'CORRECT!' : 'PASSED'}
          </Text>
        </View>
      )}

      {round.status === 'ready' && (
        <View style={styles.setupOverlay}>
          <Text style={styles.setupIcon}>◎</Text>
          <Text style={styles.setupTitle}>Hold steady</Text>
          <Text style={styles.setupText}>{getTiltStatusLabel(tiltStatus)}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function getTiltStatusLabel(status: ReturnType<typeof useTiltControls>) {
  switch (status) {
    case 'checking':
      return 'CHECKING MOTION';
    case 'calibrating':
      return 'HOLD STEADY · CALIBRATING';
    case 'ready':
      return 'TILT CONTROLS READY';
    case 'denied':
      return 'MOTION DENIED · USE BUTTONS';
    case 'unavailable':
      return 'BUTTON CONTROLS';
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, padding: spacing.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  timer: { color: colors.ink, fontSize: 25, fontWeight: '900' },
  timerLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  progress: { color: colors.ink, fontSize: 13, fontWeight: '900', opacity: 0.65 },
  sensorRow: {
    position: 'absolute',
    top: spacing.lg + 15,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  sensorDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted },
  sensorDotReady: { backgroundColor: colors.correct },
  sensorText: { color: colors.ink, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, opacity: 0.62 },
  cardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  cardLabel: { color: colors.ink, fontSize: 11, fontWeight: '900', letterSpacing: 2, opacity: 0.55 },
  cardText: {
    color: colors.ink,
    fontSize: 64,
    lineHeight: 70,
    fontWeight: '900',
    letterSpacing: -2.4,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  controls: { flexDirection: 'row', gap: spacing.md },
  control: {
    flex: 1,
    minHeight: 92,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passButton: { backgroundColor: colors.pass },
  correctButton: { backgroundColor: colors.correct },
  controlPressed: { transform: [{ scale: 0.98 }], opacity: 0.86 },
  controlIcon: { color: colors.ink, fontSize: 28, fontWeight: '900', lineHeight: 30 },
  controlText: { color: colors.ink, fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  feedback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackIcon: { color: colors.ink, fontSize: 110, fontWeight: '900', lineHeight: 120 },
  feedbackText: { color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: 1 },
  setupOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(247,245,239,0.96)',
  },
  setupIcon: { color: colors.ink, fontSize: 72, lineHeight: 80, fontWeight: '700' },
  setupTitle: { ...typography.title, color: colors.ink, marginTop: spacing.sm },
  setupText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
    marginTop: spacing.sm,
  },
});

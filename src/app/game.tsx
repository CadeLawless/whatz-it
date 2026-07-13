import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDeckById } from '@/data/decks';
import { useRound } from '@/game/round-context';
import { formatRoundClock } from '@/game/round-duration';
import { useRoundTimer } from '@/hooks/use-round-timer';
import { useTiltControls } from '@/hooks/use-tilt-controls';
import { colors, radius, spacing, typography } from '@/theme';
import { lockPortraitOrientation } from '@/utils/orientation';
import { replaySound } from '@/utils/sound';

export default function GameScreen() {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const [finishPromptVisible, setFinishPromptVisible] = useState(false);
  const roundStarted = useRef(false);
  const lastTickSecond = useRef<number | null>(null);
  const roundStartPlayer = useAudioPlayer(require('../../assets/sounds/round-start.wav'));
  const finalTickPlayer = useAudioPlayer(require('../../assets/sounds/final-tick.wav'));
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
  const handleFinishEarly = useCallback(() => {
    setFinishPromptVisible(true);
  }, []);
  const confirmFinishEarly = useCallback(() => {
    setFinishPromptVisible(false);
    finishRound();
  }, [finishRound]);

  useEffect(() => {
    if (!deck || !currentCard || round.status === 'idle') {
      router.replace('/');
    }
  }, [currentCard, deck, round.status, router]);

  useEffect(() => {
    if (round.status !== 'ready') return;
    if (!roundStarted.current && (tiltStatus === 'ready' || tiltStatus === 'unavailable' || tiltStatus === 'denied')) {
      roundStarted.current = true;
      replaySound(roundStartPlayer);
      startRound();
    }
  }, [round.status, roundStartPlayer, startRound, tiltStatus]);

  useEffect(() => {
    if (round.status !== 'playing') return;
    if (remainingSeconds < 1 || remainingSeconds > 10) {
      lastTickSecond.current = null;
      return;
    }
    if (lastTickSecond.current === remainingSeconds) return;
    lastTickSecond.current = remainingSeconds;
    replaySound(finalTickPlayer);
  }, [finalTickPlayer, remainingSeconds, round.status]);

  useEffect(() => {
    if (round.status !== 'feedback') return;
    const timeout = setTimeout(advanceCard, 550);
    return () => clearTimeout(timeout);
  }, [advanceCard, round.status]);

  useEffect(() => {
    if (round.status !== 'finished') return;
    let active = true;
    const showResults = async () => {
      await lockPortraitOrientation();
      if (active) router.replace('/results' as Href);
    };
    showResults();
    return () => {
      active = false;
    };
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
  const cardFontSize = getCardFontSize(currentCard.text, width, height);

  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={[styles.safeArea, { backgroundColor: deck.color }]}
    >
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Finish round early"
          disabled={round.status === 'ready'}
          onPress={handleFinishEarly}
          style={({ pressed }) => [styles.finishButton, pressed && styles.finishButtonPressed]}
        >
          <Text style={styles.finishButtonText}>END ROUND</Text>
        </Pressable>
        <View style={styles.timerPill}>
          <Text style={styles.timer}>
            {formatRoundClock(round.status === 'ready' ? round.durationSeconds : remainingSeconds)}
          </Text>
          <Text style={styles.timerLabel}>TIME</Text>
        </View>
        <Text style={[typography.deckName, styles.deckName]}>{deck.icon} {deck.title}</Text>
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
        <Text
          maxFontSizeMultiplier={1.1}
          style={[
            styles.cardText,
            { fontSize: cardFontSize, lineHeight: Math.round(cardFontSize * 1.1) },
          ]}
        >
          {currentCard.text}
        </Text>
      </View>

      {Platform.OS === 'web' && (
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
      )}

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

      {round.status === 'finished' && (
        <View style={[styles.transitionOverlay, { backgroundColor: deck.color }]} />
      )}

      {finishPromptVisible && round.status !== 'finished' && (
        <View accessibilityViewIsModal style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>Finish round early?</Text>
            <Text style={styles.promptBody}>
              Your answers so far will still appear in the results.
            </Text>
            <View style={styles.promptActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setFinishPromptVisible(false)}
                style={({ pressed }) => [styles.promptCancel, pressed && styles.promptPressed]}
              >
                <Text style={styles.promptCancelText}>KEEP PLAYING</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={confirmFinishEarly}
                style={({ pressed }) => [styles.promptFinish, pressed && styles.promptPressed]}
              >
                <Text style={styles.promptFinishText}>FINISH ROUND</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function getCardFontSize(text: string, width: number, height: number) {
  const lengthSize = text.length <= 16 ? 68 : text.length <= 28 ? 56 : text.length <= 44 ? 46 : 38;
  const viewportSize = Math.max(36, Math.min(68, height * 0.18, width * 0.09));
  return Math.round(Math.min(lengthSize, viewportSize));
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
  safeArea: { flex: 1, padding: spacing.lg, overflow: 'hidden' },
  topRow: { height: 52, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  finishButton: {
    position: 'absolute',
    left: 0,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  finishButtonPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  finishButtonText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  deckName: { position: 'absolute', right: 0 },
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
  cardArea: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  cardLabel: { color: colors.ink, fontSize: 11, fontWeight: '900', letterSpacing: 2, opacity: 0.55 },
  cardText: {
    color: colors.ink,
    fontWeight: '900',
    letterSpacing: -2.4,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: '100%',
    flexShrink: 1,
  },
  controls: { flexDirection: 'row', flexShrink: 0, gap: spacing.md },
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
  transitionOverlay: { ...StyleSheet.absoluteFill },
  promptOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(24,35,29,0.42)',
  },
  promptCard: {
    width: '100%',
    maxWidth: 440,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  promptTitle: { ...typography.title, color: colors.ink, textAlign: 'center' },
  promptBody: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  promptActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  promptCancel: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promptFinish: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.pass,
  },
  promptPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  promptCancelText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
  promptFinishText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
});

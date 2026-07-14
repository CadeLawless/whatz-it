import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { CloseButton } from '@/components/close-button';
import { LandscapeViewport, useLandscapeDimensions } from '@/components/landscape-viewport';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { getDeckById } from '@/data/decks';
import { useRound } from '@/game/round-context';
import { formatRoundClock } from '@/game/round-duration';
import { useRoundTimer } from '@/hooks/use-round-timer';
import { useTiltControls } from '@/hooks/use-tilt-controls';
import { colors, radius, spacing, typography } from '@/theme';
import { replaySound } from '@/utils/sound';

const ROUND_END_SCREEN_MS = 1000;

export default function GameScreen() {
  useKeepAwake();
  const { width, height } = useLandscapeDimensions();
  const [finishPromptVisible, setFinishPromptVisible] = useState(false);
  const roundStarted = useRef(false);
  const startSoundPlayed = useRef(false);
  const lastTickSecond = useRef<number | null>(null);
  const finishSoundPlayed = useRef(false);
  const screenRef = useRef<View>(null);
  const resultsTransitionStarted = useRef(false);
  const roundStartPlayer = useAudioPlayer(require('../../assets/sounds/round-start.wav'));
  const finalTickPlayer = useAudioPlayer(require('../../assets/sounds/final-tick.wav'));
  const correctPlayer = useAudioPlayer(require('../../assets/sounds/correct.wav'));
  const passPlayer = useAudioPlayer(require('../../assets/sounds/pass.wav'));
  const roundEndPlayer = useAudioPlayer(require('../../assets/sounds/round-end.wav'));
  const router = useRouter();
  const { beginTransition } = useScreenshotTransition();
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
        replaySound(correctPlayer);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } else {
        replaySound(passPlayer);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      }
      answerCard(outcome);
    },
    [answerCard, correctPlayer, passPlayer],
  );
  const tiltStatus = useTiltControls({
    enabled:
      round.status === 'ready' || round.status === 'playing' || round.status === 'feedback',
    acceptingInput: round.status === 'playing',
    onAction: handleAnswer,
    onRearmed: advanceCard,
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
    if (round.status !== 'ready' || startSoundPlayed.current) return;
    startSoundPlayed.current = true;
    replaySound(roundStartPlayer);
  }, [round.status, roundStartPlayer]);

  useEffect(() => {
    if (round.status !== 'ready') return;
    if (!roundStarted.current && (tiltStatus === 'ready' || tiltStatus === 'unavailable' || tiltStatus === 'denied')) {
      roundStarted.current = true;
      startRound();
    }
  }, [round.status, startRound, tiltStatus]);

  useEffect(() => {
    if (round.status !== 'playing' && round.status !== 'feedback') return;
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
    if (tiltStatus !== 'unavailable' && tiltStatus !== 'denied') return;
    const timeout = setTimeout(advanceCard, 550);
    return () => clearTimeout(timeout);
  }, [advanceCard, round.status, tiltStatus]);

  useEffect(() => {
    if (round.status !== 'finished') return;
    if (!finishSoundPlayed.current) {
      finishSoundPlayed.current = true;
      replaySound(roundEndPlayer);
    }
    if (resultsTransitionStarted.current) return;
    resultsTransitionStarted.current = true;
    let active = true;
    const showResults = async () => {
      await new Promise((resolve) => setTimeout(resolve, ROUND_END_SCREEN_MS));
      if (!active) return;
      try {
        const uri = await captureRef(screenRef, {
          format: 'jpg',
          quality: 0.95,
          result: 'tmpfile',
        });
        await beginTransition({ destination: 'results', direction: 'left', uri });
      } catch {
        // If capture is unavailable, navigation still completes normally.
      }
      if (active) router.replace('/results' as Href);
    };
    showResults();
    return () => {
      active = false;
    };
  }, [beginTransition, round.status, roundEndPlayer, router]);

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
  const outerColor =
    round.status === 'feedback'
      ? feedbackColor
      : round.status === 'finished'
        ? colors.surface
        : colors.playSoft;
  const panelColor =
    round.status === 'feedback'
      ? feedbackColor
      : round.status === 'finished'
        ? colors.play
        : colors.surface;
  const panelBorderColor =
    round.status === 'feedback'
      ? round.latestOutcome === 'correct'
        ? colors.correctBorder
        : colors.passBorder
      : round.status === 'finished'
        ? colors.playBorder
        : '#439EFE';
  const cardFontSize = getCardFontSize(currentCard.text, width, height);

  return (
    <View ref={screenRef} collapsable={false} style={styles.captureRoot}>
      <LandscapeViewport>
        <SafeAreaView edges={[]} style={[styles.safeArea, { backgroundColor: outerColor }]}>
          <StatusBar hidden animated={false} />
          <View
            style={[
              styles.panel,
              { backgroundColor: panelColor, borderColor: panelBorderColor },
            ]}
          >
            <View pointerEvents="box-none" style={styles.closeButton}>
              <CloseButton
                accessibilityLabel="Finish round early"
                disabled={round.status === 'finished'}
                onPress={handleFinishEarly}
              />
            </View>

            <View style={styles.topRow}>
              <Text pointerEvents="none" style={styles.timer}>
                {formatRoundClock(round.status === 'ready' ? round.durationSeconds : remainingSeconds)}
              </Text>
              <Text style={styles.deckName}>{deck.title}</Text>
            </View>

            <View style={styles.cardArea}>
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
                  <Text style={styles.controlIcon}>×</Text>
                  <Text style={styles.controlText}>PASS</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={locked}
                  onPress={() => handleAnswer('correct')}
                  style={({ pressed }) => [styles.control, styles.correctButton, pressed && styles.controlPressed]}
                >
                  <Text style={styles.controlIcon}>✓</Text>
                  <Text style={styles.controlText}>CORRECT</Text>
                </Pressable>
              </View>
            )}

            {round.status === 'ready' && (
              <View style={styles.setupOverlay}>
                <Text style={styles.setupTitle}>HOLD STEADY</Text>
                <Text style={styles.setupText}>{getTiltStatusLabel(tiltStatus)}</Text>
              </View>
            )}

            {round.status === 'finished' && (
              <View style={styles.transitionOverlay}>
                <Text style={styles.finishTitle}>TIME&apos;S UP!</Text>
              </View>
            )}

          </View>

          {round.status === 'feedback' && (
            <View style={[styles.feedback, { backgroundColor: feedbackColor }]}>
              <Text
                style={[
                  styles.feedbackIcon,
                  round.latestOutcome === 'passed' && styles.passFeedbackText,
                  { color: round.latestOutcome === 'correct' ? colors.correctText : colors.passText },
                ]}
              >
                {round.latestOutcome === 'correct' ? '✓' : '×'}
              </Text>
              <Text
                style={[
                  styles.feedbackText,
                  round.latestOutcome === 'passed' && styles.passFeedbackText,
                  { color: round.latestOutcome === 'correct' ? colors.correctText : colors.passText },
                ]}
              >
                {round.latestOutcome === 'correct' ? 'CORRECT!' : 'PASS'}
              </Text>
            </View>
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
      </LandscapeViewport>
    </View>
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
  captureRoot: { flex: 1, backgroundColor: colors.playSoft },
  safeArea: {
    flex: 1,
    padding: 16,
    overflow: 'hidden',
  },
  panel: {
    flex: 1,
    minHeight: 0,
    borderWidth: 6,
    borderRadius: 28,
    overflow: 'hidden',
  },
  closeButton: { position: 'absolute', top: 14, left: 14, zIndex: 12 },
  topRow: {
    height: 72,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    zIndex: 2,
  },
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
  deckName: {
    width: 190,
    color: '#000000',
    fontSize: 18,
    fontWeight: '400',
    textAlign: 'right',
    textTransform: 'uppercase',
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  timer: {
    position: 'absolute',
    left: 0,
    right: 0,
    color: colors.play,
    fontSize: 25,
    fontWeight: '900',
    textAlign: 'center',
  },
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
    paddingHorizontal: 86,
    paddingTop: spacing.sm,
    paddingBottom: 70,
  },
  cardLabel: { color: colors.white, fontSize: 11, fontWeight: '900', letterSpacing: 2, opacity: 0.72 },
  cardText: {
    color: colors.play,
    fontWeight: '900',
    letterSpacing: -1.6,
    textAlign: 'center',
    maxWidth: '100%',
    flexShrink: 1,
  },
  controls: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  control: {
    flex: 1,
    minHeight: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passButton: { backgroundColor: colors.pass },
  correctButton: { backgroundColor: colors.correct },
  controlPressed: { transform: [{ scale: 0.98 }], opacity: 0.86 },
  controlIcon: { color: '#000000', fontSize: 24, fontWeight: '900', lineHeight: 26 },
  controlText: { color: '#000000', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  feedback: {
    ...StyleSheet.absoluteFill,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackIcon: { color: '#000000', fontSize: 124, fontWeight: '700', lineHeight: 130 },
  feedbackText: { color: '#000000', fontSize: 42, fontWeight: '500', letterSpacing: 0.5 },
  passFeedbackText: { color: colors.white },
  setupOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  setupIcon: { color: colors.ink, fontSize: 72, lineHeight: 80, fontWeight: '700' },
  setupTitle: { ...typography.title, color: colors.play, marginTop: spacing.sm },
  setupText: {
    color: colors.play,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
    marginTop: spacing.sm,
  },
  transitionOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishKicker: { color: colors.white, fontSize: 12, fontWeight: '900', letterSpacing: 2.2, opacity: 0.72 },
  finishTitle: { color: '#FFFFFF', fontSize: 60, lineHeight: 68, fontWeight: '900' },
  promptOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
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

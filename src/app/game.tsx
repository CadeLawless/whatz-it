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
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';

const ROUND_END_SCREEN_MS = 2495;
const ROUND_STOP_NAVIGATION_TIMEOUT_MS = 6_000;
const RESULTS_SCREENSHOT_TIMEOUT_MS = 2_000;

export default function GameScreen() {
  useKeepAwake();
  const { width, height } = useLandscapeDimensions();
  const [finishPromptVisible, setFinishPromptVisible] = useState(false);
  const roundStarted = useRef(false);
  const startSoundPlayed = useRef(false);
  const finishSoundPlayed = useRef(false);
  const screenRef = useRef<View>(null);
  const resultsTransitionStarted = useRef(false);
  const { isReady: soundsReady, play: playSound } = useRoundSounds();
  const router = useRouter();
  const { beginTransition } = useScreenshotTransition();
  const {
    round,
    answerCard,
    advanceCard,
    finishRound,
    isRecording,
    recordOverlayEvent,
    recordSoundCue,
    startRound,
    stopRecording,
  } = useRound();
  const stopRecordingRef = useRef(stopRecording);
  const deck = getDeckById(round.deckId ?? undefined);
  const currentCardId = round.cardOrder[round.currentCardIndex];
  const currentCard = deck?.cards.find((card) => card.id === currentCardId);
  const handleExpire = useCallback(() => finishRound(), [finishRound]);
  const handleTimerSecond = useCallback(
    (remaining: number) => {
      if (remaining < 1 || remaining > 10) return;
      void triggerRoundHaptic('final-countdown', { cameraActive: isRecording });
      recordSoundCue('final-tick');
      void playSound('final-tick');
    },
    [isRecording, playSound, recordSoundCue],
  );

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);
  const remainingSeconds = useRoundTimer({
    endsAt: round.endsAt,
    active: round.status === 'playing' || round.status === 'feedback',
    onExpire: handleExpire,
    onSecond: handleTimerSecond,
  });
  const handleAnswer = useCallback(
    (outcome: 'correct' | 'passed') => {
      if (outcome === 'correct') {
        recordSoundCue('correct');
        void playSound('correct');
        void triggerRoundHaptic('correct', { cameraActive: isRecording });
      } else {
        recordSoundCue('pass');
        void playSound('pass');
        void triggerRoundHaptic('pass', { cameraActive: isRecording });
      }
      answerCard(outcome);
    },
    [answerCard, isRecording, playSound, recordSoundCue],
  );
  const handleRearmed = useCallback(() => {
    void triggerRoundHaptic('card-flip', { cameraActive: isRecording });
    recordSoundCue('flip');
    void playSound('flip');
    advanceCard();
  }, [advanceCard, isRecording, playSound, recordSoundCue]);
  const tiltStatus = useTiltControls({
    enabled:
      round.status === 'ready' || round.status === 'playing' || round.status === 'feedback',
    acceptingInput: round.status === 'playing',
    onAction: handleAnswer,
    onRearmed: handleRearmed,
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
    if (round.status !== 'ready' || !soundsReady || startSoundPlayed.current) return;
    startSoundPlayed.current = true;
    recordSoundCue('round-start');
    void playSound('round-start');
  }, [playSound, recordSoundCue, round.status, soundsReady]);

  useEffect(() => {
    if (round.status !== 'ready' || !soundsReady) return;
    if (!roundStarted.current && (tiltStatus === 'ready' || tiltStatus === 'unavailable' || tiltStatus === 'denied')) {
      roundStarted.current = true;
      startRound();
    }
  }, [round.status, soundsReady, startRound, tiltStatus]);

  useEffect(() => {
    if (round.status !== 'feedback') return;
    if (tiltStatus !== 'unavailable' && tiltStatus !== 'denied') return;
    const timeout = setTimeout(advanceCard, 550);
    return () => clearTimeout(timeout);
  }, [advanceCard, round.status, tiltStatus]);

  useEffect(() => {
    if (!currentCard) return;
    if (round.status === 'playing') {
      recordOverlayEvent({ kind: 'card', text: currentCard.text });
    } else if (round.status === 'feedback' && round.latestOutcome) {
      recordOverlayEvent({
        kind: round.latestOutcome,
        text: round.latestOutcome === 'correct' ? 'CORRECT!' : 'PASS',
      });
    } else if (round.status === 'finished') {
      recordOverlayEvent({ kind: 'times-up', text: "TIME'S UP!" });
    }
  }, [currentCard, recordOverlayEvent, round.latestOutcome, round.status]);

  useEffect(() => {
    if (round.status !== 'finished') return;
    if (!finishSoundPlayed.current) {
      finishSoundPlayed.current = true;
      void triggerRoundHaptic('times-up', { cameraActive: isRecording });
      recordSoundCue('round-end');
      void playSound('round-end');
    }
  }, [isRecording, playSound, recordSoundCue, round.status]);

  // Recording shutdown changes isRecording. Keep navigation in its own effect so
  // that state update cannot clean up and strand this transition on Time's Up.
  useEffect(() => {
    if (round.status !== 'finished') return;
    if (resultsTransitionStarted.current) return;
    resultsTransitionStarted.current = true;
    let active = true;
    const showResults = async () => {
      await new Promise((resolve) => setTimeout(resolve, ROUND_END_SCREEN_MS));
      if (!active) return;
      await waitForRoundStop(stopRecordingRef.current());
      if (!active) return;
      try {
        const uri = await withTimeout(
          captureRef(screenRef, {
            format: 'jpg',
            quality: 0.95,
            result: 'tmpfile',
          }),
          RESULTS_SCREENSHOT_TIMEOUT_MS,
        );
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
  }, [beginTransition, round.status, router]);

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
            {round.status !== 'finished' && (
              <View style={styles.topRow}>
                <Text pointerEvents="none" style={styles.timer}>
                  {formatRoundClock(round.status === 'ready' ? round.durationSeconds : remainingSeconds)}
                </Text>
                <Text style={styles.deckName}>{deck.title}</Text>
              </View>
            )}

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

          {round.status !== 'finished' && round.status !== 'feedback' && (
            <View pointerEvents="box-none" style={styles.closeButton}>
              <CloseButton
                accessibilityLabel="Finish round early"
                disabled={false}
                onPress={handleFinishEarly}
              />
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

async function waitForRoundStop(stopPromise: Promise<unknown>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, ROUND_STOP_NAVIGATION_TIMEOUT_MS);
  });
  await Promise.race([stopPromise.then(() => undefined).catch(() => undefined), timeoutPromise]);
  if (timeout) clearTimeout(timeout);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Operation timed out.')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
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
  closeButton: { position: 'absolute', top: 30, left: 30, zIndex: 70 },
  topRow: {
    height: 72,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
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
    position: 'absolute',
    top: 23,
    right: 28,
    fontSize: 18,
    fontWeight: '400',
    textTransform: 'uppercase',
    color: '#000000',
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

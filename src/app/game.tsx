import { useKeepAwake } from 'expo-keep-awake';
import { type Href, useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { RecordingIndicator } from '@/components/recording-indicator';
import {
  RoundReadyMessage,
  RoundReadyPanel,
  RoundReadyPosition,
} from '@/components/round-ready-panel';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { useRound } from '@/game/round-context';
import { formatRoundClock } from '@/game/round-duration';
import { getRemainingSecondsFromMs, useRoundTimer } from '@/hooks/use-round-timer';
import { useTiltControls } from '@/hooks/use-tilt-controls';
import { colors, radius, spacing, typography } from '@/theme';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { traceAndroidCommit, traceAndroidGameplay } from '@/utils/android-gameplay-trace';
import { useRoundSounds } from '@/video/round-sound-provider';
import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

const ROUND_END_SCREEN_MS = 2495;
const RESULTS_SCREENSHOT_TIMEOUT_MS = 2_000;
const MANUAL_FEEDBACK_DURATION_MS = Platform.OS === 'android' ? 350 : 550;
const RESUME_ACKNOWLEDGEMENT_MS = 600;
const ROUND_FRAME_INSET = 16;
const ROUND_FRAME_BORDER_WIDTH = 6;
const ROUND_FRAME_RADIUS = 28;
const ROUND_PLAYING_BORDER_COLOR = '#439EFE';

type PortraitPausePhase = 'prompt' | 'positioning' | 'welcome-back' | 'restarting' | 'finished';

export default function GameScreen() {
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useKeepAwake();
  const { width, height } = useLandscapeDimensions();
  const [finishPromptVisible, setFinishPromptVisible] = useState(false);
  const [portraitPausePhase, setPortraitPausePhase] = useState<PortraitPausePhase | null>(null);
  const [resumeAcknowledgementEndsAt, setResumeAcknowledgementEndsAt] = useState<number | null>(null);
  const roundStarted = useRef(false);
  const finishSoundPlayed = useRef(false);
  const feedbackSoundCard = useRef<number | null>(null);
  const flipSoundCard = useRef<number | null>(null);
  const timerPausedForBackground = useRef(false);
  const recordingPausedForBackground = useRef(false);
  const pausedResumeAcknowledgementRemaining = useRef<number | null>(null);
  const portraitPausePhaseRef = useRef<PortraitPausePhase | null>(null);
  const portraitResumeOperation = useRef(0);
  const portraitRecordingResume = useRef<Promise<boolean> | null>(null);
  const [foregroundResumeGeneration, setForegroundResumeGeneration] = useState(0);
  const screenRef = useRef<View>(null);
  const resultsTransitionStarted = useRef(false);
  const { play: playSound, prepareForRound, stopAll } = useRoundSounds();
  const router = useRouter();
  const { beginTransition } = useScreenshotTransition();
  const {
    round,
    roundDeck,
    answerCard,
    advanceCard,
    finishRound,
    isRecording,
    pauseRecording,
    pauseRound,
    recordOverlayEvent,
    resumeRecording,
    resumeRound,
    startRound,
    stopRecording,
    cancelRecording,
  } = useRound();
  const finishedRef = useRef(false);
  const committedCueState = useRef({ status: round.status, card: round.currentCardIndex });
  useLayoutEffect(() => {
    committedCueState.current = { status: round.status, card: round.currentCardIndex };
    traceAndroidCommit(round.status, round.currentCardIndex);
  }, [round.status, round.currentCardIndex]);
  useLayoutEffect(() => { finishedRef.current = round.status === 'finished'; }, [round.status]);
  useLayoutEffect(() => { portraitPausePhaseRef.current = portraitPausePhase; }, [portraitPausePhase]);
  useFocusEffect(useCallback(() => () => {
    stopAll();
    if (!finishedRef.current) void cancelRecording();
  }, [cancelRecording, stopAll]));
  const stopRecordingRef = useRef(stopRecording);
  const resumeRecordingRef = useRef(resumeRecording);
  const deck = roundDeck;
  const currentCardId = round.cardOrder[round.currentCardIndex];
  const currentCard = deck?.cards.find((card) => card.id === currentCardId);
  const handleExpire = useCallback(() => finishRound(), [finishRound]);
  const handleTimerSecond = useCallback(
    (remaining: number) => {
      if (remaining < 1 || remaining > 10) return;
      void triggerRoundHaptic('final-countdown', { cameraActive: isRecording });
      void playSound('final-tick');
    },
    [isRecording, playSound],
  );

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);
  useEffect(() => {
    resumeRecordingRef.current = resumeRecording;
  }, [resumeRecording]);
  const remainingSeconds = useRoundTimer({
    endsAt: round.endsAt,
    active: focused && appActive && (round.status === 'playing' || round.status === 'feedback'),
    onExpire: handleExpire,
    onSecond: handleTimerSecond,
  });
  const displayedRemainingSeconds =
    round.status === 'paused'
      ? getRemainingSecondsFromMs(round.remainingMs)
      : remainingSeconds;
  const handleAnswer = useCallback(
    (outcome: 'correct' | 'passed') => {
      answerCard(outcome);
    },
    [answerCard],
  );
  // Audio/haptics follow the committed card state, never precede its dispatch.
  useEffect(() => {
    if (!focused || round.status !== 'feedback') return;
    if (feedbackSoundCard.current === round.currentCardIndex) return;
    feedbackSoundCard.current = round.currentCardIndex;
    traceAndroidGameplay('feedback.effect');
    // A replay seek may finish after a fast return to neutral. Android must
    // not start the previous answer sound over the now-active next card.
    const isCurrent = Platform.OS === 'android' ? () =>
      committedCueState.current.status === 'feedback' &&
      committedCueState.current.card === round.currentCardIndex : undefined;
    const outcome = round.latestOutcome;
    if (Platform.OS === 'android') {
      // Expo Audio's ostensibly fire-and-forget play path starts with a
      // synchronous main-thread pause. It must not hold up motor dispatch.
      void triggerRoundHaptic(outcome === 'correct' ? 'correct' : 'pass', { cameraActive: isRecording });
      void playSound(outcome === 'correct' ? 'correct' : 'pass', isCurrent);
      return;
    }
    if (outcome === 'correct') {
      void playSound('correct', isCurrent);
      void triggerRoundHaptic('correct', { cameraActive: isRecording });
    } else {
      void playSound('pass', isCurrent);
      void triggerRoundHaptic('pass', { cameraActive: isRecording });
    }
  }, [focused, round.status, round.latestOutcome, round.currentCardIndex, isRecording, playSound]);
  useEffect(() => {
    if (!focused || round.status !== 'playing' || round.currentCardIndex === 0) return;
    if (flipSoundCard.current === round.currentCardIndex) return;
    flipSoundCard.current = round.currentCardIndex;
    const isCurrent = Platform.OS === 'android' ? () =>
      committedCueState.current.status === 'playing' &&
      committedCueState.current.card === round.currentCardIndex : undefined;
    void triggerRoundHaptic('card-flip', { cameraActive: isRecording });
    void playSound('flip', isCurrent);
  }, [focused, isRecording, playSound, round.currentCardIndex, round.status]);

  const handleDevicePostureChange = useCallback((nextPosture: 'landscape' | 'portrait') => {
    const currentPausePhase = portraitPausePhaseRef.current;
    if (nextPosture === 'portrait') {
      if (currentPausePhase === 'positioning') {
        portraitResumeOperation.current += 1;
        portraitRecordingResume.current = null;
        stopAll();
        void pauseRecording();
        return;
      }
      if (currentPausePhase === 'welcome-back' || currentPausePhase === 'restarting') {
        portraitResumeOperation.current += 1;
        portraitRecordingResume.current = null;
        stopAll();
        setResumeAcknowledgementEndsAt(null);
        portraitPausePhaseRef.current = 'positioning';
        setPortraitPausePhase('positioning');
        void pauseRecording();
        return;
      }
      if (currentPausePhase !== null) return;
      if (round.status !== 'playing' && round.status !== 'feedback') return;
      setFinishPromptVisible(false);
      setResumeAcknowledgementEndsAt(null);
      portraitPausePhaseRef.current = 'prompt';
      setPortraitPausePhase('prompt');
      recordingPausedForBackground.current = false;
      stopAll();
      pauseRound();
      void pauseRecording();
      logVideoDiagnostic('round paused after sustained portrait hold', {
        previousStatus: round.status,
      });
      return;
    }

    if (currentPausePhase !== 'prompt' && currentPausePhase !== 'positioning') return;
    const operation = ++portraitResumeOperation.current;
    // Moving the phone back to the forehead is itself the resume action. Keep
    // the card hidden while the recorder and audio players become ready.
    portraitPausePhaseRef.current = 'positioning';
    setPortraitPausePhase('positioning');
    portraitRecordingResume.current = (async () => {
      const recordingReady = await resumeRecording({ restoreOverlay: false });
      if (
        operation !== portraitResumeOperation.current ||
        portraitPausePhaseRef.current !== 'positioning' ||
        AppState.currentState !== 'active'
      ) {
        if (recordingReady) void pauseRecording();
        return false;
      }
      await prepareForRound();
      if (
        operation !== portraitResumeOperation.current ||
        portraitPausePhaseRef.current !== 'positioning' ||
        AppState.currentState !== 'active'
      ) {
        if (recordingReady) void pauseRecording();
        return false;
      }
      setResumeAcknowledgementEndsAt(Date.now() + RESUME_ACKNOWLEDGEMENT_MS);
      portraitPausePhaseRef.current = 'welcome-back';
      setPortraitPausePhase('welcome-back');
      return recordingReady;
    })();
  }, [pauseRecording, pauseRound, prepareForRound, resumeRecording, round.status, stopAll]);

  const { status: tiltStatus } = useTiltControls({
    enabled:
      focused && appActive && (
        round.status === 'ready' ||
        round.status === 'playing' ||
        round.status === 'feedback' ||
        (portraitPausePhase !== null && portraitPausePhase !== 'finished')
    ),
    acceptingInput: round.status === 'playing',
    onAction: handleAnswer,
    onPostureChange: handleDevicePostureChange,
    onRearmed: advanceCard,
  });
  const handleFinishEarly = useCallback(() => {
    setFinishPromptVisible(true);
  }, []);
  const confirmFinishEarly = useCallback(() => {
    setFinishPromptVisible(false);
    finishRound();
  }, [finishRound]);

  const handleKeepPlaying = useCallback(() => {
    setResumeAcknowledgementEndsAt(null);
    portraitPausePhaseRef.current = 'positioning';
    setPortraitPausePhase('positioning');
  }, []);

  const handlePortraitFinish = useCallback(() => {
    portraitResumeOperation.current += 1;
    portraitRecordingResume.current = null;
    setResumeAcknowledgementEndsAt(null);
    portraitPausePhaseRef.current = 'finished';
    setPortraitPausePhase('finished');
    finishRound();
  }, [finishRound]);

  const handleResumeAcknowledgementExpire = useCallback(async () => {
    if (portraitPausePhaseRef.current !== 'welcome-back') return;
    const operation = ++portraitResumeOperation.current;
    setResumeAcknowledgementEndsAt(null);
    portraitPausePhaseRef.current = 'restarting';
    setPortraitPausePhase('restarting');

    const recordingReady = await (
      portraitRecordingResume.current ?? resumeRecording({ restoreOverlay: false })
    );
    portraitRecordingResume.current = null;
    if (
      operation !== portraitResumeOperation.current ||
      portraitPausePhaseRef.current !== 'restarting' ||
      AppState.currentState !== 'active'
    ) {
      if (recordingReady) void pauseRecording();
      return;
    }

    // Match initial round start: dispatch the cue and reveal the card in the
    // same turn instead of waiting for the native player's promise to settle.
    void playSound('round-start');

    // Resuming feedback advances to the next card; resuming play retains it.
    // Mark that destination as already sonified so the normal card effect
    // cannot layer a flip cue over the round-start cue.
    flipSoundCard.current = round.pausedStatus === 'feedback'
      ? round.currentCardIndex + 1
      : round.currentCardIndex;
    resumeRound();
    portraitPausePhaseRef.current = null;
    setPortraitPausePhase(null);
    logVideoDiagnostic('portrait-paused round revealed after recording restart', {
      recordingReady,
    });
  }, [pauseRecording, playSound, resumeRecording, resumeRound, round.currentCardIndex, round.pausedStatus]);

  useRoundTimer({
    endsAt: resumeAcknowledgementEndsAt,
    active: focused && appActive && portraitPausePhase === 'welcome-back',
    onExpire: handleResumeAcknowledgementExpire,
  });

  useEffect(() => {
    if (!deck || !currentCard || round.status === 'idle') {
      router.replace('/');
    }
  }, [currentCard, deck, round.status, router]);

  useEffect(() => {
    if (round.status !== 'ready') return;
    if (!focused || !appActive) return;
    if (!roundStarted.current && (tiltStatus === 'ready' || tiltStatus === 'unavailable' || tiltStatus === 'denied')) {
      roundStarted.current = true;
      startRound();
    }
  }, [appActive, focused, round.status, startRound, tiltStatus]);

  useEffect(() => {
    if (round.status !== 'feedback') return;
    if (!focused) return;
    if (tiltStatus !== 'unavailable' && tiltStatus !== 'denied') return;
    const timeout = setTimeout(advanceCard, MANUAL_FEEDBACK_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [advanceCard, focused, round.status, tiltStatus]);

  useEffect(() => {
    if (!currentCard) return;
    if (round.status === 'playing') {
      recordOverlayEvent({
        kind: 'card',
        text: currentCard.text,
        byline: currentCard.byline,
      });
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
      void playSound('round-end');
      void triggerRoundHaptic('times-up', { cameraActive: isRecording });
    }
  }, [isRecording, playSound, round.status]);

  // Keep recording through the full Time's Up beat so the exported video retains
  // its ending, then finalize in the background without delaying Results.
  useEffect(() => {
    if (round.status !== 'finished') return;
    if (resultsTransitionStarted.current) return;
    resultsTransitionStarted.current = true;
    let active = true;
    let endHoldTimeout: ReturnType<typeof setTimeout> | undefined;
    const showResults = async () => {
      const transitionStartedAt = Date.now();
      logVideoDiagnostic('results transition started', {
        endScreenHoldMs: ROUND_END_SCREEN_MS,
      });
      const prepareTransition = (async () => {
        // Let the native view commit the finished round before capturing it.
        // Without this, an early finish can snapshot the confirmation prompt
        // from the preceding frame and pin it over the Time's Up screen.
        await waitForNextPaint();
        if (!active) return;
        const screenshotStartedAt = Date.now();
        try {
          const uri = await withTimeout(
            captureRef(screenRef, {
              format: 'jpg',
              quality: 0.95,
              result: 'tmpfile',
            }),
            RESULTS_SCREENSHOT_TIMEOUT_MS,
          );
          logVideoDiagnostic('results transition screenshot captured', {
            elapsedMs: Date.now() - screenshotStartedAt,
            uri,
          });
          if (!active) return;
          await beginTransition({
            destination: 'results',
            direction: 'left',
            uri,
          });
          logVideoDiagnostic('results screenshot transition prepared', {
            elapsedMs: Date.now() - screenshotStartedAt,
          });
        } catch (error) {
          // If capture is unavailable, navigation still completes normally.
          warnVideoDiagnostic('results screenshot transition preparation failed', error, {
            elapsedMs: Date.now() - screenshotStartedAt,
          });
        }
      })();
      await new Promise((resolve) => { endHoldTimeout = setTimeout(resolve, ROUND_END_SCREEN_MS); });
      if (!active) return;
      logVideoDiagnostic('results end-screen hold completed; finalization dispatched', {
        elapsedMs: Date.now() - transitionStartedAt,
      });
      void stopRecordingRef.current().catch((error) => {
        warnVideoDiagnostic('background finalization request rejected', error, {
          elapsedMs: Date.now() - transitionStartedAt,
        });
      });
      await prepareTransition;
      if (active) {
        logVideoDiagnostic('navigating to results while finalization continues', {
          elapsedMs: Date.now() - transitionStartedAt,
        });
        router.replace('/results' as Href);
      }
    };
    showResults();
    return () => {
      active = false;
      if (endHoldTimeout !== undefined) clearTimeout(endHoldTimeout);
    };
  }, [beginTransition, round.status, router]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const leftForeground = previousState === 'active' && nextState !== 'active';
      const enteredForeground = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (leftForeground) {
        if (
          portraitPausePhaseRef.current === 'positioning' ||
          portraitPausePhaseRef.current === 'welcome-back' ||
          portraitPausePhaseRef.current === 'restarting'
        ) {
          portraitResumeOperation.current += 1;
          portraitRecordingResume.current = null;
          pausedResumeAcknowledgementRemaining.current = null;
          setResumeAcknowledgementEndsAt(null);
          portraitPausePhaseRef.current = 'positioning';
          setPortraitPausePhase('positioning');
          void pauseRecording();
        }
        setAppActive(false);
        if (round.status === 'playing' || round.status === 'feedback') {
          timerPausedForBackground.current = true;
          pauseRound();
        }
        if (
          resumeAcknowledgementEndsAt !== null &&
          portraitPausePhaseRef.current !== 'positioning'
        ) {
          pausedResumeAcknowledgementRemaining.current = Math.max(0, resumeAcknowledgementEndsAt - Date.now());
          setResumeAcknowledgementEndsAt(null);
        }
        recordingPausedForBackground.current = portraitPausePhaseRef.current === null;
        if (recordingPausedForBackground.current) void pauseRecording();
      } else if (enteredForeground) {
        setAppActive(true);
        if (timerPausedForBackground.current) {
          timerPausedForBackground.current = false;
          resumeRound();
        }
        if (pausedResumeAcknowledgementRemaining.current !== null) {
          setResumeAcknowledgementEndsAt(Date.now() + pausedResumeAcknowledgementRemaining.current);
          pausedResumeAcknowledgementRemaining.current = null;
        }
        if (recordingPausedForBackground.current && portraitPausePhaseRef.current === null) {
          recordingPausedForBackground.current = false;
          setForegroundResumeGeneration((generation) => generation + 1);
        }
      }
    });
    return () => subscription.remove();
  }, [pauseRecording, pauseRound, resumeAcknowledgementEndsAt, resumeRound, round.status]);

  useEffect(() => {
    if (foregroundResumeGeneration === 0) return;
    // This runs after the resume reducer has committed, so the new camera
    // segment starts against the exact card and clock now on screen.
    void resumeRecordingRef.current();
  }, [foregroundResumeGeneration]);

  if (!deck || !currentCard) return null;

  const isCorrectFeedback = round.latestOutcome === 'correct';
  const isFeedbackVisible = round.status === 'feedback';
  const feedbackColor = isCorrectFeedback ? colors.correct : colors.pass;
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
  const bylineFontSize = getBylineFontSize(width, height);
  const motionControlsUnavailable =
    Platform.OS === 'web' || tiltStatus === 'denied' || tiltStatus === 'unavailable';
  const showManualControls =
    round.status === 'playing' && motionControlsUnavailable;
  const manualControlHeight = Math.round(Math.max(52, Math.min(70, height * 0.16)));
  const manualControlMaxWidth = Math.round(Math.min(720, width * 0.82));
  const manualControlFontSize = Math.round(Math.max(12, Math.min(16, height * 0.034)));

  if (portraitPausePhase === 'prompt') {
    return (
      <SafeAreaView edges={[]} style={styles.portraitPauseRoot}>
        <StatusBar hidden animated={false} />
        <View style={styles.portraitPauseCard}>
          <Text style={styles.portraitPauseTimer}>
            {formatRoundClock(displayedRemainingSeconds)}
          </Text>
          <View style={styles.portraitPauseCopy}>
            <Text style={styles.portraitPauseEyebrow}>
              ROUND PAUSED
            </Text>
            <Text style={styles.portraitPauseTitle}>
              Take a breather
            </Text>
            <Text style={styles.portraitPauseBody}>
              The answer is hidden and the timer is stopped. Put the phone back on your forehead to resume automatically.
            </Text>
          </View>

          <View style={styles.portraitPauseActions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleKeepPlaying}
              style={({ pressed }) => [
                styles.portraitPrimaryButton,
                pressed && styles.promptPressed,
              ]}
            >
              <Text style={styles.portraitPrimaryButtonText}>KEEP PLAYING</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handlePortraitFinish}
              style={({ pressed }) => [
                styles.portraitEndButton,
                pressed && styles.promptPressed,
              ]}
            >
              <Text style={styles.portraitEndButtonText}>END ROUND</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (portraitPausePhase === 'positioning') {
    return (
      <View style={styles.readyCaptureRoot}>
        <LandscapeViewport>
          <SafeAreaView edges={[]} style={styles.readySafeArea}>
            <StatusBar hidden animated={false} />
            <RoundReadyPanel
              closeAccessibilityLabel="End round"
              deckTitle={deck.title}
              isRecording={isRecording}
              onClose={handlePortraitFinish}
            >
              <RoundReadyPosition title="Place on forehead" />
            </RoundReadyPanel>
          </SafeAreaView>
        </LandscapeViewport>
      </View>
    );
  }

  if (portraitPausePhase === 'finished') {
    return (
      <View ref={screenRef} collapsable={false} style={styles.portraitFinishRoot}>
        <SafeAreaView edges={[]} style={styles.portraitFinishSafeArea}>
          <StatusBar hidden animated={false} />
          <View style={styles.portraitFinishCard}>
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1}
              minimumFontScale={0.8}
              numberOfLines={1}
              style={styles.portraitFinishTitle}
            >
              TIME&apos;S UP!
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (portraitPausePhase === 'welcome-back' || portraitPausePhase === 'restarting') {
    return (
      <View style={styles.captureRoot}>
        <LandscapeViewport>
          <SafeAreaView edges={[]} style={styles.readySafeArea}>
            <StatusBar hidden animated={false} />
            <RoundReadyPanel
              closeAccessibilityLabel="End round"
              deckTitle={deck.title}
              isRecording={isRecording}
              onClose={handlePortraitFinish}
            >
              <RoundReadyMessage title="WE'RE BACK!" />
            </RoundReadyPanel>
          </SafeAreaView>
        </LandscapeViewport>
      </View>
    );
  }

  return (
    <View ref={screenRef} collapsable={false} style={styles.captureRoot}>
      <LandscapeViewport>
        <SafeAreaView
          edges={[]}
          style={[
            styles.safeArea,
            { backgroundColor: outerColor },
          ]}
        >
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
                  {formatRoundClock(
                    round.status === 'ready' ? round.durationSeconds : displayedRemainingSeconds,
                  )}
                </Text>
                <Text style={styles.deckName}>{deck.title}</Text>
              </View>
            )}

            <View
              accessible
              accessibilityLabel={
                currentCard.byline
                  ? `${currentCard.text} by ${currentCard.byline}`
                  : currentCard.text
              }
              style={[
                styles.cardArea,
                showManualControls && { paddingBottom: manualControlHeight + spacing.xl },
              ]}
            >
              <View style={styles.cardCopy}>
                <Text
                  maxFontSizeMultiplier={1.1}
                  style={[
                    styles.cardText,
                    { fontSize: cardFontSize, lineHeight: Math.round(cardFontSize * 1.1) },
                  ]}
                >
                  {currentCard.text}
                </Text>
                {currentCard.byline && (
                  <Text
                    maxFontSizeMultiplier={1.1}
                    style={[
                      styles.cardByline,
                      {
                        fontSize: bylineFontSize,
                        lineHeight: Math.round(bylineFontSize * 1.2),
                      },
                    ]}
                  >
                    by {currentCard.byline}
                  </Text>
                )}
              </View>
            </View>

            {showManualControls && (
              <View pointerEvents="box-none" style={styles.controlsDock}>
                <View style={[styles.controls, { maxWidth: manualControlMaxWidth }]}>
                  <Pressable
                    accessibilityLabel="Pass"
                    accessibilityRole="button"
                    onPress={() => handleAnswer('passed')}
                    style={({ pressed }) => [
                      styles.control,
                      styles.passButton,
                      { minHeight: manualControlHeight },
                      pressed && styles.controlPressed,
                    ]}
                  >
                    <Text style={styles.controlIcon}>×</Text>
                    <Text
                      style={[styles.controlText, { fontSize: manualControlFontSize }]}
                    >
                      PASS
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Correct"
                    accessibilityRole="button"
                    onPress={() => handleAnswer('correct')}
                    style={({ pressed }) => [
                      styles.control,
                      styles.correctButton,
                      { minHeight: manualControlHeight },
                      pressed && styles.controlPressed,
                    ]}
                  >
                    <SymbolView
                      accessibilityElementsHidden
                      name={{ android: 'check', ios: 'checkmark', web: 'check' }}
                      size={26}
                      style={styles.controlCheckIcon}
                      tintColor="#000000"
                    />
                    <Text
                      style={[styles.controlText, { fontSize: manualControlFontSize }]}
                    >
                      CORRECT
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {round.status === 'finished' && (
              <View style={styles.transitionOverlay}>
                <Text style={styles.finishTitle}>TIME&apos;S UP!</Text>
              </View>
            )}

            {isRecording && (
              <RecordingIndicator
                position={motionControlsUnavailable ? 'top-left' : 'bottom-left'}
              />
            )}

            {round.status !== 'finished' && round.status !== 'feedback' && (
              <View pointerEvents="box-none" style={styles.closeButton}>
                <CloseButton
                  accessibilityLabel="End round early"
                  disabled={false}
                  onPress={handleFinishEarly}
                />
              </View>
            )}

          </View>

          <View
            accessibilityElementsHidden={!isFeedbackVisible}
            importantForAccessibility={isFeedbackVisible ? 'yes' : 'no-hide-descendants'}
            pointerEvents="none"
            style={[
              styles.feedback,
              { backgroundColor: feedbackColor, opacity: isFeedbackVisible ? 1 : 0 },
            ]}
          >
            <View style={styles.feedbackIconSlot}>
              <SymbolView
                accessibilityElementsHidden
                name={{ android: 'check', ios: 'checkmark', web: 'check' }}
                size={112}
                style={[styles.feedbackCheckIcon, { opacity: isCorrectFeedback ? 1 : 0 }]}
                tintColor={colors.correctText}
              />
              <Text
                style={[
                  styles.feedbackIcon,
                  styles.feedbackPassIcon,
                  { color: colors.passText, opacity: isCorrectFeedback ? 0 : 1 },
                ]}
              >
                ×
              </Text>
            </View>
            <Text
              style={[
                styles.feedbackText,
                { color: isCorrectFeedback ? colors.correctText : colors.passText },
              ]}
            >
              {isCorrectFeedback ? 'CORRECT!' : 'PASS'}
            </Text>
          </View>

          {finishPromptVisible && round.status !== 'finished' && (
            <View accessibilityViewIsModal style={styles.promptOverlay}>
              <View style={styles.promptCard}>
                <Text style={styles.promptTitle}>End round early?</Text>
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
                    <Text style={styles.promptFinishText}>END ROUND</Text>
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

function getBylineFontSize(width: number, height: number) {
  return Math.round(Math.max(34, Math.min(38, height * 0.1, width * 0.055)));
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
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
  readyCaptureRoot: { flex: 1, backgroundColor: colors.surface },
  portraitFinishRoot: { flex: 1, backgroundColor: colors.surface },
  portraitFinishSafeArea: {
    flex: 1,
    padding: ROUND_FRAME_INSET,
    backgroundColor: colors.surface,
  },
  portraitPauseRoot: {
    flex: 1,
    padding: ROUND_FRAME_INSET,
    backgroundColor: colors.playSoft,
  },
  portraitPauseCard: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    borderWidth: ROUND_FRAME_BORDER_WIDTH,
    borderColor: ROUND_PLAYING_BORDER_COLOR,
    borderRadius: ROUND_FRAME_RADIUS,
    backgroundColor: colors.surface,
    justifyContent: 'space-between',
  },
  portraitFinishCard: {
    flex: 1,
    minHeight: 0,
    borderWidth: ROUND_FRAME_BORDER_WIDTH,
    borderColor: colors.playBorder,
    borderRadius: ROUND_FRAME_RADIUS,
    backgroundColor: colors.play,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portraitFinishTitle: {
    maxWidth: '100%',
    paddingHorizontal: spacing.xl,
    color: colors.white,
    fontSize: 48,
    lineHeight: 56,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'center',
  },
  portraitPauseTimer: {
    color: colors.play,
    fontSize: 25,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  portraitPauseCopy: { alignItems: 'center', gap: spacing.md },
  portraitPauseEyebrow: {
    color: colors.play,
    fontSize: 13,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  portraitPauseTitle: {
    ...typography.hero,
    color: colors.ink,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  portraitPauseBody: {
    ...typography.body,
    maxWidth: 310,
    color: colors.muted,
    textAlign: 'center',
  },
  portraitPauseActions: { gap: 12 },
  portraitPrimaryButton: {
    minHeight: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.play,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  portraitPrimaryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  portraitEndButton: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: colors.passBorder,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  portraitEndButtonText: {
    color: colors.pass,
    fontSize: 14,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  readySafeArea: {
    flex: 1,
    padding: ROUND_FRAME_INSET,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  safeArea: {
    flex: 1,
    padding: ROUND_FRAME_INSET,
    overflow: 'hidden',
  },
  panel: {
    flex: 1,
    minHeight: 0,
    borderWidth: ROUND_FRAME_BORDER_WIDTH,
    borderRadius: ROUND_FRAME_RADIUS,
    overflow: 'hidden',
  },
  // Center the 48-point control on the same 36-point axis as the timer and
  // deck name in the 72-point top row.
  closeButton: { position: 'absolute', top: 12, left: 14, zIndex: 70 },
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
  finishButtonText: { color: colors.ink, fontSize: 10, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.1 },
  deckName: {
    position: 'absolute',
    top: 23,
    right: 28,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'center',
  },
  timerLabel: { color: colors.muted, fontSize: 9, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.2 },
  progress: { color: colors.ink, fontSize: 13, fontFamily: 'Inter_900Black', fontWeight: '900', opacity: 0.65 },
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
  sensorText: { color: colors.ink, fontSize: 9, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.2, opacity: 0.62 },
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
  cardCopy: {
    maxWidth: '100%',
    alignItems: 'center',
    gap: 12,
  },
  cardLabel: { color: colors.white, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 2, opacity: 0.72 },
  cardText: {
    color: colors.play,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: -1.6,
    textAlign: 'center',
    maxWidth: '100%',
    flexShrink: 1,
  },
  cardByline: {
    maxWidth: '100%',
    flexShrink: 1,
    color: colors.play,
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
    opacity: 0.82,
  },
  controlsDock: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    alignItems: 'center',
  },
  controls: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.md,
  },
  control: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 3,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passButton: { backgroundColor: colors.pass, borderColor: colors.passBorder },
  correctButton: { backgroundColor: colors.correct, borderColor: colors.correctBorder },
  controlPressed: { transform: [{ scale: 0.98 }], opacity: 0.86 },
  controlIcon: { color: '#000000', fontSize: 26, fontFamily: 'Inter_900Black', fontWeight: '900', lineHeight: 28 },
  controlCheckIcon: { width: 26, height: 26 },
  controlText: { color: '#000000', fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.1 },
  feedback: {
    ...StyleSheet.absoluteFill,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackIcon: { fontSize: 124, fontFamily: 'Inter_700Bold', fontWeight: '700', lineHeight: 130 },
  feedbackIconSlot: { width: 124, height: 130, alignItems: 'center', justifyContent: 'center' },
  feedbackPassIcon: { position: 'absolute', width: 124, textAlign: 'center' },
  feedbackCheckIcon: { width: 112, height: 112 },
  feedbackText: { fontSize: 42, fontFamily: 'Inter_500Medium', fontWeight: '500', letterSpacing: 0.5 },
  transitionOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishKicker: { color: colors.white, fontSize: 12, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 2.2, opacity: 0.72 },
  finishTitle: { color: '#FFFFFF', fontSize: 60, lineHeight: 68, fontFamily: 'Inter_900Black', fontWeight: '900' },
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
  promptCancelText: { color: colors.ink, fontSize: 10, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.9 },
  promptFinishText: { color: colors.ink, fontSize: 10, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.9 },
});

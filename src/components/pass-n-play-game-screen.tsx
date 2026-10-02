import { useKeepAwake } from 'expo-keep-awake';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PassNPlayRoundPanel } from '@/components/pass-n-play-round-panel';
import { useRound } from '@/game/round-context';
import { formatRoundClock } from '@/game/round-duration';
import { getRemainingSecondsFromMs, useRoundTimer } from '@/hooks/use-round-timer';
import { colors, radius, spacing, typography } from '@/theme';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';

const FEEDBACK_MS = 350;
const ROUND_END_SCREEN_MS = 2495;

export function PassNPlayGameScreen() {
  useKeepAwake();
  const focused = useIsFocused();
  const router = useRouter();
  const { round, roundDeck: deck, startRound, answerCard, advanceCard, revealCard,
    expireRound, pauseRound, resumeRound, finishRound, pauseRecording, resumeRecording,
    stopRecording, recordOverlayEvent, isRecording } = useRound();
  const { play, stopAll } = useRoundSounds();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [finishPromptVisible, setFinishPromptVisible] = useState(false);
  const mounted = useRef(false);
  const latest = useRef(round);
  const pause = useRef(pauseRound);
  const videoPause = useRef(pauseRecording);
  const videoStop = useRef(stopRecording);
  const finalizing = useRef(false);
  const lastCue = useRef('');
  useLayoutEffect(() => {
    latest.current = round; pause.current = pauseRound;
    videoPause.current = pauseRecording; videoStop.current = stopRecording;
  }, [pauseRound, pauseRecording, round, stopRecording]);

  const canInteract = useCallback(() => mounted.current && AppState.currentState === 'active', []);
  useFocusEffect(useCallback(() => {
    mounted.current = true;
    if (AppState.currentState !== 'active') pause.current();
    return () => {
      mounted.current = false;
      pause.current();
      if (latest.current.status !== 'finished') void videoPause.current();
      stopAll();
    };
  }, [stopAll]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state !== 'active') {
        pause.current();
        void videoPause.current();
        stopAll();
      }
    });
    return () => subscription.remove();
  }, [stopAll]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setFinishPromptVisible(true);
      return true;
    });
    return () => subscription.remove();
  }, []));

  useLayoutEffect(() => {
    if (!focused || !appActive) return;
    if (!deck || round.status === 'idle') router.replace('/');
    else if (round.status === 'ready') startRound();
  }, [appActive, deck, focused, round.status, router, startRound]);

  const seconds = useRoundTimer({
    endsAt: round.endsAt,
    active: focused && appActive && (round.status === 'playing' || round.status === 'feedback' || round.status === 'handoff'),
    onExpire: () => {
      if (canInteract() && round.endsAt !== null) expireRound(round.endsAt);
    },
    onSecond: (value) => {
      if (!canInteract() || value < 1 || value > 10) return;
      const endsAt = round.endsAt;
      void play('final-tick', () => canInteract() && latest.current.endsAt === endsAt);
      void triggerRoundHaptic('final-countdown', { cameraActive: false });
    },
  });

  useEffect(() => {
    if (!focused || !appActive || round.status !== 'feedback') return;
    const cardIndex = round.currentCardIndex;
    const timeout = setTimeout(() => {
      if (canInteract() && latest.current.status === 'feedback' && latest.current.currentCardIndex === cardIndex) {
        advanceCard();
      }
    }, FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [advanceCard, appActive, canInteract, focused, round.currentCardIndex, round.status]);

  useEffect(() => {
    if (!focused || !appActive) return;
    const status = round.status;
    if (status !== 'feedback' && status !== 'finished' && status !== 'playing') return;
    const key = `${round.currentCardIndex}:${status}`;
    if (lastCue.current === key) return;
    lastCue.current = key;
    const sound = status === 'finished' ? 'round-end'
      : status === 'feedback' ? (round.latestOutcome === 'correct' ? 'correct' : 'pass') : 'flip';
    // The initial reveal already has the round-start cue from the ready screen.
    if (status === 'playing' && round.currentCardIndex === 0) return;
    void play(sound, () => canInteract() && latest.current.status === status &&
      latest.current.currentCardIndex === round.currentCardIndex);
    void triggerRoundHaptic(status === 'finished' ? 'times-up'
      : status === 'feedback' ? (round.latestOutcome === 'correct' ? 'correct' : 'pass') : 'card-flip', { cameraActive: false });
  }, [appActive, canInteract, focused, play, round.currentCardIndex, round.latestOutcome, round.status]);

  useEffect(() => {
    if (round.status === 'playing') {
      const card = deck?.cards.find((candidate) => candidate.id === round.cardOrder[round.currentCardIndex]);
      if (card) recordOverlayEvent({ kind: 'card', text: card.text, byline: card.byline });
    } else if (round.status === 'feedback' && round.latestOutcome) {
      recordOverlayEvent({ kind: round.latestOutcome, text: round.latestOutcome === 'correct' ? 'CORRECT!' : 'PASS' });
    } else if (round.status === 'handoff' || round.status === 'paused') {
      recordOverlayEvent({ kind: 'countdown', text: round.status === 'handoff' ? 'Pass the phone' : 'Round paused' });
    } else if (round.status === 'finished') {
      recordOverlayEvent({ kind: 'times-up', text: "TIME'S UP!" });
    }
  }, [deck, recordOverlayEvent, round.cardOrder, round.currentCardIndex, round.latestOutcome, round.status]);

  useEffect(() => {
    if (!focused || !appActive || round.status !== 'finished') return;
    const timeout = setTimeout(() => {
      if (canInteract() && !finalizing.current) {
        finalizing.current = true;
        // Persist the recording together with the finished result snapshot.
        // Results and My Rounds receive it through the existing video library.
        void videoStop.current().catch(() => undefined);
        router.replace('/results');
      }
    }, ROUND_END_SCREEN_MS);
    return () => clearTimeout(timeout);
  }, [appActive, canInteract, focused, round.status, router]);

  if (!deck) return null;
  const status = !appActive && round.status !== 'finished' ? 'paused' : round.status;
  // Secret text is passed to the presentation only while actively playing.
  const answer = status === 'playing'
    ? deck.cards.find((card) => card.id === round.cardOrder[round.currentCardIndex])
    : undefined;
  const displayedSeconds = round.status === 'paused'
    ? getRemainingSecondsFromMs(round.remainingMs)
    : round.status === 'ready' ? round.durationSeconds : seconds;
  return (
    <SafeAreaView edges={[]} style={[styles.screen,
      status === 'feedback' && styles.feedback,
      status === 'finished' && styles.finished]}>
      <StatusBar hidden />
      <PassNPlayRoundPanel status={status} outcome={round.latestOutcome} deckTitle={deck.title}
        clock={formatRoundClock(displayedSeconds)} answer={answer}
        isRecording={isRecording && focused && appActive}
        onPass={() => { if (canInteract()) answerCard('passed'); }}
        onCorrect={() => { if (canInteract()) answerCard('correct'); }}
        onReveal={() => { if (canInteract()) revealCard(); }}
        onClose={() => { if (canInteract()) setFinishPromptVisible(true); }}
        onResume={() => {
          if (!canInteract()) return;
          void resumeRecording({ restoreOverlay: false }).catch(() => false).then(() => {
            if (canInteract() && latest.current.status === 'paused') resumeRound();
          });
        }}
        onFinish={() => { if (canInteract()) finishRound(); }} />
      {finishPromptVisible && status !== 'finished' && (
        <View accessibilityViewIsModal style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text accessibilityRole="header" style={styles.promptTitle}>End round early?</Text>
            <Text style={styles.promptBody}>
              Your answers so far will still appear in the results.
            </Text>
            <View style={styles.promptActions}>
              <Pressable accessibilityRole="button" onPress={() => setFinishPromptVisible(false)}
                style={({ pressed }) => [styles.keepPlaying, pressed && styles.promptPressed]}>
                <Text style={styles.keepPlayingText}>KEEP PLAYING</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => {
                if (!canInteract()) return;
                setFinishPromptVisible(false);
                finishRound();
              }} style={({ pressed }) => [styles.endRound, pressed && styles.promptPressed]}>
                <Text style={styles.endRoundText}>END ROUND</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md, backgroundColor: colors.playSoft },
  feedback: { padding: 0 },
  finished: { backgroundColor: colors.surface },
  promptOverlay: { ...StyleSheet.absoluteFill, zIndex: 100, backgroundColor: 'rgba(24,35,29,0.42)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  promptCard: { width: '100%', maxWidth: 440, padding: spacing.xl,
    borderRadius: radius.xl, backgroundColor: colors.background },
  promptTitle: { ...typography.title, color: colors.ink, textAlign: 'center' },
  promptBody: { ...typography.body, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },
  promptActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  keepPlaying: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  keepPlayingText: { color: colors.ink, fontSize: 10, fontFamily: 'Inter_900Black',
    fontWeight: '900', letterSpacing: 0.9 },
  endRound: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.lg, backgroundColor: colors.pass },
  endRoundText: { color: colors.ink, fontSize: 10, fontFamily: 'Inter_900Black',
    fontWeight: '900', letterSpacing: 0.9 },
  promptPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
});

import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CloseButton } from '@/components/close-button';
import { RecordingIndicator } from '@/components/recording-indicator';
import {
  initialPassNPlayReadyState, passNPlayReadyReducer, type PassNPlayReadyAction,
} from '@/game/pass-n-play-ready';
import { useRound } from '@/game/round-context';
import { useRoundTimer } from '@/hooks/use-round-timer';
import { colors, radius, spacing, typography } from '@/theme';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';

export function PassNPlayReadyScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const { round, roundDeck, resetRound, prepareRecording, startRecording,
    cancelRecording, recordOverlayEvent, pauseRecording, resumeRecording, isRecording } = useRound();
  // Keep the outgoing card visible while the native back transition runs.
  const [deck] = useState(roundDeck);
  const { play, prepareForRound, stopAll, stopIntro } = useRoundSounds();
  const [timeline, commit] = useReducer(passNPlayReadyReducer, initialPassNPlayReadyState);
  const current = useRef(initialPassNPlayReadyState);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const mounted = useRef(false);
  const leaving = useRef(false);
  const launched = useRef(false);
  const generation = useRef(0);
  const lastCount = useRef<number | null>(null);

  const send = useCallback((action: PassNPlayReadyAction) => {
    current.current = passNPlayReadyReducer(current.current, action);
    commit(action);
  }, []);
  const canContinue = useCallback(() => mounted.current && !leaving.current &&
    AppState.currentState === 'active', []);

  useEffect(() => {
    if (!focused || !appActive || round.status !== 'ready') return;
    mounted.current = true;
    send({ type: 'RESUME', now: Date.now() });
    stopAll();
    const cueGeneration = generation.current;
    let preparationTimeout: ReturnType<typeof setTimeout>;
    // Rewind audio before the chime starts, with a bounded wait for audio.
    const grace = new Promise<void>((resolve) => {
      preparationTimeout = setTimeout(resolve, 4000);
    });
    const recording = prepareRecording().then((preparation) => {
      if (preparation !== 'ready' || !canContinue() || cueGeneration !== generation.current) return false;
      return current.current.phase === 'waiting' ? startRecording()
        : resumeRecording({ restoreOverlay: false });
    }).catch(() => false);
    void Promise.race([Promise.all([recording, prepareForRound().catch(() => false)]), grace]).then(() => {
      clearTimeout(preparationTimeout);
      if (!canContinue() || cueGeneration !== generation.current || current.current.phase !== 'waiting') return;
      send({ type: 'BEGIN', now: Date.now() });
      recordOverlayEvent({ kind: 'countdown', text: 'GET READY' });
      void play('get-ready', () => canContinue() && cueGeneration === generation.current &&
        current.current.phase === 'intro');
      void triggerRoundHaptic('get-ready', { cameraActive: false });
    });
    return () => {
      clearTimeout(preparationTimeout);
      mounted.current = false;
      generation.current += 1;
      send({ type: 'PAUSE', now: Date.now() });
      if (!launched.current && !leaving.current) void pauseRecording();
      stopIntro();
    };
  }, [appActive, canContinue, focused, play, prepareForRound, prepareRecording, recordOverlayEvent,
    pauseRecording, resumeRecording, round.status, send, startRecording, stopAll, stopIntro]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setAppActive(active);
      if (active && mounted.current) {
        send({ type: 'RESUME', now: Date.now() });
      } else if (!active) {
        generation.current += 1;
        send({ type: 'PAUSE', now: Date.now() });
        stopAll();
      }
    });
    return () => subscription.remove();
  }, [send, stopAll]);

  const cancel = useCallback(async () => {
    if (leaving.current || launched.current) return;
    leaving.current = true;
    generation.current += 1;
    stopAll();
    await cancelRecording();
    const deckId = round.deckId;
    const durationSeconds = String(round.durationSeconds);
    send({ type: 'CANCEL' });
    resetRound();
    if (router.canGoBack()) {
      // Ready was pushed from deck details. Reuse that screen so cancelling
      // does not leave another deck screen in the navigation history.
      router.back();
    } else if (deckId) {
      router.replace({ pathname: '/deck/[deckId]', params: {
        deckId, durationSeconds, mode: 'pass-n-play',
      } });
    } else {
      router.replace('/');
    }
  }, [cancelRecording, resetRound, round.deckId, round.durationSeconds, router, send, stopAll]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void cancel();
      return true;
    });
    return () => subscription.remove();
  }, [cancel]));

  useEffect(() => {
    if (!focused || !appActive || timeline.phase !== 'intro' || timeline.endsAt === null) return;
    const endsAt = timeline.endsAt;
    const timeout = setTimeout(() => {
      if (canContinue()) send({ type: 'TICK', now: Date.now(), endsAt });
    }, Math.max(0, endsAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [appActive, canContinue, focused, send, timeline.endsAt, timeline.phase]);

  const count = useRoundTimer({
    endsAt: timeline.phase === 'countdown' ? timeline.endsAt : null,
    active: focused && appActive && timeline.phase === 'countdown',
    onExpire: () => {
      const endsAt = current.current.endsAt;
      if (canContinue() && current.current.phase === 'countdown' && endsAt !== null) {
        send({ type: 'TICK', now: Date.now(), endsAt });
      }
    },
    onSecond: (value) => {
      if (!canContinue() || value < 1 || value > 3 || lastCount.current === value) return;
      lastCount.current = value;
      recordOverlayEvent({ kind: 'countdown', text: String(value) });
      const cueGeneration = generation.current;
      void play(value === 3 ? 'count-3' : value === 2 ? 'count-2' : 'count-1',
        () => canContinue() && cueGeneration === generation.current && lastCount.current === value);
      void triggerRoundHaptic('initial-countdown', { cameraActive: false, countdownValue: value as 1 | 2 | 3 });
    },
  });

  useEffect(() => {
    if (!focused || !appActive || leaving.current || launched.current) return;
    if (!deck || round.status === 'idle') {
      router.replace('/');
    } else if (round.status === 'finished') {
      router.replace('/results');
    } else if (round.status !== 'ready' || timeline.phase === 'complete') {
      launched.current = true;
      if (timeline.phase === 'complete') void play('round-start', canContinue);
      router.replace('/game');
    }
  }, [appActive, canContinue, deck, focused, play, round.status, router, timeline.phase]);

  if (!deck) return null;
  return (
    <SafeAreaView edges={[]} style={styles.screen}>
      <StatusBar hidden />
      <View style={styles.panel}>
        <View style={styles.header}>
          <CloseButton accessibilityLabel="Cancel round setup" onPress={() => void cancel()} />
          <Text style={styles.deckTitle}>{deck.title}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {timeline.phase === 'countdown' || timeline.phase === 'complete' ? (
            <Text accessibilityLiveRegion="polite" style={styles.count}>{Math.max(1, count)}</Text>
          ) : (
            <Text accessibilityRole="header" style={styles.title}>GET READY</Text>
          )}
        </ScrollView>
        {isRecording && focused && appActive && <RecordingIndicator position="bottom-left" />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md, backgroundColor: colors.surface },
  panel: { flex: 1, borderWidth: 6, borderColor: colors.playBorder,
    borderRadius: radius.xl, backgroundColor: colors.play, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  deckTitle: { flex: 1, ...typography.body, color: colors.white, textAlign: 'right', textTransform: 'uppercase' },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.hero, color: colors.white, textAlign: 'center' },
  count: { fontFamily: 'Inter_900Black', fontSize: 128, lineHeight: 145,
    color: colors.white, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

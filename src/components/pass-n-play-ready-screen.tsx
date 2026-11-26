import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CloseButton } from '@/components/close-button';
import { RecordingIndicator } from '@/components/recording-indicator';
import {
  initialPassNPlayReadyState, passNPlayReadyReducer, type PassNPlayReadyAction,
} from '@/game/pass-n-play-ready';
import { type RecordingPreparation, useRound } from '@/game/round-context';
import { useRoundTimer } from '@/hooks/use-round-timer';
import { colors, radius, spacing, typography } from '@/theme';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';

export function PassNPlayReadyScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const { round, roundDeck, resetRound, prepareRecording, startRecording,
    cancelRecording, disableRecordingForRound, recordOverlayEvent, pauseRecording,
    recoverCameraPermission, resumeRecording, isRecording } = useRound();
  // Keep the outgoing card visible while the native back transition runs.
  const [deck] = useState(roundDeck);
  const { play, prepareForRound, stopAll, stopIntro } = useRoundSounds();
  const [timeline, commit] = useReducer(passNPlayReadyReducer, initialPassNPlayReadyState);
  const current = useRef(initialPassNPlayReadyState);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [recordingPreparation, setRecordingPreparation] =
    useState<RecordingPreparation | 'preparing'>('preparing');
  const [cameraRecoveryMessage, setCameraRecoveryMessage] = useState<string | null>(null);
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
    const recording = prepareRecording().then(async (preparation) => {
      if (!canContinue() || cueGeneration !== generation.current) return false;
      if (preparation === 'unavailable') {
        setRecordingPreparation(preparation);
        return 'video-disabled' as const;
      }
      if (preparation !== 'ready') {
        setRecordingPreparation(preparation);
        return null;
      }
      const started = current.current.phase === 'waiting' ? await startRecording()
        : await resumeRecording({ restoreOverlay: false });
      if (!canContinue() || cueGeneration !== generation.current) return false;
      setRecordingPreparation(started ? 'ready' : 'error');
      return started ? ('recording' as const) : null;
    }).catch(() => {
      if (canContinue() && cueGeneration === generation.current) setRecordingPreparation('error');
      return null;
    });
    const audio = Promise.race([prepareForRound().catch(() => false), grace]);
    void Promise.all([recording, audio]).then(([captureState]) => {
      clearTimeout(preparationTimeout);
      if (!captureState || !canContinue() || cueGeneration !== generation.current ||
          current.current.phase !== 'waiting') return;
      send({ type: 'BEGIN', now: Date.now() });
      recordOverlayEvent({ kind: 'countdown', text: 'GET READY' });
      void play('get-ready', () => canContinue() && cueGeneration === generation.current &&
        current.current.phase === 'intro');
      void triggerRoundHaptic('get-ready', { cameraActive: captureState === 'recording' });
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

  const retryCamera = useCallback(async () => {
    if (leaving.current || current.current.phase !== 'waiting') return;
    const retryGeneration = ++generation.current;
    await cancelRecording();
    if (!canContinue() || retryGeneration !== generation.current) return;
    setCameraRecoveryMessage(null);
    const recovery = await recoverCameraPermission();
    if (!canContinue() || retryGeneration !== generation.current) return;
    if (recovery === 'settings-opened') {
      setCameraRecoveryMessage('Turn on Camera access in Settings, then return to WHATZ IT.');
      return;
    }
    if (recovery === 'settings-error') {
      setCameraRecoveryMessage('Settings could not be opened. Open this app in device Settings and turn on Camera access.');
      return;
    }
    if (recovery === 'denied') {
      setRecordingPreparation('permission-denied');
      return;
    }
    setRecordingPreparation('preparing');
    const preparation = await prepareRecording();
    if (!canContinue() || retryGeneration !== generation.current) return;
    if (preparation !== 'ready') {
      setRecordingPreparation(preparation === 'unavailable' ? 'error' : preparation);
      return;
    }
    const started = await startRecording();
    if (!canContinue() || retryGeneration !== generation.current) return;
    setRecordingPreparation(started ? 'ready' : 'error');
    if (started) {
      await prepareForRound().catch(() => false);
      if (!canContinue() || retryGeneration !== generation.current) return;
      send({ type: 'BEGIN', now: Date.now() });
      recordOverlayEvent({ kind: 'countdown', text: 'GET READY' });
      void play('get-ready', () => canContinue() && retryGeneration === generation.current);
    }
  }, [canContinue, cancelRecording, play, prepareForRound, prepareRecording,
    recordOverlayEvent, recoverCameraPermission, send, startRecording]);

  const playWithoutVideo = useCallback(async () => {
    if (leaving.current || current.current.phase !== 'waiting') return;
    const skipGeneration = ++generation.current;
    await disableRecordingForRound();
    if (!canContinue() || skipGeneration !== generation.current) return;
    setRecordingPreparation('unavailable');
    send({ type: 'BEGIN', now: Date.now() });
    void play('get-ready', () => canContinue() && skipGeneration === generation.current);
    void triggerRoundHaptic('get-ready', { cameraActive: false });
  }, [canContinue, disableRecordingForRound, play, send]);

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
          {recordingPreparation === 'error' || recordingPreparation.startsWith('permission-') ? (
            <>
              <Text accessibilityRole="header" style={styles.title}>CAMERA NOT READY</Text>
              <Text style={styles.cameraMessage}>
                {cameraRecoveryMessage ?? 'The round will wait so your full video is not missed.'}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void retryCamera()} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>RETRY CAMERA</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void playWithoutVideo()} style={styles.skipButton}>
                <Text style={styles.skipButtonText}>PLAY WITHOUT VIDEO</Text>
              </Pressable>
            </>
          ) : timeline.phase === 'countdown' || timeline.phase === 'complete' ? (
            <Text accessibilityLiveRegion="polite" style={styles.count}>{Math.max(1, count)}</Text>
          ) : (
            <Text accessibilityRole="header" style={styles.title}>GET READY</Text>
          )}
        </ScrollView>
        <Text style={styles.instruction}>
          Get your friends to guess the card, then pass the phone.
        </Text>
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
  instruction: { ...typography.body, color: colors.white, textAlign: 'center',
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  count: { fontFamily: 'Inter_900Black', fontSize: 128, lineHeight: 145,
    color: colors.white, textAlign: 'center', fontVariant: ['tabular-nums'] },
  cameraMessage: { ...typography.body, color: colors.white, textAlign: 'center' },
  retryButton: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill, backgroundColor: colors.surface },
  retryButtonText: { color: colors.ink, fontFamily: 'Inter_900Black', letterSpacing: 1.2 },
  skipButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  skipButtonText: { color: colors.white, fontFamily: 'Inter_900Black', letterSpacing: 1.1 },
});

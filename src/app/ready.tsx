import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { CloseButton } from '@/components/close-button';
import { LandscapeViewport, useLandscapeDimensions } from '@/components/landscape-viewport';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { RecordingIndicator } from '@/components/recording-indicator';
import { getDeckById } from '@/data/packs';
import { type RecordingPreparation, useRound } from '@/game/round-context';
import { useForeheadPosition } from '@/hooks/use-forehead-position';
import { useRoundTimer } from '@/hooks/use-round-timer';
import { colors, radius, spacing } from '@/theme';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';
import type { RoundSoundId } from '@/video/round-sounds';
import { logRoundDiagnostic, warnRoundDiagnostic } from '@/video/video-diagnostics';

const GET_READY_SOUND_MS = 2410;
const READY_TRANSITION_MS = 450;

export default function ReadyScreen() {
  const { height } = useLandscapeDimensions();
  const router = useRouter();
  const {
    cancelRecording,
    isRecording,
    pauseRecording,
    prepareRecording,
    recordOverlayEvent,
    round,
    resetRound,
    resumeRecording,
    startRecording,
  } = useRound();
  const deck = getDeckById(round.deckId ?? undefined);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [introEndsAt, setIntroEndsAt] = useState<number | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [orientationSettled, setOrientationSettled] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [soundsPrepared, setSoundsPrepared] = useState(false);
  const [soundPreparationFailed, setSoundPreparationFailed] = useState(false);
  const [recordingPreparation, setRecordingPreparation] =
    useState<RecordingPreparation | 'preparing'>('preparing');
  const [isLeaving, setIsLeaving] = useState(false);
  const launched = useRef(false);
  const introStarted = useRef(false);
  const soundPreparationStarted = useRef(false);
  const previousGateSignature = useRef('');
  const pausedIntroRemaining = useRef<number | null>(null);
  const pausedCountdownRemaining = useRef<number | null>(null);
  const screenRef = useRef<View>(null);
  const { beginTransition, revealTransition } = useScreenshotTransition();
  const {
    isReady: soundsReady,
    loadTimedOut: soundLoadTimedOut,
    play: playSound,
    prepareForRound,
    retryLoading,
  } = useRoundSounds();
  const foreheadStatus = useForeheadPosition(round.status === 'ready');
  const positionReady =
    foreheadStatus === 'ready' ||
    foreheadStatus === 'denied' ||
    foreheadStatus === 'unavailable';
  const motionControlsUnavailable =
    foreheadStatus === 'denied' || foreheadStatus === 'unavailable';
  const recordingPrepared =
    recordingPreparation === 'ready' ||
    recordingPreparation === 'permission-denied' ||
    recordingPreparation === 'unavailable';
  const handleCountdownSecond = useCallback(
    (remaining: number) => {
      if (remaining < 1 || remaining > 3) return;
      const sound: RoundSoundId =
        remaining === 3 ? 'count-3' : remaining === 2 ? 'count-2' : 'count-1';
      recordOverlayEvent({ kind: 'countdown', text: String(remaining) });
      logRoundDiagnostic('ready countdown cue firing', {
        remaining,
        sound,
        targetEndsAt: countdownEndsAt,
        now: Date.now(),
      });
      void triggerRoundHaptic('initial-countdown', {
        cameraActive: isRecording,
        countdownValue: remaining as 1 | 2 | 3,
      });
      void playSound(sound);
    },
    [countdownEndsAt, isRecording, playSound, recordOverlayEvent],
  );
  const handleCountdownExpire = useCallback(() => {
    if (launched.current) return;
    launched.current = true;
    void playSound('round-start');
    logRoundDiagnostic('ready countdown expired; playing round start cue and navigating to game', {
      countdownEndsAt,
      now: Date.now(),
    });
    router.replace('/game' as Href);
  }, [countdownEndsAt, playSound, router]);
  const count = useRoundTimer({
    endsAt: countdownEndsAt,
    active: appActive && introComplete && !isLeaving,
    onExpire: handleCountdownExpire,
    onSecond: handleCountdownSecond,
  });

  const beginCountdown = useCallback(() => {
    const endsAt = Date.now() + 3000;
    logRoundDiagnostic('get-ready completed; starting absolute 3-2-1 countdown', {
      endsAt,
      now: Date.now(),
    });
    setIntroEndsAt(null);
    setCountdownEndsAt(endsAt);
    setIntroComplete(true);
  }, []);

  useEffect(() => {
    if (!appActive || introEndsAt === null || introComplete || isLeaving) return;
    const remaining = Math.max(0, introEndsAt - Date.now());
    const timeout = setTimeout(beginCountdown, remaining);
    return () => clearTimeout(timeout);
  }, [appActive, beginCountdown, introComplete, introEndsAt, isLeaving]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const leftForeground = previousState === 'active' && nextState !== 'active';
      const enteredForeground = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (leftForeground) {
        setAppActive(false);
        if (introEndsAt !== null) {
          pausedIntroRemaining.current = Math.max(0, introEndsAt - Date.now());
          setIntroEndsAt(null);
        }
        if (countdownEndsAt !== null) {
          pausedCountdownRemaining.current = Math.max(0, countdownEndsAt - Date.now());
          setCountdownEndsAt(null);
        }
        void pauseRecording();
      } else if (enteredForeground) {
        const now = Date.now();
        setAppActive(true);
        if (pausedIntroRemaining.current !== null) {
          setIntroEndsAt(now + pausedIntroRemaining.current);
          pausedIntroRemaining.current = null;
        }
        if (pausedCountdownRemaining.current !== null) {
          setCountdownEndsAt(now + pausedCountdownRemaining.current);
          pausedCountdownRemaining.current = null;
        }
        if (introStarted.current) {
          void resumeRecording();
        } else if (recordingPreparation === 'ready') {
          setRecordingPreparation('preparing');
          void prepareRecording().then(setRecordingPreparation);
        }
      }
    });
    return () => subscription.remove();
  }, [
    countdownEndsAt,
    introEndsAt,
    pauseRecording,
    prepareRecording,
    recordingPreparation,
    resumeRecording,
  ]);

  useEffect(() => {
    const details = {
      foreheadStatus,
      introComplete,
      introStarted: introStarted.current,
      isLeaving,
      orientationSettled,
      positionReady,
      recordingPreparation,
      recordingPrepared,
      roundStatus: round.status,
      soundLoadTimedOut,
      soundPreparationFailed,
      soundsPrepared,
      soundsReady,
    };
    const signature = JSON.stringify(details);
    if (signature === previousGateSignature.current) return;
    previousGateSignature.current = signature;
    logRoundDiagnostic('ready screen gate state changed', details);
  });

  useEffect(() => {
    if (!soundsReady || soundPreparationStarted.current) return;
    soundPreparationStarted.current = true;
    logRoundDiagnostic('ready screen starting round audio preparation');
    let active = true;
    void prepareForRound().then((prepared) => {
      logRoundDiagnostic('ready screen received audio preparation result', { active, prepared });
      if (!active) return;
      setSoundsPrepared(prepared);
      setSoundPreparationFailed(!prepared);
      if (!prepared) soundPreparationStarted.current = false;
    });
    return () => {
      active = false;
    };
  }, [prepareForRound, soundsReady]);

  useEffect(() => {
    let active = true;
    logRoundDiagnostic('ready screen requesting camera and microphone preparation');
    prepareRecording().then((preparation) => {
      logRoundDiagnostic('ready screen received recording preparation result', {
        active,
        preparation,
      });
      if (active) setRecordingPreparation(preparation);
    });
    return () => {
      active = false;
    };
  }, [prepareRecording]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      logRoundDiagnostic('ready screen orientation transition settled');
      setOrientationSettled(true);
    }, READY_TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (orientationSettled) void revealTransition('ready');
  }, [orientationSettled, revealTransition]);

  useEffect(() => {
    if (
      !positionReady ||
      !orientationSettled ||
      !recordingPrepared ||
      !soundsPrepared ||
      !appActive ||
      isLeaving ||
      introStarted.current
    ) return;
    introStarted.current = true;
    logRoundDiagnostic('ready intro gates passed; starting recording before audio', {
      recordingPreparation,
    });
    let active = true;
    const startIntro = async () => {
      const started = await startRecording();
      logRoundDiagnostic('ready intro recording start resolved', {
        active,
        recordingPreparation,
        started,
      });
      if (!active) return;
      if (recordingPreparation === 'ready' && !started) {
        introStarted.current = false;
        setRecordingPreparation('error');
        return;
      }
      // Recording must be active before the first note so Get Ready is present
      // in the saved round video from its beginning.
      if (started) {
        recordOverlayEvent({ kind: 'countdown', text: 'GET READY' });
        logRoundDiagnostic('get-ready overlay attached to recording');
      }
      void triggerRoundHaptic('get-ready', { cameraActive: started });
      const played = await playSound('get-ready');
      logRoundDiagnostic('get-ready playback request completed', { active, played });
      if (!active) return;
      if (!played) {
        // A live cue is feedback, not a prerequisite for gameplay. The cue is
        // still attached to the exported video, so continue the intro even if
        // the device's native playback path becomes unavailable.
        warnRoundDiagnostic(
          'get-ready live playback did not start; continuing round intro',
          new Error('Player rejected playback'),
        );
      }
      setIntroEndsAt(Date.now() + GET_READY_SOUND_MS);
    };
    void startIntro();
    return () => {
      active = false;
    };
  }, [
    isLeaving,
    appActive,
    orientationSettled,
    playSound,
    positionReady,
    recordOverlayEvent,
    recordingPreparation,
    recordingPrepared,
    soundsPrepared,
    startRecording,
  ]);

  useEffect(() => {
    if (isLeaving) return;

    if (!deck || round.status === 'idle') {
      logRoundDiagnostic('ready screen redirecting to home', { hasDeck: !!deck, roundStatus: round.status });
      router.replace('/');
      return;
    }

    if (round.status === 'playing' || round.status === 'feedback') {
      logRoundDiagnostic('ready screen redirecting to active game', { roundStatus: round.status });
      router.replace('/game' as Href);
      return;
    }

    if (round.status === 'finished') {
      logRoundDiagnostic('ready screen redirecting to results', { roundStatus: round.status });
      router.replace('/results' as Href);
      return;
    }

  }, [deck, isLeaving, round.status, router]);

  if (!deck) return null;

  const countSize = Math.max(92, Math.min(138, height * 0.34));

  const handleRetryCamera = async () => {
    logRoundDiagnostic('manual camera retry requested');
    await cancelRecording();
    setRecordingPreparation('preparing');
    setRecordingPreparation(await prepareRecording());
  };

  const handleRetryAudio = async () => {
    logRoundDiagnostic('manual audio retry requested from ready screen');
    if (introStarted.current) {
      await cancelRecording();
      setRecordingPreparation('preparing');
      setRecordingPreparation(await prepareRecording());
    }
    introStarted.current = false;
    soundPreparationStarted.current = false;
    setSoundsPrepared(false);
    setSoundPreparationFailed(false);
    retryLoading();
  };

  const handlePlayWithoutVideo = async () => {
    await cancelRecording();
    setRecordingPreparation('unavailable');
  };

  const handleCancel = async () => {
    setIsLeaving(true);
    await cancelRecording();
    try {
      const uri = await captureRef(screenRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      await beginTransition({
        destination: 'deck',
        direction: 'right',
        uri,
      });
    } catch {
      // If capture is unavailable, navigation still completes normally.
    }
    resetRound();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/deck/${deck.id}` as Href);
    }
  };

  return (
    <View ref={screenRef} collapsable={false} style={styles.captureRoot}>
      <LandscapeViewport>
        <SafeAreaView edges={[]} style={styles.safeArea}>
          <StatusBar hidden animated={false} />
          <View style={styles.panel}>
            <View style={styles.closeButton}>
              <CloseButton
                accessibilityLabel="Cancel round"
                disabled={isLeaving || !orientationSettled}
                onPress={handleCancel}
              />
            </View>
            <Text style={styles.deckName}>{deck.title}</Text>

            <View style={styles.center}>
              {soundLoadTimedOut || soundPreparationFailed ? (
                <>
                  <Text style={styles.positionTitle}>AUDIO NOT READY</Text>
                  <Text style={styles.instructions}>
                    The round is paused so no game sounds are missed.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleRetryAudio()}
                    style={styles.manualButton}
                  >
                    <Text style={styles.manualButtonText}>RETRY AUDIO</Text>
                  </Pressable>
                </>
              ) : recordingPreparation === 'error' ? (
                <>
                  <Text style={styles.positionTitle}>CAMERA NOT READY</Text>
                  <Text style={styles.instructions}>
                    The round will wait so your full video is not missed.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleRetryCamera}
                    style={styles.manualButton}
                  >
                    <Text style={styles.manualButtonText}>RETRY CAMERA</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handlePlayWithoutVideo()}
                    style={styles.skipVideoButton}
                  >
                    <Text style={styles.skipVideoButtonText}>PLAY WITHOUT VIDEO</Text>
                  </Pressable>
                </>
              ) : positionReady ? (
                <>
                  {introComplete ? (
                    <Text
                      style={[styles.count, { fontSize: countSize, lineHeight: countSize * 1.05 }]}
                    >
                      {count}
                    </Text>
                  ) : (
                    <Text style={styles.getReady}>GET READY</Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.positionTitle}>{getPositionMessage(foreheadStatus)}</Text>
                  <Text style={styles.instructions}>Tilt down for correct, tilt up to pass</Text>
                </>
              )}
            </View>
          </View>
          {isRecording && (
            <RecordingIndicator
              position={motionControlsUnavailable ? 'top-left' : 'bottom-left'}
            />
          )}
        </SafeAreaView>
      </LandscapeViewport>
    </View>
  );
}

function getPositionMessage(status: ReturnType<typeof useForeheadPosition>) {
  switch (status) {
    case 'checking':
      return 'Checking device motion...';
    case 'waiting':
      return 'Place on forehead';
    case 'ready':
      return 'Ready';
    case 'denied':
      return 'Motion access is off';
    case 'unavailable':
      return 'Motion detection is unavailable';
  }
}

const styles = StyleSheet.create({
  captureRoot: { flex: 1, backgroundColor: colors.surface },
  safeArea: {
    flex: 1,
    padding: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  panel: {
    flex: 1,
    minHeight: 0,
    borderWidth: 6,
    borderColor: colors.playBorder,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.play,
  },
  closeButton: { position: 'absolute', top: 14, left: 14, zIndex: 2 },
  deckName: {
    position: 'absolute',
    top: 23,
    right: 28,
    color: colors.white,
    fontSize: 18,
    fontWeight: '400',
    textTransform: 'uppercase',
  },
  center: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 86,
    paddingVertical: spacing.xl,
  },
  count: { color: colors.white, fontWeight: '900' },
  getReady: {
    color: colors.white,
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '900',
    letterSpacing: 1,
  },
  positionTitle: {
    color: colors.white,
    fontSize: 46,
    lineHeight: 52,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  instructions: {
    color: colors.white,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: 520,
  },
  manualButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  manualButtonText: { color: '#000000', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  skipVideoButton: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  skipVideoButtonText: { color: colors.white, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
});

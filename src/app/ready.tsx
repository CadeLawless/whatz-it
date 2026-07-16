import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { CloseButton } from '@/components/close-button';
import { LandscapeViewport, useLandscapeDimensions } from '@/components/landscape-viewport';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { getDeckById } from '@/data/decks';
import { type RecordingPreparation, useRound } from '@/game/round-context';
import { useForeheadPosition } from '@/hooks/use-forehead-position';
import { useRoundTimer } from '@/hooks/use-round-timer';
import { colors, radius, spacing } from '@/theme';
import { useRoundSounds } from '@/video/round-sound-provider';
import type { RoundSoundId } from '@/video/round-sounds';

const GET_READY_SOUND_MS = 1898;
const READY_TRANSITION_MS = 450;

export default function ReadyScreen() {
  const { height } = useLandscapeDimensions();
  const router = useRouter();
  const {
    cancelRecording,
    prepareRecording,
    recordOverlayEvent,
    recordSoundCue,
    round,
    resetRound,
    startRecording,
  } = useRound();
  const deck = getDeckById(round.deckId ?? undefined);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [manualReady, setManualReady] = useState(false);
  const [orientationSettled, setOrientationSettled] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [soundsPrepared, setSoundsPrepared] = useState(false);
  const [recordingPreparation, setRecordingPreparation] =
    useState<RecordingPreparation | 'preparing'>('preparing');
  const [isLeaving, setIsLeaving] = useState(false);
  const launched = useRef(false);
  const introStarted = useRef(false);
  const soundPreparationStarted = useRef(false);
  const screenRef = useRef<View>(null);
  const { beginTransition, revealTransition } = useScreenshotTransition();
  const { isReady: soundsReady, play: playSound, prepareForRound } = useRoundSounds();
  const foreheadStatus = useForeheadPosition(round.status === 'ready');
  const positionReady = foreheadStatus === 'ready' || manualReady;
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
      recordSoundCue(sound);
      void playSound(sound);
    },
    [playSound, recordOverlayEvent, recordSoundCue],
  );
  const handleCountdownExpire = useCallback(() => {
    if (launched.current) return;
    launched.current = true;
    router.replace('/game' as Href);
  }, [router]);
  const count = useRoundTimer({
    endsAt: countdownEndsAt,
    active: introComplete && !isLeaving,
    onExpire: handleCountdownExpire,
    onSecond: handleCountdownSecond,
  });

  useEffect(() => {
    if (!soundsReady || soundPreparationStarted.current) return;
    soundPreparationStarted.current = true;
    let active = true;
    void prepareForRound().then((prepared) => {
      if (active) setSoundsPrepared(prepared);
    });
    return () => {
      active = false;
    };
  }, [prepareForRound, soundsReady]);

  useEffect(() => {
    let active = true;
    prepareRecording().then((preparation) => {
      if (active) setRecordingPreparation(preparation);
    });
    return () => {
      active = false;
    };
  }, [prepareRecording]);

  useEffect(() => {
    const timeout = setTimeout(() => setOrientationSettled(true), READY_TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (orientationSettled) revealTransition('ready');
  }, [orientationSettled, revealTransition]);

  useEffect(() => {
    if (
      !positionReady ||
      !orientationSettled ||
      !recordingPrepared ||
      !soundsPrepared ||
      isLeaving ||
      introStarted.current
    ) return;
    introStarted.current = true;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startIntro = async () => {
      const started = await startRecording();
      if (!active) return;
      if (recordingPreparation === 'ready' && !started) {
        introStarted.current = false;
        setRecordingPreparation('error');
        return;
      }
      // Recording must be active before the first note so Get Ready is present
      // in the saved round video from its beginning.
      recordSoundCue('get-ready');
      const played = await playSound('get-ready');
      if (!active) return;
      if (!played) {
        introStarted.current = false;
        setSoundsPrepared(false);
        return;
      }
      timeout = setTimeout(() => {
        setCountdownEndsAt(Date.now() + 3000);
        setIntroComplete(true);
      }, GET_READY_SOUND_MS);
    };
    void startIntro();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [
    isLeaving,
    orientationSettled,
    playSound,
    positionReady,
    recordingPreparation,
    recordingPrepared,
    recordSoundCue,
    soundsPrepared,
    startRecording,
  ]);

  useEffect(() => {
    if (isLeaving) return;

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

  }, [deck, isLeaving, round.status, router]);

  if (!deck) return null;

  const countSize = Math.max(92, Math.min(138, height * 0.34));

  const handleRetryCamera = async () => {
    setRecordingPreparation('preparing');
    setRecordingPreparation(await prepareRecording());
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
      await beginTransition({ destination: 'deck', direction: 'right', uri });
    } catch {
      // If capture is unavailable, navigation still completes normally.
    }
    resetRound();
    router.replace(`/deck/${deck.id}` as Href);
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
              {recordingPreparation === 'error' ? (
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
          </View>
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

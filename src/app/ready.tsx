import { type Href, useRouter } from 'expo-router';
import { useAudioPlayer } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { getDeckById } from '@/data/decks';
import { OrientationTransition } from '@/components/orientation-transition';
import { LandscapeViewport, useLandscapeDimensions } from '@/components/landscape-viewport';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { formatRoundClock } from '@/game/round-duration';
import { useRound } from '@/game/round-context';
import { useForeheadPosition } from '@/hooks/use-forehead-position';
import { colors, radius, spacing, typography } from '@/theme';
import { replaySound } from '@/utils/sound';

const GET_READY_SOUND_MS = 1050;
const READY_TRANSITION_MS = 450;

export default function ReadyScreen() {
  const { height } = useLandscapeDimensions();
  const router = useRouter();
  const { round, resetRound } = useRound();
  const deck = getDeckById(round.deckId ?? undefined);
  const [count, setCount] = useState(3);
  const [manualReady, setManualReady] = useState(false);
  const [orientationSettled, setOrientationSettled] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const launched = useRef(false);
  const introStarted = useRef(false);
  const screenRef = useRef<View>(null);
  const { beginTransition } = useScreenshotTransition();
  const getReadyPlayer = useAudioPlayer(require('../../assets/sounds/get-ready.wav'));
  const count3Player = useAudioPlayer(require('../../assets/sounds/count-3.wav'));
  const count2Player = useAudioPlayer(require('../../assets/sounds/count-2.wav'));
  const count1Player = useAudioPlayer(require('../../assets/sounds/count-1.wav'));
  const foreheadStatus = useForeheadPosition(round.status === 'ready');
  const positionReady = foreheadStatus === 'ready' || manualReady;

  useEffect(() => {
    const timeout = setTimeout(() => setOrientationSettled(true), READY_TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!positionReady || !orientationSettled || isLeaving || introStarted.current) return;
    introStarted.current = true;
    replaySound(getReadyPlayer);
    const timeout = setTimeout(() => setIntroComplete(true), GET_READY_SOUND_MS);
    return () => clearTimeout(timeout);
  }, [getReadyPlayer, isLeaving, orientationSettled, positionReady]);

  useEffect(() => {
    if (!introComplete || isLeaving) return;
    replaySound(count === 3 ? count3Player : count === 2 ? count2Player : count1Player);
  }, [count, count1Player, count2Player, count3Player, introComplete, isLeaving]);

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

    if (!positionReady || !orientationSettled || !introComplete || isLeaving) return;

    const timeout = setTimeout(() => {
      if (count === 1 && !launched.current) {
        launched.current = true;
        router.replace('/game' as Href);
        return;
      }

      setCount((value) => Math.max(1, value - 1));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [count, deck, introComplete, isLeaving, orientationSettled, positionReady, round.status, router]);

  if (!deck) return null;

  if (!orientationSettled) {
    return (
      <LandscapeViewport>
        <OrientationTransition style={styles.rotationShell} />
      </LandscapeViewport>
    );
  }

  const countSize = Math.max(92, Math.min(138, height * 0.34));

  const handleCancel = async () => {
    setIsLeaving(true);
    try {
      const uri = await captureRef(screenRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      await beginTransition({ destination: 'home', direction: 'right', uri });
    } catch {
      // If capture is unavailable, navigation still completes normally.
    }
    resetRound();
    router.replace('/');
  };

  return (
    <View ref={screenRef} collapsable={false} style={styles.captureRoot}>
      <LandscapeViewport>
        <SafeAreaView
          edges={['top', 'bottom']}
          style={[styles.safeArea, { backgroundColor: colors.play }]}
        >
          <StatusBar hidden animated={false} />
      <View style={styles.topRow}>
        <Text style={styles.duration}>{formatRoundClock(round.durationSeconds)}</Text>
        <Text style={[typography.deckName, styles.deckName]}>{deck.title}</Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.kicker}>HOLD THE PHONE TO YOUR FOREHEAD</Text>
        {positionReady ? (
          <>
            {introComplete ? (
              <Text style={[styles.count, { fontSize: countSize, lineHeight: countSize * 1.05 }]}>
                {count}
              </Text>
            ) : (
              <Text style={styles.getReady}>GET READY</Text>
            )}
            <Text style={styles.instructions}>Hold steady - your round is about to begin.</Text>
          </>
        ) : (
          <>
            <Text style={styles.phoneIcon}>▭</Text>
            <Text style={styles.positionTitle}>{getPositionMessage(foreheadStatus)}</Text>
            <Text style={styles.instructions}>
              Keep the phone sideways with the screen facing away from you.
            </Text>
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

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={isLeaving}
          onPress={handleCancel}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelText}>CANCEL</Text>
        </Pressable>
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
      return 'Place the phone on your forehead';
    case 'ready':
      return 'Ready';
    case 'denied':
      return 'Motion access is off';
    case 'unavailable':
      return 'Motion detection is unavailable';
  }
}

const styles = StyleSheet.create({
  captureRoot: { flex: 1, backgroundColor: colors.play },
  rotationShell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, padding: spacing.lg, overflow: 'hidden' },
  topRow: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  duration: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '900',
    backgroundColor: 'rgba(255,255,255,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  center: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  deckName: { color: colors.white },
  kicker: { color: colors.white, fontSize: 12, fontWeight: '900', letterSpacing: 1.8, textAlign: 'center' },
  count: { color: colors.white, fontWeight: '900', letterSpacing: -8 },
  getReady: { color: colors.white, fontSize: 42, lineHeight: 54, fontWeight: '900', letterSpacing: 2 },
  phoneIcon: {
    color: colors.white,
    fontSize: 120,
    lineHeight: 130,
    fontWeight: '300',
    transform: [{ rotate: '90deg' }],
  },
  positionTitle: { ...typography.title, color: colors.white, textAlign: 'center', marginBottom: spacing.sm },
  instructions: {
    ...typography.body,
    color: colors.white,
    textAlign: 'center',
    opacity: 0.72,
    maxWidth: 460,
  },
  manualButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  manualButtonText: { color: colors.ink, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  footer: { flexShrink: 0, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.sm },
  cancelButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  cancelText: { color: colors.ink, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
});

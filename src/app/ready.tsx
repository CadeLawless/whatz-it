import { useAudioPlayer } from 'expo-audio';
import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { CloseButton } from '@/components/close-button';
import { LandscapeViewport, useLandscapeDimensions } from '@/components/landscape-viewport';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { getDeckById } from '@/data/decks';
import { useRound } from '@/game/round-context';
import { useForeheadPosition } from '@/hooks/use-forehead-position';
import { colors, radius, spacing } from '@/theme';
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
  const { beginTransition, revealTransition } = useScreenshotTransition();
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
    if (orientationSettled) revealTransition('ready');
  }, [orientationSettled, revealTransition]);

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

    if (!positionReady || !orientationSettled || !introComplete) return;

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
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <StatusBar hidden animated={false} />
          <View style={styles.panel}>
            <View style={styles.closeButton}>
              <CloseButton
                accessibilityLabel="Cancel round"
                disabled={isLeaving}
                onPress={handleCancel}
              />
            </View>
            <Text style={styles.deckName}>{deck.title}</Text>

            <View style={styles.center}>
              {positionReady ? (
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
                  <Text style={styles.instructions}>Hold steady — your round is about to begin.</Text>
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
    paddingHorizontal: 18,
    paddingVertical: 14,
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
  count: { color: colors.white, fontWeight: '900', letterSpacing: -8 },
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
});

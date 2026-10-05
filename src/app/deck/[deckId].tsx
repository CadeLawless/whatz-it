import * as Linking from 'expo-linking';
import { SymbolView } from 'expo-symbols';
import {
  type Href,
  Redirect,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PermissionStatus } from 'react-native-vision-camera';

import { useCatalog } from '@/catalog/catalog-provider';
import { DeckDetailsHeader } from '@/components/deck-details-header';
import { DeckSetupHeader } from '@/components/deck-setup-header';
import { useSharePlay } from '@/shareplay/session-provider';
import { GameModeSelector } from '@/components/game-mode-selector';
import { PortraitTransition } from '@/components/orientation-transition';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { TimerPicker } from '@/components/timer-picker';
import { useRound } from '@/game/round-context';
import { parseGameMode } from '@/game/game-mode';
import type { GameMode } from '@/game/game-types';
import { requestModePermissions } from '@/game/round-setup';
import {
  clampRoundDuration,
  DEFAULT_ROUND_DURATION,
} from '@/game/round-duration';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { platformReleaseCapabilities } from '@/release/platform-release';
import {
  loadRoundDuration,
  loadRoundMode,
  saveRoundDuration,
  saveRoundMode,
} from '@/storage/preferences';
import {
  clearSettingsReturnDeckId,
  saveSettingsReturnDeckId,
} from '@/storage/settings-return';
import { colors, radius, spacing, typography } from '@/theme';
import {
  getRoundMotionPermissionStatus,
  requestRoundMotionAccess,
  type RoundMotionPermissionStatus,
} from '@/utils/round-motion-permission';
import { useRoundCameraPermissions } from '@/video/round-camera-permission';

type RoundSetupNotice = {
  messages: string[];
  showSettings: boolean;
  title: string;
};

const releaseCapabilities = platformReleaseCapabilities(Platform.OS);

export default function DeckDetailsScreen() {
  const { width } = useWindowDimensions();
  const isIPad = Platform.OS === 'ios' && Platform.isPad;
  const sharePlay = useSharePlay();
  const { catalog } = useCatalog();
  const { deckId, durationSeconds, returnToRoundId, mode: replayMode } = useLocalSearchParams<{
    deckId: string;
    durationSeconds?: string;
    returnToRoundId?: string;
    mode?: string;
  }>();
  const deck = catalog.getDeckById(deckId);
  const router = useRouter();
  const { configureRound } = useRound();

  const replayDuration = Number(durationSeconds);
  const initialDuration =
    durationSeconds && Number.isFinite(replayDuration)
      ? clampRoundDuration(replayDuration)
      : DEFAULT_ROUND_DURATION;
  const [duration, setDuration] = useState(initialDuration);
  const [modeSelection, setModeSelection] = useState<{
    source: string | undefined; value: GameMode; loaded: boolean;
  }>(() => ({ source: replayMode, value: parseGameMode(replayMode), loaded: replayMode !== undefined }));
  const mode = modeSelection.source === replayMode ? modeSelection.value : parseGameMode(replayMode);
  const modeLoaded = modeSelection.source === replayMode && modeSelection.loaded;
  const [isStarting, setIsStarting] = useState(false);
  const [frozenRoundSetupNotice, setFrozenRoundSetupNotice] =
    useState<RoundSetupNotice | null>(null);
  const [motionPermissionStatus, setMotionPermissionStatus] =
    useState<RoundMotionPermissionStatus | 'checking'>('checking');

  const settingsReturnPending = useRef(false);
  const settingsReturnWrite = useRef<Promise<void> | null>(null);
  const settingsWasBackgrounded = useRef(false);
  const starting = useRef(false);
  const {
    cameraStatus: cameraPermissionStatus,
    microphoneStatus: microphonePermissionStatus,
    requestPendingPermissions,
  } = useRoundCameraPermissions();
  const isPortrait = usePortraitScreen();
  const { revealTransition } = useScreenshotTransition();

  const armSettingsReturn = useCallback(
    (source: 'background' | 'explicit') => {
      settingsReturnPending.current = true;
      const permissions =
        source === 'background' && motionPermissionStatus !== 'checking'
          ? {
              camera: cameraPermissionStatus,
              microphone: microphonePermissionStatus,
              motion: motionPermissionStatus,
            }
          : undefined;
      const write = saveSettingsReturnDeckId(deckId, {
        source,
        permissions,
      }).catch(() => undefined);
      settingsReturnWrite.current = write;
      return write;
    },
    [
      cameraPermissionStatus,
      deckId,
      microphonePermissionStatus,
      motionPermissionStatus,
    ],
  );

  useEffect(() => {
    if (durationSeconds) return;
    loadRoundDuration().then(setDuration);
  }, [durationSeconds]);

  useEffect(() => {
    let active = true;
    const load = replayMode !== undefined
      ? Promise.resolve(parseGameMode(replayMode)) : loadRoundMode();
    void load.then((loaded) => {
      if (!active) return;
      setModeSelection({ source: replayMode, value: loaded, loaded: true });
    });
    return () => { active = false; };
  }, [replayMode]);

  useEffect(() => {
    let active = true;
    const refreshMotionPermission = () => {
      void getRoundMotionPermissionStatus().then((status) => {
        if (active) setMotionPermissionStatus(status);
      });
    };

    refreshMotionPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !settingsWasBackgrounded.current) {
        settingsWasBackgrounded.current = true;
        if (!settingsReturnPending.current) {
          void armSettingsReturn('background');
        }
      }
      if (state === 'active') {
        refreshMotionPermission();
        if (settingsReturnPending.current && settingsWasBackgrounded.current) {
          settingsReturnPending.current = false;
          settingsWasBackgrounded.current = false;
          const pendingWrite = settingsReturnWrite.current;
          settingsReturnWrite.current = null;
          void (pendingWrite ?? Promise.resolve())
            .then(clearSettingsReturnDeckId)
            .catch(() => undefined);
        }
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [armSettingsReturn]);

  useFocusEffect(
    useCallback(() => {
      starting.current = false;
      setIsStarting(false);
      setFrozenRoundSetupNotice(null);
      if (isPortrait) {
        void revealTransition('deck');
      }
    }, [isPortrait, revealTransition]),
  );

  if (!isPortrait) {
    return <PortraitTransition style={styles.orientationGate} />;
  }

  if (!deck) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.notFoundTitle}>Deck not found</Text>

        <Text style={styles.notFoundText}>
          This deck may have moved or is not available yet.
        </Text>
      </SafeAreaView>
    );
  }

  if (!releaseCapabilities.storefront && deck.access !== 'free') {
    return <Redirect href="/" />;
  }

  const handleStart = async () => {
    if (starting.current || !modeLoaded) {
      return;
    }

    setFrozenRoundSetupNotice(roundSetupNotice);
    setIsStarting(true);
    starting.current = true;
    const safeDuration = clampRoundDuration(duration);

    if (!(await configureRound(deck.id, safeDuration, mode))) {
      setIsStarting(false);
      starting.current = false;
      return;
    }

    await requestModePermissions(mode, async () => {
      setMotionPermissionStatus(await requestRoundMotionAccess());
    }, requestPendingPermissions);

    saveRoundDuration(safeDuration).catch(() => undefined);
    saveRoundMode(mode).catch(() => undefined);

    router.push('/ready' as Href);
  };

  const handleOpenSettings = async () => {
    try {
      await armSettingsReturn('explicit');
      settingsWasBackgrounded.current = false;
      await Linking.openSettings();
    } catch {
      settingsReturnPending.current = false;
      settingsReturnWrite.current = null;
      settingsWasBackgrounded.current = false;
      await clearSettingsReturnDeckId().catch(() => undefined);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (returnToRoundId) {
      router.replace({
        pathname: '/results',
        params: { roundId: returnToRoundId },
      });
      return;
    }
    router.replace('/');
  };

  const roundSetupNotice = mode === 'pass-n-play' ? null : getRoundSetupNotice({
    cameraStatus: cameraPermissionStatus,
    microphoneStatus: microphonePermissionStatus,
    motionStatus: motionPermissionStatus,
  });
  const displayedRoundSetupNotice = isStarting
    ? frozenRoundSetupNotice
    : roundSetupNotice;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView
        style={styles.screen}
        edges={['top', 'bottom']}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          style={styles.screen}
        >
          {Platform.OS === 'ios' && <DeckSetupHeader
            backLabel={returnToRoundId ? 'Back to Results' : 'Back to Decks'}
            onBack={handleBack}
            onSharePlay={sharePlay.enabled ? () => sharePlay.open({
              deckId: deck.id, deckTitle: deck.title, durationSeconds: duration, access: deck.access,
            }) : undefined}
          />}
          <View style={styles.mainContent}>
            <DeckDetailsHeader
              showBackButton={Platform.OS !== 'ios'}
              backLabel={returnToRoundId ? 'Back to Results' : 'Back to Decks'}
              containerWidth={Math.min(width - spacing.lg * 2, 640)}
              deck={deck}
              onBack={handleBack}
            />

            <Text style={styles.sectionLabel}>ROUND LENGTH</Text>

            <TimerPicker
              value={duration}
              onChange={(value) =>
                setDuration(clampRoundDuration(value))
              }
            />

            <View style={styles.startArea}>
              {displayedRoundSetupNotice && (
                <View style={styles.roundSetupCard}>
                  <View style={styles.roundSetupHeader}>
                    <Text style={styles.roundSetupTitle}>
                      {displayedRoundSetupNotice.title}
                    </Text>
                  </View>

                  <View style={styles.roundSetupMessages}>
                    {displayedRoundSetupNotice.messages.map((message) => (
                      <View key={message} style={styles.roundSetupMessageRow}>
                        <View style={styles.roundSetupDot} />
                        <Text style={styles.roundSetupMessage}>{message}</Text>
                      </View>
                    ))}
                  </View>
                  {displayedRoundSetupNotice.showSettings && (
                    <Pressable
                      accessibilityHint="Opens the system settings for WHATZ IT?"
                      accessibilityRole="link"
                      onPress={() => void handleOpenSettings()}
                      style={({ pressed }) => [
                        styles.settingsLink,
                        pressed && styles.settingsLinkPressed,
                      ]}
                    >
                      <Text style={styles.settingsLinkText}>CHANGE SETTINGS</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          </View>
        </ScrollView>

        <View style={[styles.startFooter, isIPad && styles.tabletFooter]}>
          <View style={styles.footerContent}>
            <Pressable
              accessibilityRole="button"
              disabled={isStarting || !modeLoaded}
              accessibilityState={{ disabled: isStarting || !modeLoaded, busy: isStarting }}
              onPress={handleStart}
              style={({ pressed }) => [
                styles.startButton,
                pressed && styles.startButtonPressed,
              ]}
            >
              <Text style={styles.startButtonText}>
                LET&apos;S PLAY
              </Text>

              <SymbolView
                accessibilityElementsHidden
                name={{
                  android: 'arrow_forward',
                  ios: 'arrow.right',
                  web: 'arrow_forward',
                }}
                size={29}
                style={styles.startArrow}
                tintColor={colors.white}
              />
            </Pressable>
            <View style={styles.modeSelection}>
              <GameModeSelector value={mode} disabled={isStarting || !modeLoaded}
                onChange={(selectedMode) => {
                  setModeSelection({ source: replayMode, value: selectedMode, loaded: true });
                  void saveRoundMode(selectedMode).catch(() => undefined);
                }} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}

function getRoundSetupNotice({
  cameraStatus,
  microphoneStatus,
  motionStatus,
}: {
  cameraStatus: PermissionStatus;
  microphoneStatus: PermissionStatus;
  motionStatus: RoundMotionPermissionStatus | 'checking';
}): RoundSetupNotice | null {
  const motionOff = motionStatus === 'denied' || motionStatus === 'unavailable';
  const cameraOff = cameraStatus === 'denied' || cameraStatus === 'restricted';
  const microphoneOff =
    microphoneStatus === 'denied' || microphoneStatus === 'restricted';
  const hasUndeterminedPermission =
    motionStatus === 'not-determined' ||
    cameraStatus === 'not-determined' ||
    microphoneStatus === 'not-determined';

  const messages: string[] = [];
  if (motionOff) {
    messages.push(
      motionStatus === 'denied'
        ? 'Pass and Correct buttons will appear during the round.'
        : 'Motion controls are unavailable. Pass and Correct buttons will appear during the round.',
    );
  }
  if (cameraOff) {
    messages.push('Camera access is off. This round will not be recorded.');
  } else if (microphoneOff) {
    messages.push('Microphone access is off. Videos will be recorded without sound.');
  }

  if (messages.length === 0) {
    if (!hasUndeterminedPermission) return null;
    return {
      messages: [
        'Motion controls and video recordings are optional. You can still play if you decline.',
      ],
      showSettings: false,
      title: 'OPTIONAL FEATURES',
    };
  }

  const title =
    messages.length > 1
      ? 'ROUND SETUP'
      : motionOff
        ? 'MOTION ACCESS OFF'
        : cameraOff
          ? 'VIDEO RECORDING OFF'
          : 'VIDEO SOUND OFF';

  return {
    messages,
    showSettings:
      motionStatus === 'denied' ||
      cameraStatus === 'denied' ||
      microphoneStatus === 'denied',
    title,
  };
}

const styles = StyleSheet.create({
  orientationGate: {
    flex: 1,
  },

  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },

  content: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  mainContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },

  notFoundTitle: {
    ...typography.title,
    color: colors.ink,
  },

  notFoundText: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  sectionLabel: {
    color: colors.play,
    fontSize: 18,
    fontFamily: 'Inter_900Black',
    letterSpacing: 0.2,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },

  modeSelection: { marginTop: spacing.md },

  startArea: {
    marginTop: 'auto',
    marginBottom: 0,
    gap: spacing.md,
  },

  startFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 0,
    backgroundColor: colors.surface,
  },
  tabletFooter: {
    paddingBottom: spacing.xl,
  },
  footerContent: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },

  roundSetupCard: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    marginTop: spacing.md,
  },

  roundSetupHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },

  roundSetupTitle: {
    flex: 1,
    color: colors.play,
    fontSize: 14,
    lineHeight: 15,
    fontFamily: 'Inter_900Black',
    letterSpacing: 0.8,
  },

  roundSetupMessages: {
    gap: 6,
  },

  roundSetupMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },

  roundSetupDot: {
    width: 6,
    height: 6,
    marginTop: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.play,
  },

  roundSetupMessage: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 16,
    fontFamily: 'Inter_700Bold',
  },

  settingsLink: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.play,
  },

  settingsLinkPressed: {
    opacity: 0.65,
  },

  settingsLinkText: {
    color: colors.white,
    fontSize: 12,
    lineHeight: 15,
    fontFamily: 'Inter_900Black',
    letterSpacing: 0.7,
    textAlign: 'center',
  },

  startButton: {
    minHeight: 76,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.pass,
    shadowColor: '#64748B',
    shadowOffset: {
      width: 0,
      height: 7,
    },
    shadowOpacity: 0.18,
    shadowRadius: 13,
    elevation: 6,
  },

  startButtonPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.9,
  },

  startButtonText: {
    color: colors.white,
    fontSize: 27,
    lineHeight: 30,
    fontFamily: 'Inter_900Black',
  },

  startArrow: {
    width: 29,
    height: 29,
  },
});

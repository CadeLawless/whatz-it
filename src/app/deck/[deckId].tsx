import * as Linking from 'expo-linking';
import {
  type Href,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import type { PermissionStatus } from 'react-native-vision-camera';

import { PortraitTransition } from '@/components/orientation-transition';
import { DeckDetailsHeader } from '@/components/deck-details-header';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { TimerPicker } from '@/components/timer-picker';
import { useCatalog } from '@/catalog/catalog-provider';
import { useRound } from '@/game/round-context';
import {
  clampRoundDuration,
  DEFAULT_ROUND_DURATION,
} from '@/game/round-duration';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import {
  loadRoundDuration,
  saveRoundDuration,
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

export default function DeckDetailsScreen() {
  const { catalog } = useCatalog();
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const deck = catalog.getDeckById(deckId);
  const router = useRouter();
  const { configureRound } = useRound();

  const [duration, setDuration] = useState(DEFAULT_ROUND_DURATION);
  const [isStarting, setIsStarting] = useState(false);
  const [frozenRoundSetupNotice, setFrozenRoundSetupNotice] =
    useState<RoundSetupNotice | null>(null);
  const [motionPermissionStatus, setMotionPermissionStatus] =
    useState<RoundMotionPermissionStatus | 'checking'>('checking');

  const screenRef = useRef<View>(null);
  const settingsReturnPending = useRef(false);
  const settingsReturnWrite = useRef<Promise<void> | null>(null);
  const settingsWasBackgrounded = useRef(false);
  const {
    cameraStatus: cameraPermissionStatus,
    microphoneStatus: microphonePermissionStatus,
    requestPendingPermissions,
  } = useRoundCameraPermissions();
  const isPortrait = usePortraitScreen();
  const { beginTransition, revealTransition } = useScreenshotTransition();

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
    loadRoundDuration().then(setDuration);
  }, []);

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

  const handleStart = async () => {
    if (isStarting) {
      return;
    }

    setFrozenRoundSetupNotice(roundSetupNotice);
    setIsStarting(true);
    const safeDuration = clampRoundDuration(duration);

    if (!(await configureRound(deck.id, safeDuration))) {
      setIsStarting(false);
      return;
    }

    const motionAccess = await requestRoundMotionAccess();
    setMotionPermissionStatus(motionAccess);
    await requestPendingPermissions().catch(() => undefined);

    saveRoundDuration(safeDuration).catch(() => undefined);

    try {
      const uri = await captureRef(screenRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });

      await beginTransition({
        destination: 'ready',
        direction: 'left',
        uri,
      });
    } catch {
      // If capture is unavailable, Ready still opens without a transition.
    }

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
    router.replace('/');
  };

  const roundSetupNotice = getRoundSetupNotice({
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
        ref={screenRef}
        collapsable={false}
        style={styles.screen}
        edges={['top', 'bottom']}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          style={styles.screen}
        >
          <DeckDetailsHeader
            backLabel="Back to Decks"
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

            <Pressable
              accessibilityRole="button"
              disabled={isStarting}
              onPress={handleStart}
              style={({ pressed }) => [
                styles.startButton,
                pressed && styles.startButtonPressed,
              ]}
            >
              <Text style={styles.startButtonText}>
                LET&apos;S PLAY
              </Text>

              <Text style={styles.startArrow}>→</Text>
            </Pressable>
          </View>
        </ScrollView>
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
    fontWeight: '900',
    letterSpacing: 0.2,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },

  startArea: {
    marginTop: 'auto',
    marginBottom: 0,
    gap: spacing.md,
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
    lineHeight: 16,
    fontWeight: '900',
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
    lineHeight: 18,
    fontWeight: '500',
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
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 0.7,
    textAlign: 'center',
  },

  startButton: {
    minHeight: 76,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontWeight: '900',
  },

  startArrow: {
    color: colors.white,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '300',
  },
});

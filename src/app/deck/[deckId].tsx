import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { type Href, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { PortraitTransition } from '@/components/orientation-transition';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { TimerPicker } from '@/components/timer-picker';
import { getDeckById } from '@/data/decks';
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
import { colors, radius, spacing, typography } from '@/theme';
import { useRoundCameraPermissions } from '@/video/round-camera-permission';

export default function DeckDetailsScreen() {
  const { width } = useWindowDimensions();
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const deck = getDeckById(deckId);
  const router = useRouter();
  const { configureRound } = useRound();

  const [duration, setDuration] = useState(DEFAULT_ROUND_DURATION);
  const [isStarting, setIsStarting] = useState(false);

  const screenRef = useRef<View>(null);
  const { cameraStatus: cameraPermissionStatus, requestPendingPermissions } =
    useRoundCameraPermissions();
  const isPortrait = usePortraitScreen();
  const { beginTransition, revealTransition } = useScreenshotTransition();

  const posterWidth = Math.min(156, Math.max(126, width * 0.36));
  const titleAvailableWidth = Math.max(
    1,
    (width - spacing.lg * 2 - spacing.xl * 2) * 0.59,
  );

  useEffect(() => {
    loadRoundDuration().then(setDuration);
  }, []);

  useEffect(() => {
    if (isPortrait) {
      revealTransition('deck');
    }
  }, [isPortrait, revealTransition]);

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

    setIsStarting(true);
    const safeDuration = clampRoundDuration(duration);

    if (!(await configureRound(deck.id, safeDuration))) {
      setIsStarting(false);
      return;
    }

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
          <Pressable
            accessibilityLabel="Back to Decks"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backText}>Back to Decks</Text>
          </Pressable>

          <View style={styles.heroShadow}>
            <View style={styles.heroCard}>
              <View style={styles.heroCopy}>
                <AutoFitDeckTitle
                  availableWidth={titleAvailableWidth}
                  key={`${deck.id}-${width}`}
                  title={deck.title}
                />

                <Text style={styles.deckDescription}>
                  {deck.description}
                </Text>
              </View>

              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.posterPositioner,
                  {
                    right: -posterWidth * 0.22,
                  },
                ]}
              >
                <View
                  style={[
                    styles.poster,
                    {
                      width: posterWidth,
                    },
                  ]}
                >
                  {deck.coverImage ? (
                    <Image
                      contentFit="cover"
                      source={deck.coverImage}
                      style={styles.posterImage}
                    />
                  ) : (
                    <View style={styles.posterFallback}>
                      <Text style={styles.posterFallbackText}>
                        {deck.title}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>

          <Text style={styles.sectionLabel}>ROUND LENGTH</Text>

          <TimerPicker
            value={duration}
            onChange={(value) =>
              setDuration(clampRoundDuration(value))
            }
          />

          <View style={styles.startArea}>
            {cameraPermissionStatus !== 'authorized' && (
              <View style={styles.cameraDisclosure}>
                <Text style={styles.cameraDisclosureText}>
                  {cameraPermissionStatus === 'not-determined'
                    ? 'Round videos are optional. WHATZ IT? will ask to use the camera and microphone. You can decline and play without video.'
                    : cameraPermissionStatus === 'denied'
                      ? 'Camera access is off, so WHATZ IT? will play without video. To record future rounds, enable Camera and Microphone in Settings.'
                      : 'Camera access is unavailable, so WHATZ IT? will play without video.'}
                </Text>

                {cameraPermissionStatus === 'denied' && (
                  <Pressable
                    accessibilityHint="Opens the system settings for WHATZ IT?"
                    accessibilityRole="link"
                    onPress={() => void Linking.openSettings().catch(() => undefined)}
                    style={({ pressed }) => [
                      styles.settingsLink,
                      pressed && styles.settingsLinkPressed,
                    ]}
                  >
                    <Text style={styles.settingsLinkText}>OPEN SETTINGS</Text>
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

const MAXIMUM_TITLE_FONT_SIZE = 32;
const TITLE_LINE_HEIGHT_RATIO = 1.125;
const TITLE_FIT_SAFETY = 0.94;

function AutoFitDeckTitle({
  availableWidth,
  title,
}: {
  availableWidth: number;
  title: string;
}) {
  const candidates = getTitleLineCandidates(title);
  const measurementLines = [...new Set(candidates.flat())];
  const [lineWidths, setLineWidths] = useState<Record<string, number>>({});
  const hasMeasurements = measurementLines.every((line) => lineWidths[line] !== undefined);

  let fittedFontSize = MAXIMUM_TITLE_FONT_SIZE;
  let fittedLines = candidates[0];

  if (hasMeasurements) {
    let largestFontSize = 0;

    for (const candidate of candidates) {
      const widestLine = Math.max(...candidate.map((line) => lineWidths[line]));
      const candidateFontSize = Math.min(
        MAXIMUM_TITLE_FONT_SIZE,
        (MAXIMUM_TITLE_FONT_SIZE * availableWidth * TITLE_FIT_SAFETY) / widestLine,
      );

      if (candidateFontSize > largestFontSize + 0.05) {
        largestFontSize = candidateFontSize;
        fittedLines = candidate;
      }
    }

    fittedFontSize = Math.max(1, Math.floor(largestFontSize * 10) / 10);
  }

  return (
    <View
      accessibilityLabel={title}
      accessible
      style={styles.deckTitle}
    >
      {hasMeasurements ? (
        fittedLines.map((line) => (
          <Text
            accessible={false}
            key={line}
            style={[
              styles.deckTitleLine,
              {
                fontSize: fittedFontSize,
                lineHeight: fittedFontSize * TITLE_LINE_HEIGHT_RATIO,
              },
            ]}
          >
            {line}
          </Text>
        ))
      ) : (
        <View style={styles.deckTitlePlaceholder} />
      )}

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.deckTitleMeasurements}
      >
        {measurementLines.map((line) => (
          <Text
            key={line}
            numberOfLines={1}
            onTextLayout={(event) => {
              const measuredWidth = event.nativeEvent.lines[0]?.width;
              if (!measuredWidth) return;

              setLineWidths((currentWidths) => {
                if (Math.abs((currentWidths[line] ?? 0) - measuredWidth) < 0.1) {
                  return currentWidths;
                }

                return { ...currentWidths, [line]: measuredWidth };
              });
            }}
            style={styles.deckTitleMeasurementText}
          >
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function getTitleLineCandidates(title: string) {
  const words = title.trim().split(/\s+/u);
  const candidates = [[words.join(' ')]];

  for (let splitIndex = 1; splitIndex < words.length; splitIndex += 1) {
    candidates.push([
      words.slice(0, splitIndex).join(' '),
      words.slice(splitIndex).join(' '),
    ]);
  }

  return candidates;
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

  backButton: {
    alignSelf: 'flex-start',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#64748B',
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 5,
  },

  backButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },

  backChevron: {
    color: '#000000',
    fontSize: 35,
    lineHeight: 38,
    fontWeight: '300',
  },

  backText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '500',
    marginLeft: 2,
  },

  heroShadow: {
    borderRadius: radius.xl,
    marginTop: spacing.xl,
    backgroundColor: colors.play,
    shadowColor: '#64748B',
    shadowOffset: {
      width: 0,
      height: 7,
    },
    shadowOpacity: 0.18,
    shadowRadius: 13,
    elevation: 6,
  },

  heroCard: {
    position: 'relative',
    minHeight: 236,
    borderRadius: radius.xl,
    padding: spacing.xl,
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.play,
  },

  heroCopy: {
    width: '59%',
    alignItems: 'flex-start',
    zIndex: 1,
  },

  deckTitle: {
    width: '100%',
    position: 'relative',
    alignItems: 'flex-start',
  },

  deckTitleLine: {
    width: '100%',
    color: colors.white,
    fontWeight: '900',
    textAlign: 'left',
    textTransform: 'uppercase',
  },

  deckTitlePlaceholder: {
    height: MAXIMUM_TITLE_FONT_SIZE * TITLE_LINE_HEIGHT_RATIO * 2,
  },

  deckTitleMeasurements: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 10000,
    opacity: 0,
  },

  deckTitleMeasurementText: {
    width: 10000,
    color: colors.white,
    fontSize: MAXIMUM_TITLE_FONT_SIZE,
    lineHeight: MAXIMUM_TITLE_FONT_SIZE * TITLE_LINE_HEIGHT_RATIO,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  deckDescription: {
    color: colors.white,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '400',
    textAlign: 'left',
    marginTop: spacing.md,
  },

  posterPositioner: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },

  poster: {
    aspectRatio: 2 / 3,
    borderRadius: 7,
    backgroundColor: colors.surface,
    transform: [{ rotate: '-10deg' }],
    shadowColor: '#000000',
    shadowOffset: {
      width: -10,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 9,
    elevation: 9,
  },

  posterImage: {
    width: '100%',
    height: '100%',
    borderRadius: 7,
  },

  posterFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.playSoft,
  },

  posterFallbackText: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
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

  cameraDisclosure: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  cameraDisclosureText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    textAlign: 'center',
  },

  settingsLink: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },

  settingsLinkPressed: {
    opacity: 0.65,
  },

  settingsLinkText: {
    color: colors.play,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 0.7,
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

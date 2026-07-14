import { Image } from 'expo-image';
import { type Href, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
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

export default function DeckDetailsScreen() {
  const { width } = useWindowDimensions();
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const deck = getDeckById(deckId);
  const router = useRouter();
  const { configureRound } = useRound();

  const [duration, setDuration] = useState(DEFAULT_ROUND_DURATION);
  const [isStarting, setIsStarting] = useState(false);

  const screenRef = useRef<View>(null);
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

    const safeDuration = clampRoundDuration(duration);

    if (!configureRound(deck.id, safeDuration)) {
      return;
    }

    setIsStarting(true);
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
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const MINIMUM_TITLE_FONT_SIZE = 12;

function AutoFitDeckTitle({
  availableWidth,
  title,
}: {
  availableWidth: number;
  title: string;
}) {
  const [fontSize, setFontSize] = useState(32);

  return (
    <View
      accessibilityLabel={title}
      accessible
      onLayout={(event) => fitTitleToTwoLines(event, fontSize, setFontSize)}
      style={[
        styles.deckTitle,
        {
          columnGap: fontSize * 0.25,
          minHeight: fontSize * 1.125,
        },
      ]}
    >
      {title.split(/\s+/u).map((word, index) => (
        <Text
          accessible={false}
          key={`${word}-${index}`}
          numberOfLines={1}
          onLayout={(event) =>
            fitTitleWord(event, availableWidth, fontSize, setFontSize)
          }
          style={[
            styles.deckTitleWord,
            {
              fontSize,
              lineHeight: fontSize * 1.125,
            },
          ]}
        >
          {word}
        </Text>
      ))}
    </View>
  );
}

function fitTitleToTwoLines(
  event: LayoutChangeEvent,
  fontSize: number,
  setFontSize: Dispatch<SetStateAction<number>>,
) {
  const lineHeight = fontSize * 1.125;
  if (event.nativeEvent.layout.height <= lineHeight * 2 + 1) return;

  const nextSize = Math.max(MINIMUM_TITLE_FONT_SIZE, fontSize - 1);
  setFontSize((currentSize) => Math.min(currentSize, nextSize));
}

function fitTitleWord(
  event: LayoutChangeEvent,
  availableWidth: number,
  fontSize: number,
  setFontSize: Dispatch<SetStateAction<number>>,
) {
  const wordWidth = event.nativeEvent.layout.width;
  if (wordWidth <= availableWidth + 0.5) return;

  const fittedSize = Math.floor((fontSize * availableWidth * 0.98 * 10) / wordWidth) / 10;
  const nextSize = Math.max(MINIMUM_TITLE_FONT_SIZE, fittedSize);
  setFontSize((currentSize) => Math.min(currentSize, nextSize));
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },

  deckTitleWord: {
    flexShrink: 0,
    color: colors.white,
    fontWeight: '900',
    textAlign: 'left',
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

  startButton: {
    marginTop: 'auto',
    marginBottom: 0,
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

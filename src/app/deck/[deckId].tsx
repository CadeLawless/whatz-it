import { type Href, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { PortraitTransition } from '@/components/orientation-transition';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { TimerPicker } from '@/components/timer-picker';
import { getDeckById } from '@/data/decks';
import { clampRoundDuration, DEFAULT_ROUND_DURATION } from '@/game/round-duration';
import { useRound } from '@/game/round-context';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { loadRoundDuration, saveRoundDuration } from '@/storage/preferences';
import { colors, radius, spacing, typography } from '@/theme';

export default function DeckDetailsScreen() {
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const deck = getDeckById(deckId);
  const router = useRouter();
  const { configureRound } = useRound();
  const [duration, setDuration] = useState(DEFAULT_ROUND_DURATION);
  const [isStarting, setIsStarting] = useState(false);
  const screenRef = useRef<View>(null);
  const isPortrait = usePortraitScreen();
  const { beginTransition } = useScreenshotTransition();

  useEffect(() => {
    loadRoundDuration().then(setDuration);
  }, []);

  if (!isPortrait) return <PortraitTransition style={styles.orientationGate} />;

  if (!deck) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.notFoundTitle}>Deck not found</Text>
        <Text style={styles.notFoundText}>This deck may have moved or is not available yet.</Text>
      </SafeAreaView>
    );
  }

  const handleStart = async () => {
    if (isStarting) return;
    const safeDuration = clampRoundDuration(duration);
    if (!configureRound(deck.id, safeDuration)) return;
    setIsStarting(true);
    saveRoundDuration(safeDuration).catch(() => undefined);
    try {
      const uri = await captureRef(screenRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      await beginTransition({ destination: 'ready', direction: 'left', uri });
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
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backText}>Back to Decks</Text>
          </Pressable>

          <View style={styles.heroCard}>
            <Text style={styles.deckTitle}>{deck.title}</Text>
            <Text style={styles.deckDescription}>{deck.description}</Text>
          </View>

          <Text style={styles.sectionLabel}>ROUND LENGTH</Text>
          <TimerPicker
            value={duration}
            onChange={(value) => setDuration(clampRoundDuration(value))}
          />

          <Pressable
            accessibilityRole="button"
            disabled={isStarting}
            onPress={handleStart}
            style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
          >
            <Text style={styles.startButtonText}>LET&apos;S PLAY</Text>
            <Text style={styles.startArrow}>→</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  orientationGate: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  notFoundTitle: { ...typography.title, color: colors.ink },
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
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 5,
  },
  backButtonPressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  backChevron: { color: '#000000', fontSize: 35, lineHeight: 38, fontWeight: '300' },
  backText: { color: '#000000', fontSize: 17, fontWeight: '500', marginLeft: 2 },
  heroCard: {
    minHeight: 166,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginTop: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.play,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.18,
    shadowRadius: 13,
    elevation: 6,
  },
  deckTitle: {
    color: colors.white,
    fontSize: 35,
    lineHeight: 40,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  deckDescription: {
    color: colors.white,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: 420,
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
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.18,
    shadowRadius: 13,
    elevation: 6,
  },
  startButtonPressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  startButtonText: { color: colors.white, fontSize: 27, fontWeight: '900' },
  startArrow: { color: colors.white, fontSize: 44, lineHeight: 48, fontWeight: '300' },
});

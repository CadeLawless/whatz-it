import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeckCard } from '@/components/deck-card';
import { OrientationTransition } from '@/components/orientation-transition';
import { decks } from '@/data/decks';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { colors, radius, spacing, typography } from '@/theme';

export default function DeckLibraryScreen() {
  const { width } = useWindowDimensions();
  const isPortrait = usePortraitScreen();
  const gridWidth = Math.min(width, 720);
  const deckWidth = Math.floor((gridWidth - spacing.lg * 2 - spacing.sm * 2) / 3);
  const deckHeight = Math.round(deckWidth / 0.72);

  if (!isPortrait) return <OrientationTransition style={styles.orientationGate} />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { width: gridWidth }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.logoBadge}>
              <Text style={styles.logo}>🪿</Text>
            </View>
            <Text style={styles.eyebrow}>GOOSE WHAT</Text>
          </View>
          <Text style={styles.title}>Pick a deck.{`\n`}Start guessing.</Text>
          <Text style={styles.subtitle}>
            Grab some friends, choose a category, and hold the phone to your forehead.
          </Text>
        </View>

        <View style={styles.deckGrid}>
          {decks.map((deck) => (
            <View key={deck.id} style={{ width: deckWidth, height: deckHeight }}>
              <DeckCard deck={deck} />
            </View>
          ))}
        </View>

        <View style={styles.tip}>
          <Text style={styles.tipIcon}>💡</Text>
          <View style={styles.tipCopy}>
            <Text style={styles.tipTitle}>How it works</Text>
            <Text style={styles.tipText}>Tilt down for correct. Tilt up to pass.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  orientationGate: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  header: { marginBottom: spacing.xl },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  logoBadge: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
  },
  logo: { fontSize: 25 },
  eyebrow: { color: colors.ink, fontSize: 15, fontWeight: '900', letterSpacing: 2.2 },
  title: { ...typography.hero, color: colors.ink },
  subtitle: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.md,
    maxWidth: 440,
  },
  deckGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipIcon: { fontSize: 28 },
  tipCopy: { flex: 1 },
  tipTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  tipText: { color: colors.muted, fontSize: 14, marginTop: 2 },
});

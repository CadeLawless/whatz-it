import { Image } from 'expo-image';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeckCard } from '@/components/deck-card';
import { PortraitTransition } from '@/components/orientation-transition';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { decks } from '@/data/decks';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';

const HOME_DECK_IDS = [
  'snack-attack',
  'animal-antics',
  '90s-kids',
  'star-studded',
  'internet-famous',
  'game-on',
  'fictional-who-am-i',
  'name-that-tune',
  'movie-mania',
  'binge-worthy',
] as const;

const deckById = new Map(decks.map((deck) => [deck.id, deck]));
const homeDecks = HOME_DECK_IDS.flatMap((deckId) => {
  const deck = deckById.get(deckId);
  return deck ? [deck] : [];
});

export default function DeckLibraryScreen() {
  const { width } = useWindowDimensions();
  const isPortrait = usePortraitScreen();
  const { revealTransition } = useScreenshotTransition();
  const pageWidth = Math.min(width, 720);
  const horizontalPadding = width < 380 ? 22 : Math.min(48, Math.round(width * 0.074));
  const columnGap = width < 380 ? 16 : Math.min(32, Math.round(width * 0.06));
  const deckWidth = Math.floor((pageWidth - horizontalPadding * 2 - columnGap * 2) / 3);
  const brandWidth = Math.min(width * 0.74, 420);
  const headshotWidth = Math.round(brandWidth * 0.16);
  const wordmarkWidth = Math.round(brandWidth * 0.75);

  useEffect(() => {
    if (isPortrait) revealTransition('home');
  }, [isPortrait, revealTransition]);

  if (!isPortrait) return <PortraitTransition style={styles.orientationGate} />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
        <View style={styles.brandCard}>
          <View
            accessible
            accessibilityLabel="Whatz It?"
            style={[styles.brand, { width: brandWidth }]}
          >
            <Image
              accessible={false}
              contentFit="contain"
              source={require('../../assets/images/branding/albert-headshot.png')}
              style={{ width: headshotWidth, height: headshotWidth * 1.5 }}
            />
            <Image
              accessible={false}
              contentFit="contain"
              source={require('../../assets/images/branding/whatz-it-wordmark.png')}
              style={{ width: wordmarkWidth, height: wordmarkWidth / 3 }}
            />
          </View>
        </View>

        <View style={[styles.library, { width: pageWidth, paddingHorizontal: horizontalPadding }]}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>MY DECKS</Text>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.chevron} />
          </View>

          <View style={[styles.deckGrid, { columnGap, rowGap: columnGap }]}>
            {homeDecks.map((deck) => (
              <View key={deck.id} style={{ width: deckWidth, aspectRatio: 2 / 3 }}>
                <DeckCard deck={deck} />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  orientationGate: { flex: 1, backgroundColor: '#F6F6F6' },
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollView: { flex: 1, backgroundColor: '#F6F6F6' },
  scrollContent: { paddingBottom: 72 },
  brandCard: {
    minHeight: 118,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 24,
    paddingLeft: 24,
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.18,
    shadowRadius: 15,
    elevation: 8,
    zIndex: 1,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  library: {
    alignSelf: 'center',
    paddingTop: 34,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
    paddingLeft: 3,
  },
  sectionTitle: {
    color: '#459efe',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    letterSpacing: 0.1,
  },
  chevron: {
    width: 13,
    height: 13,
    marginLeft: 16,
    marginTop: -5,
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: '#111111',
    transform: [{ rotate: '45deg' }],
  },
  deckGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});

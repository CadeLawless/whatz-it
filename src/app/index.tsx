import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeckCard } from '@/components/deck-card';
import { PortraitTransition } from '@/components/orientation-transition';
import { RoundVideoPlayer } from '@/components/round-video-player';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { decks, getDeckById } from '@/data/decks';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { colors } from '@/theme';
import {
  deleteRoundVideo,
  loadRoundVideos,
  type RoundVideo,
} from '@/video/round-videos';

export default function DeckLibraryScreen() {
  const { width } = useWindowDimensions();
  const isPortrait = usePortraitScreen();
  const { revealTransition } = useScreenshotTransition();
  const [decksExpanded, setDecksExpanded] = useState(true);
  const [videosExpanded, setVideosExpanded] = useState(true);
  const [videos, setVideos] = useState<RoundVideo[]>([]);
  const pageWidth = Math.min(width, 720);
  const horizontalPadding = width < 380 ? 22 : Math.min(48, Math.round(width * 0.074));
  const columnGap = width < 380 ? 16 : Math.min(32, Math.round(width * 0.06));
  const deckWidth = Math.floor((pageWidth - horizontalPadding * 2 - columnGap * 2) / 3);
  const videoWidth = Math.floor((pageWidth - horizontalPadding * 2 - columnGap) / 2);
  const brandWidth = Math.min(width * 0.74, 420);
  const headshotWidth = Math.round(brandWidth * 0.16);
  const wordmarkWidth = Math.round(brandWidth * 0.75);

  useEffect(() => {
    if (isPortrait) revealTransition('home');
  }, [isPortrait, revealTransition]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadRoundVideos().then((storedVideos) => {
        if (active) setVideos(storedVideos);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const handleDelete = (video: RoundVideo) => {
    Alert.alert('Delete round video?', 'This removes the video from WHATZ IT on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const next = await deleteRoundVideo(video.id);
          setVideos(next);
        },
      },
    ]);
  };

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
          <SectionHeading
            expanded={decksExpanded}
            label="MY DECKS"
            onPress={() => setDecksExpanded((expanded) => !expanded)}
          />

          {decksExpanded && (
            <View style={[styles.deckGrid, { columnGap, rowGap: columnGap }]}>
              {decks.map((deck) => (
                <View key={deck.id} style={{ width: deckWidth, aspectRatio: 2 / 3 }}>
                  <DeckCard deck={deck} />
                </View>
              ))}
            </View>
          )}

          <View style={styles.videoSection}>
            <SectionHeading
              expanded={videosExpanded}
              label="VIDEOS"
              onPress={() => setVideosExpanded((expanded) => !expanded)}
            />

            {videosExpanded && videos.length === 0 && (
              <Text style={styles.emptyVideos}>Your last 10 round videos will appear here.</Text>
            )}

            {videosExpanded && videos.length > 0 && (
              <View style={[styles.videoGrid, { columnGap, rowGap: columnGap }]}>
                {videos.map((video) => {
                  const deck = getDeckById(video.deckId);
                  return (
                    <View key={video.id} style={[styles.videoCard, { width: videoWidth }]}>
                      <RoundVideoPlayer video={video} style={styles.video} />
                      <Text numberOfLines={1} style={styles.videoDeckName}>
                        {deck?.title ?? 'Round video'}
                      </Text>
                      <Text style={styles.videoDate}>
                        {new Date(video.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </Text>
                      <View style={styles.videoActions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ disabled: true }}
                          disabled
                          style={styles.saveButton}
                        >
                          <Text style={styles.saveButtonText}>EXPORT SOON</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => handleDelete(video)}
                          style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
                        >
                          <Text style={styles.deleteButtonText}>DELETE</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeading({
  expanded,
  label,
  onPress,
}: {
  expanded: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [styles.sectionHeading, pressed && styles.headingPressed]}
    >
      <Text style={styles.sectionTitle}>{label}</Text>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.chevron, !expanded && styles.chevronCollapsed]}
      />
    </Pressable>
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
  brand: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  library: { alignSelf: 'center', paddingTop: 34 },
  sectionHeading: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
    paddingLeft: 3,
  },
  headingPressed: { opacity: 0.65 },
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
  chevronCollapsed: { marginTop: 5, transform: [{ rotate: '-135deg' }] },
  deckGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  videoSection: { marginTop: 42 },
  emptyVideos: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 12,
  },
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  videoCard: {
    overflow: 'hidden',
    borderRadius: 18,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 3,
  },
  video: { width: '100%', aspectRatio: 16 / 9 },
  videoDeckName: { color: '#111111', fontSize: 14, fontWeight: '900', marginTop: 10, marginHorizontal: 10 },
  videoDate: { color: '#64748B', fontSize: 11, marginTop: 2, marginHorizontal: 10 },
  videoActions: { flexDirection: 'row', gap: 7, marginTop: 10, marginHorizontal: 10 },
  saveButton: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: colors.muted,
  },
  saveButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  deleteButton: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  deleteButtonText: { color: '#64748B', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});

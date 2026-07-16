import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { DeckCard } from '@/components/deck-card';
import { PortraitTransition } from '@/components/orientation-transition';
import { RoundVideoPlayer, type VideoSaveNotice } from '@/components/round-video-player';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { decks, getDeckById } from '@/data/decks';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import {
  getLoadedHomeBranding,
  HOME_BRANDING_SOURCES,
  loadHomeBranding,
} from '@/utils/home-branding';
import {
  deleteRoundVideo,
  isRoundVideoReadyToSave,
  loadRoundVideos,
  prepareRoundVideoExport,
  saveRoundVideoToDevice,
  type RoundVideo,
} from '@/video/round-videos';

export default function DeckLibraryScreen() {
  const { width } = useWindowDimensions();
  const scrollViewRef = useRef<ScrollView>(null);
  const libraryTop = useRef(0);
  const sectionOffsets = useRef({ decks: 0, videos: 0 });
  const sectionHeadingOffsets = useRef({ decks: 0, videos: 0 });
  const isPortrait = usePortraitScreen();
  const { revealTransition } = useScreenshotTransition();
  const branding = getLoadedHomeBranding() ?? HOME_BRANDING_SOURCES;
  const [decksExpanded, setDecksExpanded] = useState(true);
  const [videosExpanded, setVideosExpanded] = useState(true);
  const [videos, setVideos] = useState<RoundVideo[]>([]);
  const [savingVideoId, setSavingVideoId] = useState<string | null>(null);
  const [exportingVideoId, setExportingVideoId] = useState<string | null>(null);
  const [videoPendingDelete, setVideoPendingDelete] = useState<RoundVideo | null>(null);
  const [isDeletingVideo, setIsDeletingVideo] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const pageWidth = Math.min(width, 720);
  const horizontalPadding = width < 380 ? 22 : Math.min(48, Math.round(width * 0.074));
  const columnGap = width < 380 ? 16 : Math.min(32, Math.round(width * 0.06));
  const deckWidth = Math.floor((pageWidth - horizontalPadding * 2 - columnGap * 2) / 3);
  const videoWidth = Math.floor((pageWidth - horizontalPadding * 2 - columnGap) / 2);
  const brandWidth = Math.min(width * 0.74, 420);
  const headshotWidth = Math.round(brandWidth * 0.16);
  const wordmarkWidth = Math.round(brandWidth * 0.75);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!isPortrait) return () => {
        active = false;
      };

      void (async () => {
        try {
          await loadHomeBranding();
        } catch {
          // Local require() sources remain available as a safe fallback.
        }
        if (!active) return;

        // The captured results screen stays over the home screen until the
        // branding is decoded and mounted. Video I/O waits until it slides away.
        await revealTransition('home');
        if (!active) return;

        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!active) return;

        const storedVideos = await loadRoundVideos();
        if (!active) return;
        setVideos(storedVideos);
        storedVideos.forEach((video) => {
          if (isRoundVideoReadyToSave(video) || video.exportStatus === 'failed') return;
          void prepareRoundVideoExport(video).then((prepared) => {
            if (!active) return;
            setVideos((current) =>
              current.map((item) => (item.id === prepared.id ? prepared : item)),
            );
          });
        });
      })();

      return () => {
        active = false;
      };
    }, [isPortrait, revealTransition]),
  );

  const scrollToExpandedSection = useCallback((section: 'decks' | 'videos') => {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({
        animated: true,
        y: Math.max(
          0,
          libraryTop.current +
            sectionOffsets.current[section] +
            sectionHeadingOffsets.current[section],
        ),
      });
    });
  }, []);

  const handleDecksExpanded = useCallback(
    () => scrollToExpandedSection('decks'),
    [scrollToExpandedSection],
  );
  const handleVideosExpanded = useCallback(
    () => scrollToExpandedSection('videos'),
    [scrollToExpandedSection],
  );

  const toggleDecks = () => {
    const expanded = !decksExpanded;
    setDecksExpanded(expanded);
  };

  const toggleVideos = () => {
    const expanded = !videosExpanded;
    setVideosExpanded(expanded);
  };

  const handleSave = async (video: RoundVideo): Promise<VideoSaveNotice> => {
    if (savingVideoId || !isRoundVideoReadyToSave(video)) {
      return { title: 'Video not ready', message: 'Please wait for this video to finish exporting.' };
    }
    setSavingVideoId(video.id);
    try {
      await saveRoundVideoToDevice(video);
      return {
        title: 'Video saved',
        message: 'The round video and its sound are now in your device library.',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Please try again.';
      return { title: 'Could not save video', message: detail };
    } finally {
      setSavingVideoId(null);
    }
  };

  const handlePortraitSave = async (video: RoundVideo) => {
    setSaveNotice(await handleSave(video));
  };

  const handleRetryExport = async (video: RoundVideo) => {
    if (exportingVideoId) return;
    setExportingVideoId(video.id);
    setVideos((current) =>
      current.map((item) =>
        item.id === video.id ? { ...item, exportStatus: 'preparing' } : item,
      ),
    );
    try {
      const prepared = await prepareRoundVideoExport(video);
      setVideos((current) =>
        current.map((item) => (item.id === prepared.id ? prepared : item)),
      );
      if (prepared.exportStatus === 'failed') {
        setSaveNotice({
          title: 'Export failed',
          message: 'The video and its audio are safe in WHATZ IT. Please send the [RoundVideo] terminal logs.',
        });
      }
    } finally {
      setExportingVideoId(null);
    }
  };

  const handleDelete = (video: RoundVideo) => {
    setDeleteError(null);
    setVideoPendingDelete(video);
  };

  const deleteFromPlayer = async (video: RoundVideo) => {
    const next = await deleteRoundVideo(video.id);
    setVideos(next);
  };

  const cancelDelete = () => {
    if (isDeletingVideo) return;
    setVideoPendingDelete(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!videoPendingDelete || isDeletingVideo) return;
    setIsDeletingVideo(true);
    setDeleteError(null);
    try {
      const next = await deleteRoundVideo(videoPendingDelete.id);
      setVideos(next);
      setVideoPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsDeletingVideo(false);
    }
  };

  if (!isPortrait) return <PortraitTransition style={styles.orientationGate} />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        accessibilityElementsHidden={videoPendingDelete !== null}
        contentContainerStyle={styles.scrollContent}
        importantForAccessibility={
          videoPendingDelete === null ? 'auto' : 'no-hide-descendants'
        }
        ref={scrollViewRef}
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
              priority="high"
              source={branding.headshot}
              style={{ width: headshotWidth, height: headshotWidth * 1.5 }}
            />
            <Image
              accessible={false}
              contentFit="contain"
              priority="high"
              source={branding.wordmark}
              style={{ width: wordmarkWidth, height: wordmarkWidth / 3 }}
            />
          </View>
        </View>

        <View
          onLayout={(event) => {
            libraryTop.current = event.nativeEvent.layout.y;
          }}
          style={[styles.library, { width: pageWidth, paddingHorizontal: horizontalPadding }]}
        >
          <View
            onLayout={(event) => {
              sectionOffsets.current.decks = event.nativeEvent.layout.y;
            }}
          >
            <SectionHeading
              expanded={decksExpanded}
              label="MY DECKS"
              onLayout={(event) => {
                sectionHeadingOffsets.current.decks = event.nativeEvent.layout.y;
              }}
              onPress={toggleDecks}
            />

            <CollapsibleContent
              expanded={decksExpanded}
              onExpansionComplete={handleDecksExpanded}
            >
              <View style={[styles.deckGrid, { columnGap, rowGap: columnGap }]}>
                {decks.map((deck) => (
                  <View key={deck.id} style={{ width: deckWidth, aspectRatio: 2 / 3 }}>
                    <DeckCard deck={deck} />
                  </View>
                ))}
              </View>
            </CollapsibleContent>
          </View>

          <View
            onLayout={(event) => {
              sectionOffsets.current.videos = event.nativeEvent.layout.y;
            }}
            style={styles.videoSection}
          >
            <View accessibilityElementsHidden style={styles.sectionDivider} />

            <SectionHeading
              expanded={videosExpanded}
              label="MY VIDEOS"
              onLayout={(event) => {
                sectionHeadingOffsets.current.videos = event.nativeEvent.layout.y;
              }}
              onPress={toggleVideos}
            />

            <CollapsibleContent
              expanded={videosExpanded}
              onExpansionComplete={handleVideosExpanded}
            >
              {videos.length === 0 ? (
                <Text style={styles.emptyVideos}>Your last 10 round videos will appear here.</Text>
              ) : (
                <View style={[styles.videoGrid, { columnGap, rowGap: columnGap }]}>
                  {videos.map((video) => {
                    const deck = getDeckById(video.deckId);
                    const videoReady = isRoundVideoReadyToSave(video);
                    const exportFailed = video.exportStatus === 'failed';
                    const exportPreparing = !videoReady && !exportFailed;
                    return (
                      <View key={video.id} style={[styles.videoCard, { width: videoWidth }]}>
                      <RoundVideoPlayer
                        isSaving={savingVideoId === video.id}
                        saveDisabled={!isRoundVideoReadyToSave(video)}
                        onDelete={deleteFromPlayer}
                        onSave={handleSave}
                        staticThumbnail
                        video={video}
                        style={styles.video}
                      />
                      <Text numberOfLines={1} style={styles.videoDeckName}>
                        {deck?.title ?? 'Round video'}
                      </Text>
                      <Text style={styles.videoDate}>
                        {new Date(video.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Text>
                      <View style={styles.videoActions}>
                        <Pressable
                          accessibilityLabel={
                            exportFailed
                              ? 'Retry video export'
                              : videoReady
                                ? 'Save video'
                                : 'Video is exporting'
                          }
                          accessibilityRole="button"
                          accessibilityState={{
                            busy: exportPreparing || savingVideoId === video.id,
                            disabled:
                              savingVideoId !== null ||
                              exportingVideoId !== null ||
                              exportPreparing,
                          }}
                          disabled={
                            savingVideoId !== null ||
                            exportingVideoId !== null ||
                            exportPreparing
                          }
                          onPress={() =>
                            void (exportFailed
                              ? handleRetryExport(video)
                              : handlePortraitSave(video))
                          }
                          style={({ pressed }) => [
                            styles.saveButton,
                            exportPreparing && styles.disabled,
                            pressed && (videoReady || exportFailed) && styles.pressed,
                          ]}
                        >
                          {exportPreparing ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                          ) : (
                            <Text numberOfLines={1} style={styles.saveButtonText}>
                              {exportFailed
                                ? 'RETRY'
                                : savingVideoId === video.id
                                  ? 'SAVING…'
                                  : 'SAVE'}
                            </Text>
                          )}
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
            </CollapsibleContent>
          </View>
        </View>
      </ScrollView>
      <ConfirmationPrompt
        busy={isDeletingVideo}
        busyLabel="DELETING..."
        confirmLabel="DELETE VIDEO"
        destructive
        message={
          deleteError
            ? `The video could not be deleted. ${deleteError}`
            : 'This removes the video from WHATZ IT on this device.'
        }
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
        title={deleteError ? 'Could not delete video' : 'Delete round video?'}
        visible={videoPendingDelete !== null}
      />
      <ConfirmationPrompt
        cancelLabel={null}
        confirmLabel="OK"
        message={saveNotice?.message ?? ''}
        onCancel={() => setSaveNotice(null)}
        onConfirm={() => setSaveNotice(null)}
        title={saveNotice?.title ?? ''}
        visible={saveNotice !== null}
      />
    </SafeAreaView>
  );
}

const COLLAPSE_DURATION = 280;

function CollapsibleContent({
  expanded,
  children,
  onExpansionComplete,
}: {
  expanded: boolean;
  children: ReactNode;
  onExpansionComplete?: () => void;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useSharedValue(expanded ? 1 : 0);
  const previousExpanded = useRef(expanded);

  useEffect(() => {
    const shouldNotifyExpansion = expanded && !previousExpanded.current;
    previousExpanded.current = expanded;
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: COLLAPSE_DURATION,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (finished && shouldNotifyExpansion && onExpansionComplete) {
        runOnJS(onExpansionComplete)();
      }
    });
  }, [expanded, onExpansionComplete, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: contentHeight * progress.value,
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [-10, 0]) }],
  }));

  return (
    <Animated.View
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      pointerEvents={expanded ? 'auto' : 'none'}
      style={[styles.collapsible, animatedStyle]}
    >
      <View
        onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
        style={styles.collapsibleContent}
      >
        {children}
      </View>
    </Animated.View>
  );
}

function SectionHeading({
  expanded,
  label,
  onLayout,
  onPress,
}: {
  expanded: boolean;
  label: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onLayout={onLayout}
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
  collapsible: { overflow: 'hidden' },
  collapsibleContent: { position: 'absolute', top: 0, right: 0, left: 0 },
  deckGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  videoSection: { marginTop: 34 },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 30,
    backgroundColor: '#CBD5E1',
  },
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
    backgroundColor: '#459EFE',
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
  disabled: { opacity: 0.55 },
});

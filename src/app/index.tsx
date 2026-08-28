import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import * as MailComposer from 'expo-mail-composer';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  configuredCatalogManifestUrl,
  configuredCatalogSource,
} from '@/catalog/catalog-feature';
import { useCatalog } from '@/catalog/catalog-provider';
import { catalogRolloutSelectedDetails } from '@/catalog/catalog-rollout-observability';
import {
  buildCatalogSupportDiagnosticsText,
  buildCatalogSupportFallbackEmailUrl,
} from '@/catalog/catalog-support-diagnostics';
import {
  DECK_LIBRARY_SORTS,
  DEFAULT_DECK_LIBRARY_SORT,
  sortLibraryDecks,
  type DeckLibrarySort,
} from '@/catalog/deck-library-sort';
import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { DeckCard } from '@/components/deck-card';
import { PortraitTransition } from '@/components/orientation-transition';
import { RoundVideoPlayer, type VideoSaveNotice } from '@/components/round-video-player';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import {
  StorefrontExplore,
  type RestorePurchasesNotice,
} from '@/components/storefront-explore';
import { useRound } from '@/game/round-context';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import {
  loadDeckLibrarySort,
  loadDeckPlayHistory,
  saveDeckLibrarySort,
} from '@/storage/deck-library-preferences';
import { buildFlightRecorderTraceText } from '@/utils/flight-recorder';
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
  subscribeToRoundVideoLibrary,
  type RoundVideo,
} from '@/video/round-videos';

const PRIVACY_POLICY_URL = 'https://playwhatzit.com/#privacy';
const SUPPORT_EMAIL = 'support@playwhatzit.com';
const HEADER_OVERSCROLL_EXTENSION = 700;
const SORT_MENU_GAP = 6;
const SORT_MENU_VIEWPORT_MARGIN = 12;
const SORT_MENU_ESTIMATED_HEIGHT = DECK_LIBRARY_SORTS.length * 44 + 2;
const HOME_SCROLL_DIAGNOSTICS = __DEV__;

const DECK_SORT_LABELS: Record<DeckLibrarySort, string> = {
  'recently-played': 'Recently played',
  alphabetical: 'Alphabetical',
  'unplayed-first': 'Unplayed first',
};

type SortMenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function homeScrollMetrics(event: NativeSyntheticEvent<NativeScrollEvent>) {
  const {
    contentInset,
    contentOffset,
    contentSize,
    layoutMeasurement,
    velocity,
  } = event.nativeEvent;
  const maxOffsetY = Math.max(
    0,
    contentSize.height + contentInset.bottom - layoutMeasurement.height,
  );

  return {
    y: Math.round(contentOffset.y * 10) / 10,
    maxY: Math.round(maxOffsetY * 10) / 10,
    beyondBottom: Math.round(Math.max(0, contentOffset.y - maxOffsetY) * 10) / 10,
    contentHeight: Math.round(contentSize.height * 10) / 10,
    viewportHeight: Math.round(layoutMeasurement.height * 10) / 10,
    insetTop: Math.round(contentInset.top * 10) / 10,
    insetBottom: Math.round(contentInset.bottom * 10) / 10,
    velocityY: velocity ? Math.round(velocity.y * 100) / 100 : null,
  };
}

function logHomeScroll(
  eventName: string,
  details?: Record<string, unknown>,
) {
  if (!HOME_SCROLL_DIAGNOSTICS) return;
  console.log(`[HomeScroll] ${eventName}`, details ?? {});
}

export default function DeckLibraryScreen() {
  const reduceMotion = useReducedMotion();
  const catalogState = useCatalog();
  const { catalog } = catalogState;
  const supportDiagnosticsText = useMemo(() => {
    const manifestUrl = configuredCatalogManifestUrl();
    const rollout = catalogRolloutSelectedDetails(
      configuredCatalogSource(),
      manifestUrl,
      catalog.revision,
      catalog.schemaVersion,
    );
    const syncStatus = catalogState.status === 'ready'
      ? catalogState.syncStatus
      : catalogState.status;
    const syncError = catalogState.status === 'ready'
      ? catalogState.syncError
      : catalogState.status === 'error'
        ? catalogState.error
        : undefined;
    const syncErrorCode = syncError && 'code' in syncError
      ? String(syncError.code)
      : syncError
        ? 'unexpected_error'
        : undefined;
    return buildCatalogSupportDiagnosticsText({
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      catalog,
      platform: Platform.OS,
      rolloutCohort: rollout.cohort,
      syncStatus,
      ...(syncErrorCode ? { syncErrorCode } : {}),
    });
  }, [catalog, catalogState]);
  const { height: windowHeight, width } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const deckSearchInputRef = useRef<TextInput>(null);
  const isScrollingProgrammatically = useRef(false);
  const currentScrollOffset = useRef(0);
  const scrollContentHeight = useRef(0);
  const scrollViewportHeight = useRef(0);
  const scrollDragSequence = useRef(0);
  const loggedBottomOverscroll = useRef(false);
  const exploreRef = useRef<{ blurSearch: () => void }>(null);
  const libraryTop = useRef(0);
  const exploreTop = useRef(0);
  const isPortrait = usePortraitScreen();
  const { isVideoFinalizing } = useRound();
  const { revealTransition } = useScreenshotTransition();
  const branding = getLoadedHomeBranding() ?? HOME_BRANDING_SOURCES;
  const [librarySection, setLibrarySection] = useState<'decks' | 'videos'>('decks');
  const [deckSort, setDeckSort] = useState<DeckLibrarySort>(
    DEFAULT_DECK_LIBRARY_SORT,
  );
  const myLibraryPosition = useSharedValue(librarySection === 'videos' ? 1 : 0);
  const [myLibraryControlWidth, setMyLibraryControlWidth] = useState(0);
  const [deckSearch, setDeckSearch] = useState('');
  const [isDeckSearchOpen, setIsDeckSearchOpen] = useState(false);
  const [isDeckSearchFocused, setIsDeckSearchFocused] = useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [sortMenuAnchor, setSortMenuAnchor] = useState<SortMenuAnchor>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [sortMenuHeight, setSortMenuHeight] = useState(SORT_MENU_ESTIMATED_HEIGHT);
  const deckToolbarProgress = useSharedValue(isDeckSearchOpen ? 1 : 0);
  const [deckPlayHistory, setDeckPlayHistory] = useState<Record<string, number>>({});
  const [homeMode, setHomeMode] = useState<'my-decks' | 'explore'>('my-decks');
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
  const [externalLinkError, setExternalLinkError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [restorePurchasesNotice, setRestorePurchasesNotice] =
    useState<RestorePurchasesNotice | null>(null);
  const pageWidth = Math.min(width, 720);
  const horizontalPadding = width < 380 ? 22 : Math.min(48, Math.round(width * 0.074));
  const columnGap = width < 380 ? 16 : Math.min(32, Math.round(width * 0.06));
  const deckWidth = Math.floor((pageWidth - horizontalPadding * 2 - columnGap * 2) / 3);
  const videoWidth = Math.floor((pageWidth - horizontalPadding * 2 - columnGap) / 2);
  const brandWidth = Math.min(width * 0.74, 420);
  const headshotWidth = Math.round(brandWidth * 0.16);
  const wordmarkWidth = Math.round(brandWidth * 0.75);
  useEffect(() => {
    myLibraryPosition.value = withTiming(
      librarySection === 'videos' ? 1 : 0,
      {
        duration: reduceMotion ? 0 : 220,
        easing: Easing.out(Easing.cubic),
      },
    );
  }, [librarySection, myLibraryPosition, reduceMotion]);
  useEffect(() => {
    deckToolbarProgress.value = withTiming(isDeckSearchOpen ? 1 : 0, {
      duration: reduceMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [deckToolbarProgress, isDeckSearchOpen, reduceMotion]);
  const deckSortToolbarStyle = useAnimatedStyle(() => ({
    opacity: 1 - deckToolbarProgress.value,
    transform: [
      {
        translateX: deckToolbarProgress.value * -14,
      },
    ],
  }));

  const deckSearchToolbarStyle = useAnimatedStyle(() => ({
    opacity: deckToolbarProgress.value,
    transform: [
      {
        translateX: (1 - deckToolbarProgress.value) * 14,
      },
    ],
  }));
  const myLibraryIndicatorStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX:
            myLibraryPosition.value * (myLibraryControlWidth / 2),
        },
      ],
    }),
    [myLibraryControlWidth],
  );
  const [sessionDeckOrder, setSessionDeckOrder] = useState(() =>
    [...catalog.freeDecks, ...catalog.paidDecks].map((deck) => deck.id),
  );
  useEffect(() => {
    const catalogIds = [...catalog.freeDecks, ...catalog.paidDecks].map(
      (deck) => deck.id,
    );
    const available = new Set(catalogIds);
    const frame = requestAnimationFrame(() => {
      setSessionDeckOrder((current) => {
        const retainedIds = current.filter((deckId) => available.has(deckId));
        const retained = new Set(retainedIds);
        const addedIds = catalogIds.filter((deckId) => !retained.has(deckId));
        const next = [...retainedIds, ...addedIds];
        return next.length === current.length
          && next.every((deckId, index) => deckId === current[index])
          ? current
          : next;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [catalog.freeDecks, catalog.paidDecks]);
  const sessionOrderedDecks = useMemo(() => {
    const catalogDecks = [...catalog.freeDecks, ...catalog.paidDecks];
    const decksById = new Map(catalogDecks.map((deck) => [deck.id, deck]));
    return sessionDeckOrder
      .map((deckId) => decksById.get(deckId))
      .filter((deck) => deck !== undefined);
  }, [catalog.freeDecks, catalog.paidDecks, sessionDeckOrder]);
  const filteredDecks = useMemo(() => {
    const searchLower = deckSearch.trim().toLowerCase();
    const allInstalledDecks = sessionOrderedDecks.filter(
      (deck) => deck.installationStatus === 'installed',
    );
    if (!searchLower) return allInstalledDecks;
    return allInstalledDecks.filter((deck) =>
      deck.title.toLowerCase().includes(searchLower),
    );
  }, [deckSearch, sessionOrderedDecks]);

  const visibleDecks = useMemo(
    () => sortLibraryDecks(filteredDecks, deckPlayHistory, deckSort),
    [deckPlayHistory, deckSort, filteredDecks],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void Promise.all([loadDeckLibrarySort(), loadDeckPlayHistory()]).then(
        ([storedSort, storedHistory]) => {
          if (!active) return;
          setDeckSort(storedSort);
          setDeckPlayHistory(storedHistory);
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let libraryChanged = false;
      const unsubscribe = subscribeToRoundVideoLibrary((nextVideos) => {
        if (!active) return;
        libraryChanged = true;
        setVideos(nextVideos);
      });
      if (!isPortrait) return () => {
        active = false;
        unsubscribe();
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
        if (!libraryChanged) setVideos(storedVideos);
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
        unsubscribe();
      };
    }, [isPortrait, revealTransition]),
  );

  useEffect(() => {
    if (librarySection !== 'decks') {
      deckSearchInputRef.current?.blur();
    }
  }, [librarySection]);

  const handleDeckSearchFocus = useCallback(() => {
    isScrollingProgrammatically.current = true;
    deckSearchInputRef.current?.measureInWindow((x, screenY, width, height) => {
      const targetScreenY = 80; // Position it 80px from top
      const newScrollOffset = currentScrollOffset.current + (screenY - targetScreenY);

      scrollViewRef.current?.scrollTo({
        animated: true,
        y: Math.max(0, newScrollOffset),
      });

      setTimeout(() => {
        isScrollingProgrammatically.current = false;
      }, 500);
    });
  }, []);

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
          message: 'The video and its audio are safe inside the WHATZ IT? app. Please send the [RoundVideo] terminal logs.',
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

  const openExternalLink = useCallback((url: string, errorMessage: string) => {
    void Linking.openURL(url).catch(() => {
      setExternalLinkError({
        title: 'Could not open link',
        message: errorMessage,
      });
    });
  }, []);
  const handleContactSupport = useCallback(() => {
    void (async () => {
      try {
        if (Platform.OS !== 'web' && await MailComposer.isAvailableAsync()) {
          const diagnosticsFile = new File(
            Paths.cache,
            'whatz-it-support-diagnostics.txt',
          );
          diagnosticsFile.create({ intermediates: true, overwrite: true });
          diagnosticsFile.write([
            supportDiagnosticsText,
            '',
            'Recent commerce timeline (no credentials or signed transactions)',
            buildFlightRecorderTraceText('commerce.'),
            '',
            'Recent app lifecycle timeline',
            buildFlightRecorderTraceText('lifecycle.', 20),
          ].join('\n'));

          await MailComposer.composeAsync({
            recipients: [SUPPORT_EMAIL],
            subject: 'WHATZ IT? Support',
            body: 'Please describe what happened:\n\n',
            attachments: [diagnosticsFile.uri],
          });
          return;
        }
      } catch (error) {
        console.warn('[Support] Could not attach diagnostics.', error);
      }

      openExternalLink(
        buildCatalogSupportFallbackEmailUrl(SUPPORT_EMAIL),
        `Email us directly at ${SUPPORT_EMAIL}.`,
      );
    })();
  }, [openExternalLink, supportDiagnosticsText]);
  const showRestorePurchasesNotice = useCallback((notice: RestorePurchasesNotice) => {
    logHomeScroll('restore-notice-requested', { title: notice.title });
    setRestorePurchasesNotice(notice);
  }, []);
  const dismissRestorePurchasesNotice = useCallback(() => {
    logHomeScroll('restore-notice-dismiss-requested', {
      currentY: Math.round(currentScrollOffset.current * 10) / 10,
      contentHeight: scrollContentHeight.current,
      viewportHeight: scrollViewportHeight.current,
    });
    setRestorePurchasesNotice(null);
  }, []);
  const scrollToExploreOffset = useCallback((offset: number) => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        animated: true,
        y: Math.max(0, libraryTop.current + exploreTop.current + offset - 8),
      });
    }, 60);
  }, []);

  const handleToggleSortMenu = useCallback(
    (anchor?: SortMenuAnchor) => {
      if (isSortMenuOpen || !anchor) {
        setIsSortMenuOpen(false);
        return;
      }

      setSortMenuAnchor(anchor);
      setIsSortMenuOpen(true);
    },
    [isSortMenuOpen],
  );

  const sortMenuLeft = Math.min(
    Math.max(SORT_MENU_VIEWPORT_MARGIN, sortMenuAnchor.x),
    Math.max(
      SORT_MENU_VIEWPORT_MARGIN,
      width - sortMenuAnchor.width - SORT_MENU_VIEWPORT_MARGIN,
    ),
  );
  const sortMenuTopBelow = sortMenuAnchor.y + sortMenuAnchor.height + SORT_MENU_GAP;
  const sortMenuTopAbove = sortMenuAnchor.y - sortMenuHeight - SORT_MENU_GAP;
  const sortMenuViewportTop = safeAreaInsets.top + SORT_MENU_VIEWPORT_MARGIN;
  const sortMenuViewportBottom =
    windowHeight - safeAreaInsets.bottom - SORT_MENU_VIEWPORT_MARGIN;
  const sortMenuFitsBelow =
    sortMenuTopBelow + sortMenuHeight <= sortMenuViewportBottom;
  const sortMenuTop = Math.min(
    Math.max(
      sortMenuViewportTop,
      sortMenuFitsBelow ? sortMenuTopBelow : sortMenuTopAbove,
    ),
    Math.max(
      sortMenuViewportTop,
      sortMenuViewportBottom - sortMenuHeight,
    ),
  );

  const deckLibraryContent = (
    <View style={styles.deckLibraryContent}>
      <DeckLibraryToolbar
        inputRef={deckSearchInputRef}
        isSearchOpen={isDeckSearchOpen}
        isSearchFocused={isDeckSearchFocused}
        isSortMenuOpen={isSortMenuOpen}
        searchAnimatedStyle={deckSearchToolbarStyle}
        sortAnimatedStyle={deckSortToolbarStyle}
        onChangeSearch={setDeckSearch}
        onClearSearch={() => {
          setDeckSearch('');

          if (isDeckSearchFocused) {
            requestAnimationFrame(() => {
              deckSearchInputRef.current?.focus();
            });
          } else {
            setIsDeckSearchOpen(false);
          }
        }}
        onCloseSearch={() => {
          setDeckSearch('');
          setIsDeckSearchOpen(false);
          setIsDeckSearchFocused(false);
          deckSearchInputRef.current?.blur();
        }}
        onFocusChange={setIsDeckSearchFocused}
        onFocusSearch={handleDeckSearchFocus}
        onOpenSearch={() => {
          setIsSortMenuOpen(false);
          setIsDeckSearchOpen(true);

          setTimeout(() => {
            deckSearchInputRef.current?.focus();
          }, reduceMotion ? 0 : 120);
        }}
        onToggleSort={handleToggleSortMenu}
        search={deckSearch}
        sort={deckSort}
      />
      {visibleDecks.length > 0 ? (
        <View style={[styles.deckGrid, { columnGap, rowGap: columnGap }]}>
          {visibleDecks.map((deck) => (
            <View key={deck.id} style={{ width: deckWidth, aspectRatio: 2 / 3 }}>
              <DeckCard
                deck={deck}
                showNewBadge={
                  deck.access === 'paid'
                  && deck.installationStatus === 'installed'
                  && deckPlayHistory[deck.id] === undefined
                }
              />
            </View>
          ))}
        </View>
      ) : (
        <Text accessibilityLiveRegion="polite" style={styles.emptyDecks}>
          {deckSearch.trim()
            ? 'No decks match your search.'
            : 'Your decks will appear here.'}
        </Text>
      )}
    </View>
  );

  const videoLibraryContent = (
    <View style={styles.videoLibraryContent}>
      {isVideoFinalizing && (
        <View
          accessibilityLabel="Preparing latest round video"
          accessibilityRole="progressbar"
          style={styles.pendingVideo}
        >
          <ActivityIndicator color="#459EFE" size="small" />
          <Text style={styles.pendingVideoText}>Preparing latest round video…</Text>
        </View>
      )}
      {videos.length === 0 ? (
        !isVideoFinalizing && (
          <Text style={styles.emptyVideos}>Your last 10 round videos will appear here.</Text>
        )
      ) : (
        <View style={[styles.videoGrid, { columnGap, rowGap: columnGap }]}>
          {videos.map((video) => {
            const deck = catalog.getDeckById(video.deckId);
            const videoReady = isRoundVideoReadyToSave(video);
            const exportFailed = video.exportStatus === 'failed';
            const exportPreparing = !videoReady && !exportFailed;
            return (
              <View key={video.id} style={[styles.videoCard, { width: videoWidth }]}>
                {exportPreparing ? (
                  <View
                    accessibilityLabel="Preparing round video"
                    accessibilityRole="progressbar"
                    style={[styles.video, styles.videoPreparing]}
                  >
                    <ActivityIndicator color="#459EFE" size="small" />
                  </View>
                ) : (
                  <RoundVideoPlayer
                    isSaving={savingVideoId === video.id}
                    saveDisabled={!isRoundVideoReadyToSave(video)}
                    onDelete={deleteFromPlayer}
                    onSave={handleSave}
                    staticThumbnail
                    video={video}
                    style={styles.video}
                  />
                )}
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
    </View>
  );

  if (!isPortrait) return <PortraitTransition style={styles.orientationGate} />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        accessibilityElementsHidden={videoPendingDelete !== null || isSortMenuOpen}
        // StoreKit and modal dismissal can be misidentified as a keyboard frame
        // change on iOS, leaving a full-screen bottom inset behind. Both search
        // controls already scroll themselves into view when focused.
        automaticallyAdjustKeyboardInsets={false}
        contentContainerStyle={styles.scrollContent}
        importantForAccessibility={
          videoPendingDelete === null && !isSortMenuOpen
            ? 'auto'
            : 'no-hide-descendants'
        }
        ref={scrollViewRef}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(contentWidth, contentHeight) => {
          scrollContentHeight.current = contentHeight;
          logHomeScroll('content-size', {
            contentWidth,
            contentHeight,
            mode: homeMode,
            section: librarySection,
          });
        }}
        onLayout={(event) => {
          scrollViewportHeight.current = event.nativeEvent.layout.height;
          logHomeScroll('viewport-layout', {
            height: event.nativeEvent.layout.height,
            width: event.nativeEvent.layout.width,
          });
        }}
        onMomentumScrollBegin={(event) => {
          logHomeScroll('momentum-begin', {
            drag: scrollDragSequence.current,
            ...homeScrollMetrics(event),
          });
        }}
        onMomentumScrollEnd={(event) => {
          logHomeScroll('momentum-end', {
            drag: scrollDragSequence.current,
            ...homeScrollMetrics(event),
          });
        }}
        onScroll={(e) => {
          currentScrollOffset.current = e.nativeEvent.contentOffset.y;

          if (HOME_SCROLL_DIAGNOSTICS && !loggedBottomOverscroll.current) {
            const metrics = homeScrollMetrics(e);
            if (metrics.beyondBottom > 1) {
              loggedBottomOverscroll.current = true;
              logHomeScroll('bottom-overscroll', {
                drag: scrollDragSequence.current,
                ...metrics,
              });
            }
          }

          if (isSortMenuOpen) {
            setIsSortMenuOpen(false);
          }

          if (!isScrollingProgrammatically.current) {
            deckSearchInputRef.current?.blur();
            exploreRef.current?.blurSearch();

            if (isDeckSearchOpen && !deckSearch.trim()) {
              setIsDeckSearchOpen(false);
            }
          }
        }}
        onScrollBeginDrag={(event) => {
          scrollDragSequence.current += 1;
          loggedBottomOverscroll.current = false;
          logHomeScroll('drag-begin', {
            drag: scrollDragSequence.current,
            mode: homeMode,
            section: librarySection,
            ...homeScrollMetrics(event),
          });
        }}
        onScrollEndDrag={(event) => {
          logHomeScroll('drag-end', {
            drag: scrollDragSequence.current,
            ...homeScrollMetrics(event),
          });
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
        <View style={styles.brandCard}>
          <View
            accessible
            accessibilityLabel="WHATZ IT?"
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
          <HomeModeControl mode={homeMode} onChange={setHomeMode} />

          {homeMode === 'my-decks' ? (
            <View style={styles.myDecksContent}>
              <MyLibraryControl
                indicatorStyle={myLibraryIndicatorStyle}
                onLayout={(width) => setMyLibraryControlWidth(width)}
                section={librarySection}
                onChange={(section) => {
                  setLibrarySection(section);

                  if (section === 'videos') {
                    deckSearchInputRef.current?.blur();
                  }
                }}
              />
              {librarySection === 'decks' ? deckLibraryContent : videoLibraryContent}
            </View>
          ) : (
            <View
              onLayout={(event) => {
                exploreTop.current = event.nativeEvent.layout.y;
              }}
            >
              <StorefrontExplore
                catalog={catalog}
                onBrowseFocus={scrollToExploreOffset}
                onRestoreNotice={showRestorePurchasesNotice}
                ref={exploreRef}
              />
            </View>
          )}

        </View>
        <View style={styles.footerLinks}>
          <Pressable
            accessibilityHint="Opens the WHATZ IT? privacy policy in your browser"
            accessibilityRole="link"
            onPress={() =>
              openExternalLink(
                PRIVACY_POLICY_URL,
                `Visit ${PRIVACY_POLICY_URL} in your browser.`,
              )
            }
            style={({ pressed }) => [
              styles.footerLink,
              pressed && styles.footerLinkPressed,
            ]}
          >
            <Text style={styles.footerLinkText}>PRIVACY POLICY</Text>
          </Pressable>
          <Pressable
            accessibilityHint="Opens your email app to contact WHATZ IT? support"
            accessibilityLabel={`Email WHATZ IT? support at ${SUPPORT_EMAIL}`}
            accessibilityRole="link"
            onPress={handleContactSupport}
            style={({ pressed }) => [
              styles.footerLink,
              pressed && styles.footerLinkPressed,
            ]}
          >
            <Text style={styles.footerLinkText}>CONTACT</Text>
          </Pressable>
        </View>
      </ScrollView>

      {isSortMenuOpen && (
        <View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          pointerEvents="box-none"
          style={styles.sortFloatingLayer}
        >
          <Pressable
            accessible={false}
            onPress={() => setIsSortMenuOpen(false)}
            style={styles.sortBackdrop}
          />

          <Pressable
            accessibilityLabel={`Sort decks by ${DECK_SORT_LABELS[deckSort]}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: true }}
            onPress={() => setIsSortMenuOpen(false)}
            style={({ pressed }) => [
              styles.deckSortDropdown,
              styles.sortFloatingButton,
              {
                left: sortMenuLeft,
                top: sortMenuAnchor.y,
                width: sortMenuAnchor.width,
                height: sortMenuAnchor.height,
              },
              pressed && styles.deckSortDropdownPressed,
            ]}
          >
            <Text
              numberOfLines={1}
              style={styles.deckSortDropdownText}
            >
              {DECK_SORT_LABELS[deckSort]}
            </Text>

            <Text
              accessibilityElementsHidden
              style={[
                styles.deckSortChevron,
                styles.deckSortChevronOpen,
              ]}
            >
              ‹
            </Text>
          </Pressable>

          <View
            onLayout={(event) => {
              const measuredHeight = event.nativeEvent.layout.height;

              if (measuredHeight !== sortMenuHeight) {
                setSortMenuHeight(measuredHeight);
              }
            }}
            style={[
              styles.deckSortMenu,
              styles.sortFloatingMenu,
              {
                left: sortMenuLeft,
                top: sortMenuTop,
                width: sortMenuAnchor.width,
              },
            ]}
          >
            {DECK_LIBRARY_SORTS.map((option) => {
              const selected = option === deckSort;

              return (
                <Pressable
                  accessibilityLabel={`Sort decks by ${DECK_SORT_LABELS[option]}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={option}
                  onPress={() => {
                    setDeckSort(option);
                    setIsSortMenuOpen(false);
                    void saveDeckLibrarySort(option);
                  }}
                  style={({ pressed }) => [
                    styles.deckSortMenuItem,
                    selected && styles.deckSortMenuItemSelected,
                    pressed && styles.deckSortMenuItemPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.deckSortMenuItemText,
                      selected && styles.deckSortMenuItemTextSelected,
                    ]}
                  >
                    {DECK_SORT_LABELS[option]}
                  </Text>

                  {selected && (
                    <Text style={styles.deckSortCheck}>✓</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <ConfirmationPrompt
        busy={isDeletingVideo}
        busyLabel="DELETING..."
        confirmLabel="DELETE VIDEO"
        destructive
        message={
          deleteError
            ? `The video could not be deleted. ${deleteError}`
            : 'This removes the video from WHATZ IT? on this device.'
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
      <ConfirmationPrompt
        cancelLabel={null}
        confirmLabel="OK"
        message={restorePurchasesNotice?.message ?? ''}
        onCancel={dismissRestorePurchasesNotice}
        onConfirm={dismissRestorePurchasesNotice}
        onDismissed={() => logHomeScroll('restore-notice-native-dismissed')}
        onShown={() => logHomeScroll('restore-notice-native-shown')}
        title={restorePurchasesNotice?.title ?? ''}
        visible={restorePurchasesNotice !== null}
      />
      <ConfirmationPrompt
        cancelLabel={null}
        confirmLabel="OK"
        message={externalLinkError?.message ?? ''}
        onCancel={() => setExternalLinkError(null)}
        onConfirm={() => setExternalLinkError(null)}
        title={externalLinkError?.title ?? ''}
        visible={externalLinkError !== null}
      />
    </SafeAreaView>
  );
}

function DeckLibraryToolbar({
  inputRef,
  isSearchOpen,
  isSearchFocused,
  isSortMenuOpen,
  onChangeSearch,
  onClearSearch,
  onCloseSearch,
  onFocusChange,
  onFocusSearch,
  onOpenSearch,
  onToggleSort,
  search,
  searchAnimatedStyle,
  sort,
  sortAnimatedStyle,
}: {
  inputRef: React.RefObject<TextInput | null>;
  isSearchOpen: boolean;
  isSearchFocused: boolean;
  isSortMenuOpen: boolean;
  onChangeSearch: (text: string) => void;
  onClearSearch: () => void;
  onCloseSearch: () => void;
  onFocusChange: (focused: boolean) => void;
  onFocusSearch?: () => void;
  onOpenSearch: () => void;
  onToggleSort: (anchor?: SortMenuAnchor) => void;
  search: string;
  searchAnimatedStyle: any;
  sort: DeckLibrarySort;
  sortAnimatedStyle: any;
}) {
  const sortButtonRef = useRef<View>(null);

  const handleSortButtonPress = () => {
    if (isSortMenuOpen) {
      onToggleSort();
      return;
    }

    sortButtonRef.current?.measureInWindow((x, y, width, height) => {
      onToggleSort({ x, y, width, height });
    });
  };

  return (
    <>
      <View style={styles.deckToolbarContainer}>
        <Animated.View
          pointerEvents={isSearchOpen ? 'none' : 'auto'}
          style={[
            styles.deckToolbarLayer,
            sortAnimatedStyle,
          ]}
        >
          <View style={styles.deckSortArea}>
            <Text style={styles.deckSortLabel}>SORT BY</Text>

            <View style={styles.deckSortDropdownWrapper}>
              <Pressable
                accessibilityLabel={`Sort decks by ${DECK_SORT_LABELS[sort]}`}
                accessibilityRole="button"
                accessibilityState={{ expanded: isSortMenuOpen }}
                onPress={handleSortButtonPress}
                ref={sortButtonRef}
                style={({ pressed }) => [
                  styles.deckSortDropdown,
                  isSortMenuOpen && styles.deckSortDropdownOpen,
                  pressed && styles.deckSortDropdownPressed,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={styles.deckSortDropdownText}
                >
                  {DECK_SORT_LABELS[sort]}
                </Text>

                <Text
                  accessibilityElementsHidden
                  style={[
                    styles.deckSortChevron,
                    isSortMenuOpen && styles.deckSortChevronOpen,
                  ]}
                >
                  ‹
                </Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            accessibilityLabel="Search decks"
            accessibilityRole="button"
            onPress={onOpenSearch}
            style={({ pressed }) => [
              styles.deckSearchButton,
              pressed && styles.deckSearchButtonPressed,
            ]}
          >
            <Text style={styles.deckSearchButtonIcon}>⌕</Text>
          </Pressable>
        </Animated.View>

        <Animated.View
          pointerEvents={isSearchOpen ? 'auto' : 'none'}
          style={[
            styles.deckToolbarLayer,
            styles.deckSearchLayer,
            searchAnimatedStyle,
          ]}
        >
          <View style={styles.deckSearchField}>
            <Text
              accessibilityElementsHidden
              style={styles.deckSearchIcon}
            >
              ⌕
            </Text>

            <TextInput
              accessibilityLabel="Search installed decks"
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={() => onFocusChange(false)}
              onChangeText={onChangeSearch}
              onFocus={() => {
                onFocusChange(true);
                onFocusSearch?.();
              }}
              placeholder="Search decks"
              placeholderTextColor="#94A3B8"
              ref={inputRef}
              returnKeyType="search"
              style={styles.deckSearchInput}
              value={search}
            />

            <Pressable
              accessibilityLabel={search.length > 0 ? 'Clear search' : 'Close search'}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                if (search.trim().length > 0) {
                  onClearSearch();
                } else {
                  onCloseSearch();
                }
              }}
              style={({ pressed }) => [
                styles.deckSearchClear,
                pressed && styles.deckSearchClearPressed,
              ]}
            >
              <Text style={styles.deckSearchClearText}>×</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </>
  );
}

function MyLibraryControl({
  section,
  onChange,
  onLayout,
  indicatorStyle,
}: {
  section: 'decks' | 'videos';
  onChange: (section: 'decks' | 'videos') => void;
  onLayout: (width: number) => void;
  indicatorStyle: any;
}) {
  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event) => {
        onLayout(event.nativeEvent.layout.width);
      }}
      style={styles.myLibraryControl}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.myLibraryIndicator,
          indicatorStyle,
        ]}
      />

      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: section === 'decks' }}
        onPress={() => onChange('decks')}
        style={({ pressed }) => [
          styles.myLibraryTab,
          pressed && styles.pressed,
        ]}
      >
        <Text
          style={[
            styles.myLibraryTabText,
            section === 'decks' && styles.myLibraryTabTextActive,
          ]}
        >
          MY DECKS
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: section === 'videos' }}
        onPress={() => onChange('videos')}
        style={({ pressed }) => [
          styles.myLibraryTab,
          pressed && styles.pressed,
        ]}
      >
        <Text
          style={[
            styles.myLibraryTabText,
            section === 'videos' && styles.myLibraryTabTextActive,
          ]}
        >
          MY VIDEOS
        </Text>
      </Pressable>
    </View>
  );
}

function HomeModeControl({
  mode,
  onChange,
}: {
  mode: 'my-decks' | 'explore';
  onChange: (mode: 'my-decks' | 'explore') => void;
}) {
  const reduceMotion = useReducedMotion();
  const [indicatorWidth, setIndicatorWidth] = useState(0);
  const activePosition = useSharedValue(mode === 'explore' ? 1 : 0);

  useEffect(() => {
    activePosition.value = withTiming(mode === 'explore' ? 1 : 0, {
      duration: reduceMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [activePosition, mode, reduceMotion]);

  const indicatorStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateX: activePosition.value * (indicatorWidth + 6) },
      ],
    }),
    [indicatorWidth],
  );

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event) => {
        setIndicatorWidth((event.nativeEvent.layout.width - 16) / 2);
      }}
      style={[
        styles.homeModeControl,
        mode === 'explore' && styles.homeModeControlExplore,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.homeModeIndicator,
          { width: Math.max(0, indicatorWidth) },
          indicatorStyle,
        ]}
      />
      <HomeModeTab
        active={mode === 'my-decks'}
        label="PLAY"
        onPress={() => onChange('my-decks')}
      />
      <HomeModeTab
        active={mode === 'explore'}
        label="EXPLORE"
        onPress={() => onChange('explore')}
      />
    </View>
  );
}

function HomeModeTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.homeModeTab,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.homeModeTabText, active && styles.homeModeTabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  orientationGate: { flex: 1, backgroundColor: '#F6F6F6' },
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollView: { flex: 1, backgroundColor: '#F6F6F6' },
  scrollContent: { flexGrow: 1, backgroundColor: '#F6F6F6' },
  brandCard: {
    minHeight: 118,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginTop: -HEADER_OVERSCROLL_EXTENSION,
    paddingTop: HEADER_OVERSCROLL_EXTENSION + 8,
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
  homeModeControl: {
    position: 'relative',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
    padding: 5,
    borderRadius: 22,
    backgroundColor: '#DCE5EF',
  },
  homeModeControlExplore: { marginBottom: 14 },
  homeModeIndicator: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    left: 5,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.13)',
  },
  homeModeTab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    zIndex: 1,
  },
  homeModeTabText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  homeModeTabTextActive: { color: '#2563EB' },
  myDecksContent: { gap: 0 },
  myLibraryControl: {
    position: 'relative',
    flexDirection: 'row',
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
  },

  myLibraryTab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 1,
  },

  myLibraryTabText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },

  myLibraryTabTextActive: {
    color: '#2563EB',
  },

  myLibraryIndicator: {
    width: 64,
    height: 3,
    position: 'absolute',
    bottom: -StyleSheet.hairlineWidth,
    left: '25%',
    marginLeft: -32,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#459EFE',
  },
  myLibraryIndicatorVideos: {
    left: '62.5%',
  },
  deckLibraryContent: { gap: 14, marginTop: -10 },
  deckSortLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  deckToolbarContainer: {
    height: 48,
    marginTop: 10,
    position: 'relative',
    zIndex: 20,
  },

  deckToolbarLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  deckSearchLayer: {
    zIndex: 2,
  },

  deckSortArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  deckSortDropdownWrapper: {
    flex: 1,
    position: 'relative',
    zIndex: 30,
  },

  deckSortDropdown: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 15,
    paddingRight: 12,
    borderWidth: 1,
    borderColor: '#DCE5EF',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },

  deckSortDropdownOpen: {
    borderColor: '#459EFE',
  },

  deckSortDropdownPressed: {
    opacity: 0.78,
  },

  deckSortDropdownText: {
    flex: 1,
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '800',
  },

  deckSortChevron: {
    color: '#64748B',
    fontSize: 22,
    fontWeight: '700',
    transform: [{ rotate: '-90deg' }],
  },

  deckSortChevronOpen: {
    transform: [{ rotate: '90deg' }],
  },

  deckSortMenu: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DCE5EF',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',

    shadowColor: '#0F172A',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.13,
    shadowRadius: 14,

    elevation: 8,
    zIndex: 40,
  },

  deckSortMenuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
  },

  deckSortMenuItemSelected: {
    backgroundColor: '#EAF4FF',
  },

  deckSortMenuItemPressed: {
    opacity: 0.7,
  },

  sortBackdrop: {
    ...StyleSheet.absoluteFill,
  },

  sortFloatingLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 60,
  },

  sortFloatingButton: {
    position: 'absolute',
    borderColor: '#459EFE',
    zIndex: 2,
  },

  sortFloatingMenu: {
    right: undefined,
    zIndex: 3,
  },

  deckSortMenuItemText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },

  deckSortMenuItemTextSelected: {
    color: '#2563EB',
    fontWeight: '900',
  },

  deckSortCheck: {
    color: '#459EFE',
    fontSize: 15,
    fontWeight: '900',
  },

  deckSearchButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DCE5EF',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },

  deckSearchButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },

  deckSearchButtonIcon: {
    color: '#2563EB',
    fontSize: 25,
    lineHeight: 27,
    marginTop: -3,
  },

  deckSearchField: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#459EFE',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },

  deckSearchIcon: {
    color: '#459EFE',
    fontSize: 25,
    marginTop: -4,
  },

  deckSearchInput: {
    flex: 1,
    color: '#111827',
    fontSize: 15,
    paddingVertical: 12,
  },

  deckSearchClear: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#EAF4FF',
  },

  deckSearchClearPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },

  deckSearchClearText: {
    color: '#2563EB',
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: -2,
  },
  deckGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyDecks: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 12,
  },
  emptyVideos: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 12,
  },
  videoLibraryContent: { gap: 16 },
  pendingVideo: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  pendingVideoText: { color: '#64748B', fontSize: 14, fontWeight: '700' },
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
  videoPreparing: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
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
  footerLinks: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    marginTop: 'auto',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  footerLink: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  footerLinkPressed: { opacity: 0.55 },
  footerLinkText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.55 },
});

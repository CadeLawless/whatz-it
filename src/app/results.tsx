import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { PortraitTransition } from '@/components/orientation-transition';
import { RoundVideoPlayer, type VideoSaveNotice } from '@/components/round-video-player';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { useCatalog } from '@/catalog/catalog-provider';
import { useRound } from '@/game/round-context';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { colors, radius, spacing, typography } from '@/theme';
import {
  deleteRoundVideo,
  isRoundVideoReadyToSave,
  loadRoundVideos,
  prepareRoundVideoExport,
  saveRoundVideoToDevice,
  subscribeToRoundVideoLibrary,
  type RoundVideo,
} from '@/video/round-videos';
import { logVideoDiagnostic } from '@/video/video-diagnostics';

export default function ResultsScreen() {
  const router = useRouter();
  const { roundId } = useLocalSearchParams<{ roundId?: string }>();
  const isArchivedRound = typeof roundId === 'string' && roundId.length > 0;
  const { catalog } = useCatalog();
  const {
    currentVideo,
    isVideoFinalizing,
    round,
    roundDeck,
    configureRound,
    deleteCurrentVideo,
    resetRound,
    retryCurrentVideoExport,
  } = useRound();
  const [isStarting, setIsStarting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isSavingVideo, setIsSavingVideo] = useState(false);
  const [deletePromptVisible, setDeletePromptVisible] = useState(false);
  const [isDeletingRound, setIsDeletingRound] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [thumbnailReadyVideoId, setThumbnailReadyVideoId] = useState<string | null>(null);
  const [archivedVideoState, setArchivedVideoState] = useState<{
    roundId: string;
    video: RoundVideo | null;
  } | null>(null);
  const [saveNotice, setSaveNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const screenRef = useRef<View>(null);
  const isPortrait = usePortraitScreen();
  const { beginTransition, revealTransition } = useScreenshotTransition();
  const deck = roundDeck;
  const archiveLoaded =
    !isArchivedRound || archivedVideoState?.roundId === roundId;
  const archivedVideo =
    isArchivedRound && archivedVideoState?.roundId === roundId
      ? archivedVideoState.video
      : null;
  const displayedVideo = isArchivedRound ? archivedVideo : currentVideo;
  const archivedResults = archivedVideo?.resultSnapshot;
  const displayedResults = isArchivedRound ? archivedResults?.results ?? [] : round.results;
  const displayedDeckTitle = isArchivedRound
    ? archivedResults?.deckTitle ?? catalog.getDeckById(archivedVideo?.deckId)?.title ?? 'Round results'
    : deck?.title;
  const correctCount = displayedResults.filter((result) => result.outcome === 'correct').length;
  const passedCount = displayedResults.filter((result) => result.outcome === 'passed').length;
  const videoReady = displayedVideo ? isRoundVideoReadyToSave(displayedVideo) : false;
  const videoExportFailed = displayedVideo?.exportStatus === 'failed';
  const videoPlaybackBlocked = !!displayedVideo && !videoReady && !videoExportFailed;
  const archivedScreenReady =
    archiveLoaded &&
    (!archivedVideo ||
      !archivedResults ||
      (!videoPlaybackBlocked && thumbnailReadyVideoId === displayedVideo?.id));

  useEffect(() => {
    if (!isArchivedRound) return;

    let active = true;
    const updateArchivedVideo = (videos: RoundVideo[]) => {
      if (!active) return;
      const video = videos.find((item) => item.id === roundId) ?? null;
      setArchivedVideoState({
        roundId,
        video,
      });
      return video;
    };
    const unsubscribe = subscribeToRoundVideoLibrary(updateArchivedVideo);
    void loadRoundVideos().then((videos) => {
      const video = updateArchivedVideo(videos);
      if (!video || isRoundVideoReadyToSave(video) || video.exportStatus === 'failed') return;
      void prepareRoundVideoExport(video).then((prepared) => {
        if (active) setArchivedVideoState({ roundId, video: prepared });
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isArchivedRound, roundId]);

  useEffect(() => {
    logVideoDiagnostic('results screen video state changed', {
      currentVideoId: displayedVideo?.id ?? null,
      exportStatus: displayedVideo?.exportStatus ?? null,
      hasAudioUri: !!displayedVideo?.audioUri,
      hasExportUri: !!displayedVideo?.exportUri,
      isVideoFinalizing: isArchivedRound ? false : isVideoFinalizing,
      videoPlaybackBlocked,
      videoReady,
    });
  }, [
    displayedVideo?.audioUri,
    displayedVideo?.exportStatus,
    displayedVideo?.exportUri,
    displayedVideo?.id,
    isArchivedRound,
    isVideoFinalizing,
    videoPlaybackBlocked,
    videoReady,
  ]);

  const returnHome = () => {
    if (isArchivedRound) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
      return;
    }
    if (router.canDismiss()) {
      router.dismissAll();
    } else {
      router.replace('/');
    }
  };

  useEffect(() => {
    if (isPortrait && (!isArchivedRound || archivedScreenReady)) {
      void revealTransition('results');
    }
  }, [archivedScreenReady, isArchivedRound, isPortrait, revealTransition]);

  if (!isPortrait) {
    return <PortraitTransition style={styles.orientationGate} />;
  }

  if (isArchivedRound && !archiveLoaded) {
    return (
      <SafeAreaView style={styles.empty}>
        <ActivityIndicator color={colors.play} size="large" />
        <Text style={styles.emptyTitle}>Loading round results…</Text>
      </SafeAreaView>
    );
  }

  if (
    (isArchivedRound && (!archivedVideo || !archivedResults)) ||
    (!isArchivedRound && (!deck || round.status !== 'finished'))
  ) {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyTitle}>
          {isArchivedRound ? 'Results are unavailable for this recording' : 'No finished round yet'}
        </Text>
        <Pressable onPress={returnHome} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>
            {isArchivedRound ? 'BACK TO MY ROUNDS' : 'PICK A DECK'}
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const handleReplay = async () => {
    if (isStarting) return;

    if (isArchivedRound) {
      if (!catalog.getDeckById(archivedResults!.deckId)) {
        setSaveNotice({
          title: 'Deck unavailable',
          message: 'This deck is not currently available to play again.',
        });
        return;
      }

      // Keep this results screen on the stack. The setup screen's normal Back
      // action then returns the player to this exact saved round.
      router.push({
        pathname: '/deck/[deckId]',
        params: {
          deckId: archivedResults!.deckId,
          durationSeconds: String(archivedResults!.durationSeconds),
          returnToRoundId: roundId,
          transition: 'apple-slide',
        },
      });
      return;
    }

    setIsStarting(true);
    // First detach the native TextureVideoView while its shared player is
    // still alive. The following state change can then release the old player
    // without racing the Android view-property update.
    await waitForNextPaint();
    const replayDeckId = deck!.id;
    const replayDuration = round.durationSeconds;
    if (!(await configureRound(replayDeckId, replayDuration))) {
      setIsStarting(false);
      setSaveNotice({
        title: 'Deck unavailable',
        message: 'This deck is not currently available to play again.',
      });
      return;
    }
    router.replace('/ready' as Href);
  };

  const handleHome = async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    try {
      const uri = await captureRef(screenRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      await beginTransition({ destination: 'home', direction: 'right', uri });
    } catch {
      // If capture is unavailable, navigation still completes normally.
    }
    if (!isArchivedRound) resetRound();
    returnHome();
  };

  const handleSaveVideo = async (): Promise<VideoSaveNotice> => {
    if (!displayedVideo || !videoReady || isSavingVideo) {
      return { title: 'Video not ready', message: 'Please wait for this video to finish exporting.' };
    }
    setIsSavingVideo(true);
    try {
      await saveRoundVideoToDevice(displayedVideo);
      return {
        title: 'Video saved',
        message: 'The round video and its sound are now in your device library.',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Please try again.';
      return { title: 'Could not save video', message: detail };
    } finally {
      setIsSavingVideo(false);
    }
  };

  const handlePortraitSave = async () => {
    setSaveNotice(await handleSaveVideo());
  };

  const handleRetryExport = async () => {
    const preparedVideo = isArchivedRound && displayedVideo
      ? await prepareRoundVideoExport(displayedVideo)
      : await retryCurrentVideoExport();
    if (isArchivedRound && preparedVideo) {
      setArchivedVideoState({ roundId, video: preparedVideo });
    }
    if (preparedVideo?.exportStatus === 'failed') {
      setSaveNotice({
        title: 'Export failed',
        message: 'The video and its audio are safe inside the WHATZ IT? app. Please send the [RoundVideo] terminal logs.',
      });
    }
  };

  const requestDeleteRound = () => {
    if (!displayedVideo) return;
    setDeleteError(null);
    setDeletePromptVisible(true);
  };

  const cancelDeleteRound = () => {
    if (isDeletingRound) return;
    setDeletePromptVisible(false);
    setDeleteError(null);
  };

  const confirmDeleteRound = async () => {
    if (!displayedVideo || isDeletingRound) return;
    setIsDeletingRound(true);
    setDeleteError(null);
    let transitionUri: string | null = null;
    try {
      try {
        transitionUri = await captureRef(screenRef, {
          format: 'jpg',
          quality: 0.95,
          result: 'tmpfile',
        });
      } catch {
        // Deletion and navigation still complete if capture is unavailable.
      }

      if (isArchivedRound) await deleteRoundVideo(displayedVideo.id);
      else await deleteCurrentVideo();

      if (transitionUri) {
        await beginTransition({
          destination: 'home',
          direction: 'right',
          uri: transitionUri,
        });
      }
      setDeletePromptVisible(false);
      if (!isArchivedRound) resetRound();
      returnHome();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsDeletingRound(false);
    }
  };

  return (
    <SafeAreaView
      ref={screenRef}
      collapsable={false}
      style={styles.safeArea}
      edges={['top', 'bottom']}
    >
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel={isArchivedRound ? 'Back to My Rounds' : 'Back to Decks'}
          accessibilityRole="button"
          disabled={isLeaving || isDeletingRound}
          onPress={() => void handleHome()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <SymbolView
            accessibilityElementsHidden
            name={{
              android: 'arrow_back_ios_new',
              ios: 'chevron.left',
              web: 'arrow_back_ios_new',
            }}
            size={18}
            style={styles.backIcon}
            tintColor="#000000"
          />
          <Text style={styles.backButtonText}>
            {isArchivedRound ? 'Back to My Rounds' : 'Back to Decks'}
          </Text>
        </Pressable>
        {displayedVideo ? (
          <Pressable
            accessibilityLabel="Delete saved round"
            accessibilityRole="button"
            disabled={isLeaving || isDeletingRound}
            onPress={requestDeleteRound}
            style={({ pressed }) => [styles.topDeleteButton, pressed && styles.pressed]}
          >
            <SymbolView
              accessibilityElementsHidden
              name={{ android: 'delete', ios: 'trash', web: 'delete' }}
              size={24}
              style={styles.topDeleteIcon}
              tintColor="#DC2626"
              weight="bold"
            />
          </Pressable>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
      </View>
      <FlatList
        data={displayedResults}
        style={styles.list}
        keyExtractor={(item, index) => `${item.cardId}-${index}`}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Text style={styles.eyebrow}>ROUND COMPLETE</Text>
            <Text style={styles.title}>Nice guessing!</Text>
            <Text style={styles.deckName}>{displayedDeckTitle}</Text>
            {((!isArchivedRound && isVideoFinalizing) || displayedVideo) && (
              <View style={styles.videoSection}>
                {displayedVideo && !videoPlaybackBlocked ? (
                  <>
                    <RoundVideoPlayer
                      isSaving={isSavingVideo}
                      key={displayedVideo.id}
                      saveDisabled={!videoReady}
                      onSave={handleSaveVideo}
                      onThumbnailReady={() => setThumbnailReadyVideoId(displayedVideo.id)}
                      staticThumbnail
                      suspending={isStarting}
                      video={displayedVideo}
                      style={styles.video}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={isSavingVideo || (!videoReady && !videoExportFailed)}
                      onPress={() =>
                        void (videoExportFailed ? handleRetryExport() : handlePortraitSave())
                      }
                      style={({ pressed }) => [
                        styles.saveVideoButton,
                        !videoReady && !videoExportFailed && styles.disabled,
                        pressed && (videoReady || videoExportFailed) && styles.pressed,
                      ]}
                    >
                      <Text style={styles.saveVideoText}>
                        {videoExportFailed
                          ? 'RETRY EXPORT'
                          : !videoReady
                            ? 'PREPARING VIDEO…'
                            : isSavingVideo
                              ? 'SAVING…'
                              : 'SAVE VIDEO'}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <View
                    accessibilityLabel="Preparing your round video for playback"
                    accessibilityRole="progressbar"
                    style={styles.videoPlaceholder}
                  >
                    <ActivityIndicator color={colors.play} size="large" />
                    <Text style={styles.videoPlaceholderTitle}>Preparing your video…</Text>
                    <Text style={styles.videoPlaceholderBody}>
                      Your results are ready. Playback will appear as soon as processing finishes.
                    </Text>
                  </View>
                )}
              </View>
            )}
            <View style={styles.scoreRow}>
              <View style={[styles.scoreCard, { backgroundColor: colors.correct }]}>
                <Text style={styles.score}>{correctCount}</Text>
                <Text style={styles.scoreLabel}>CORRECT</Text>
              </View>
              <View style={[styles.scoreCard, { backgroundColor: colors.pass }]}>
                <Text style={styles.score}>{passedCount}</Text>
                <Text style={styles.scoreLabel}>PASSED</Text>
              </View>
            </View>
            <Text style={styles.listLabel}>YOUR CARDS</Text>
          </View>
        }
        renderItem={({ item }) => {
          const card = isArchivedRound
            ? archivedResults!.results.find(
                (candidate) =>
                  candidate.cardId === item.cardId &&
                  candidate.answeredAt === item.answeredAt,
              )
            : deck!.cards.find((candidate) => candidate.id === item.cardId);
          const outcomeColor =
            item.outcome === 'correct'
              ? colors.correct
              : item.outcome === 'passed'
                ? colors.pass
                : colors.border;
          const outcomeIcon = item.outcome === 'correct' ? '✓' : item.outcome === 'passed' ? '×' : '—';
          const outcomeLabel = item.outcome === 'neutral' ? 'UNANSWERED' : item.outcome.toUpperCase();
          return (
            <View style={styles.resultRow}>
              <View style={[styles.outcomeDot, { backgroundColor: outcomeColor }]}>
                <Text style={styles.outcomeIcon}>{outcomeIcon}</Text>
              </View>
              <View style={styles.resultCopy}>
                <Text style={styles.resultText}>{card?.text ?? 'Unknown card'}</Text>
                {card?.byline && <Text style={styles.resultByline}>by {card.byline}</Text>}
              </View>
              <Text style={styles.outcomeText}>{outcomeLabel}</Text>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<Text style={styles.noCards}>Time ran out before a card was answered.</Text>}
      />
      <View style={styles.actions}>
        <Pressable
          disabled={isStarting || isLeaving}
          onPress={handleReplay}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>PLAY AGAIN</Text>
        </Pressable>
      </View>
      <ConfirmationPrompt
        busy={isDeletingRound}
        busyLabel="DELETING..."
        confirmLabel="DELETE ROUND"
        destructive
        message={
          deleteError
            ? `The round could not be deleted. ${deleteError}`
            : 'This permanently deletes the round video, score, and card-by-card details from WHATZ IT? on this device.'
        }
        onCancel={cancelDeleteRound}
        onConfirm={() => void confirmDeleteRound()}
        title={deleteError ? 'Could not delete round' : 'Delete saved round?'}
        visible={deletePromptVisible}
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

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  topBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  backIcon: { width: 18, height: 18 },
  backButtonText: {
    color: '#000000',
    fontSize: 17,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
  },
  topDeleteButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topDeleteIcon: { width: 24, height: 24 },
  topBarSpacer: { width: 48, height: 48 },
  orientationGate: { flex: 1 },
  list: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.lg },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  emptyTitle: { ...typography.title, color: colors.ink, textAlign: 'center' },
  eyebrow: { color: colors.muted, fontSize: 12, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.8 },
  title: { ...typography.hero, color: colors.ink, marginTop: spacing.sm },
  deckName: { color: colors.muted, fontSize: 16, fontFamily: 'Inter_700Bold', fontWeight: '700', marginTop: spacing.sm },
  videoSection: { alignItems: 'center', marginTop: spacing.lg },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg },
  videoPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  videoPlaceholderTitle: { color: colors.ink, fontSize: 17, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  videoPlaceholderBody: {
    maxWidth: 320,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  saveVideoButton: {
    minHeight: 42,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.play,
  },
  saveVideoText: { color: colors.white, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.1 },
  scoreRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  scoreCard: { flex: 1, borderRadius: radius.xl, padding: spacing.lg },
  score: { color: colors.ink, fontSize: 52, lineHeight: 58, fontFamily: 'Inter_900Black', fontWeight: '900' },
  scoreLabel: { color: colors.ink, fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.3 },
  listLabel: { color: colors.muted, fontSize: 12, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.7, marginTop: spacing.xl, marginBottom: spacing.sm },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  outcomeDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  outcomeIcon: { color: colors.ink, fontSize: 17, fontFamily: 'Inter_900Black', fontWeight: '900' },
  resultCopy: { flex: 1, gap: 2 },
  resultText: { color: colors.ink, fontSize: 17, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  resultByline: { color: colors.muted, fontSize: 13, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  outcomeText: { color: colors.muted, fontSize: 9, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1 },
  separator: { height: spacing.sm },
  noCards: { ...typography.body, color: colors.muted, textAlign: 'center', padding: spacing.xl },
  actions: {
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    minHeight: 58,
    borderRadius: radius.lg,
    backgroundColor: colors.play,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  primaryButtonText: { color: colors.white, fontSize: 14, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 1.2 },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.88 },
  disabled: { opacity: 0.55 },
});

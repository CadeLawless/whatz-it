import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { PortraitTransition } from '@/components/orientation-transition';
import { RoundVideoPlayer, type VideoSaveNotice } from '@/components/round-video-player';
import { useScreenshotTransition } from '@/components/screenshot-transition-provider';
import { getDeckById } from '@/data/decks';
import { useRound } from '@/game/round-context';
import { usePortraitScreen } from '@/hooks/use-portrait-screen';
import { colors, radius, spacing, typography } from '@/theme';
import { isRoundVideoReadyToSave, saveRoundVideoToDevice } from '@/video/round-videos';
import { logVideoDiagnostic } from '@/video/video-diagnostics';

export default function ResultsScreen() {
  const router = useRouter();
  const {
    currentVideo,
    isVideoFinalizing,
    round,
    configureRound,
    deleteCurrentVideo,
    resetRound,
    retryCurrentVideoExport,
  } = useRound();
  const [isStarting, setIsStarting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isSavingVideo, setIsSavingVideo] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const screenRef = useRef<View>(null);
  const isPortrait = usePortraitScreen();
  const { beginTransition, revealTransition } = useScreenshotTransition();
  const deck = getDeckById(round.deckId ?? undefined);
  const correctCount = round.results.filter((result) => result.outcome === 'correct').length;
  const passedCount = round.results.filter((result) => result.outcome === 'passed').length;
  const videoReady = currentVideo ? isRoundVideoReadyToSave(currentVideo) : false;
  const videoExportFailed = currentVideo?.exportStatus === 'failed';

  useEffect(() => {
    logVideoDiagnostic('results screen video state changed', {
      currentVideoId: currentVideo?.id ?? null,
      exportStatus: currentVideo?.exportStatus ?? null,
      hasAudioUri: !!currentVideo?.audioUri,
      hasExportUri: !!currentVideo?.exportUri,
      isVideoFinalizing,
      videoReady,
    });
  }, [
    currentVideo?.audioUri,
    currentVideo?.exportStatus,
    currentVideo?.exportUri,
    currentVideo?.id,
    isVideoFinalizing,
    videoReady,
  ]);

  const returnHome = () => {
    if (router.canDismiss()) {
      router.dismissAll();
    } else {
      router.replace('/');
    }
  };

  useEffect(() => {
    if (isPortrait) revealTransition('results');
  }, [isPortrait, revealTransition]);

  if (!isPortrait) {
    return <PortraitTransition style={styles.orientationGate} />;
  }

  if (!deck || round.status !== 'finished') {
    return (
      <SafeAreaView style={styles.empty}>
        <Text style={styles.emptyTitle}>No finished round yet</Text>
        <Pressable onPress={returnHome} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>PICK A DECK</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const handleReplay = async () => {
    if (isStarting) return;
    setIsStarting(true);
    if (!(await configureRound(deck.id, round.durationSeconds))) {
      setIsStarting(false);
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
    resetRound();
    returnHome();
  };

  const handleSaveVideo = async (): Promise<VideoSaveNotice> => {
    if (!currentVideo || !videoReady || isSavingVideo) {
      return { title: 'Video not ready', message: 'Please wait for this video to finish exporting.' };
    }
    setIsSavingVideo(true);
    try {
      await saveRoundVideoToDevice(currentVideo);
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
    const preparedVideo = await retryCurrentVideoExport();
    if (preparedVideo?.exportStatus === 'failed') {
      setSaveNotice({
        title: 'Export failed',
        message: 'The video and its audio are safe in WHATZ IT. Please send the [RoundVideo] terminal logs.',
      });
    }
  };

  return (
    <SafeAreaView
      ref={screenRef}
      collapsable={false}
      style={styles.safeArea}
      edges={['top', 'bottom']}
    >
      <FlatList
        data={round.results}
        style={styles.list}
        keyExtractor={(item, index) => `${item.cardId}-${index}`}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Text style={styles.eyebrow}>ROUND COMPLETE</Text>
            <Text style={styles.title}>Nice guessing!</Text>
            <Text style={styles.deckName}>{deck.title}</Text>
            {(isVideoFinalizing || currentVideo) && (
              <View style={styles.videoSection}>
                {currentVideo ? (
                  <>
                    <RoundVideoPlayer
                      isSaving={isSavingVideo}
                      key={currentVideo.id}
                      saveDisabled={!videoReady}
                      onDelete={() => deleteCurrentVideo()}
                      onSave={handleSaveVideo}
                      video={currentVideo}
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
                    accessibilityLabel="Preparing your round video"
                    accessibilityRole="progressbar"
                    style={styles.videoPlaceholder}
                  >
                    <ActivityIndicator color={colors.play} size="large" />
                    <Text style={styles.videoPlaceholderTitle}>Preparing your video…</Text>
                    <Text style={styles.videoPlaceholderBody}>
                      Your results are ready. The video will appear here automatically.
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
          const card = deck.cards.find((candidate) => candidate.id === item.cardId);
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
        <Pressable
          disabled={isLeaving}
          onPress={handleHome}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>BACK TO DECKS</Text>
        </Pressable>
      </View>
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
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
  eyebrow: { color: colors.muted, fontSize: 12, fontWeight: '900', letterSpacing: 1.8 },
  title: { ...typography.hero, color: colors.ink, marginTop: spacing.sm },
  deckName: { color: colors.muted, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
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
  videoPlaceholderTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
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
  saveVideoText: { color: colors.white, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  scoreRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  scoreCard: { flex: 1, borderRadius: radius.xl, padding: spacing.lg },
  score: { color: colors.ink, fontSize: 52, lineHeight: 58, fontWeight: '900' },
  scoreLabel: { color: colors.ink, fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  listLabel: { color: colors.muted, fontSize: 12, fontWeight: '900', letterSpacing: 1.7, marginTop: spacing.xl, marginBottom: spacing.sm },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  outcomeDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  outcomeIcon: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  resultCopy: { flex: 1, gap: 2 },
  resultText: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  resultByline: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  outcomeText: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  separator: { height: spacing.sm },
  noCards: { ...typography.body, color: colors.muted, textAlign: 'center', padding: spacing.xl },
  actions: {
    flexShrink: 0,
    gap: spacing.sm,
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
  primaryButtonText: { color: colors.white, fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  secondaryButton: {
    minHeight: 54,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.ink, fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.88 },
  disabled: { opacity: 0.55 },
});

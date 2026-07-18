import { useEventListener } from 'expo';
import { type AudioPlayer, setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import {
  useVideoPlayer,
  type VideoPlayer,
  type VideoThumbnail,
  VideoView,
} from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type GestureResponderEvent,
  Modal,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { LandscapeViewport } from '@/components/landscape-viewport';
import { formatRoundClock } from '@/game/round-duration';
import { colors, radius, spacing } from '@/theme';
import type { RoundVideo, RoundVideoEvent } from '@/video/round-videos';
import { logVideoDiagnostic } from '@/video/video-diagnostics';

export type VideoSaveNotice = {
  title: string;
  message: string;
};

type RoundVideoPlayerProps = {
  video: RoundVideo;
  style?: StyleProp<ViewStyle>;
  isSaving?: boolean;
  saveDisabled?: boolean;
  staticThumbnail?: boolean;
  onSave?: (video: RoundVideo) => Promise<VideoSaveNotice>;
  onDelete?: (video: RoundVideo) => Promise<void>;
};

type PendingScrubCompletion = {
  session: number;
  shouldResume: boolean;
  targetTime: number;
};

const SCRUB_PREVIEW_INTERVAL_MS = 90;
const SCRUB_SETTLE_FALLBACK_MS = 220;
const SCRUB_SETTLE_TOLERANCE_SECONDS = 0.15;
const SCRUB_TAP_MOVEMENT_THRESHOLD = 4;

export function RoundVideoPlayer({
  video,
  style,
  isSaving = false,
  saveDisabled = false,
  staticThumbnail = false,
  onSave,
  onDelete,
}: RoundVideoPlayerProps) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [saveNotice, setSaveNotice] = useState<VideoSaveNotice | null>(null);
  const [deletePromptVisible, setDeletePromptVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(!staticThumbnail);
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);
  const [duration, setDuration] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9 });
  // Keep one source for this player's entire mounted lifetime. Replacing the raw
  // recording with its finished export would otherwise restart visible playback.
  const [playbackUri] = useState(() => video.uri);
  const expandedRef = useRef(false);
  const previousVideoTime = useRef(0);
  const thumbnailTimeRef = useRef(0);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrubbingRef = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);
  const scrubStartAxisRef = useRef(0);
  const scrubStartTimeRef = useRef(0);
  const scrubLatestTimeRef = useRef(0);
  const scrubMovementRef = useRef(0);
  const scrubLastPreviewAtRef = useRef(0);
  const scrubPreviewCountRef = useRef(0);
  const scrubPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrubCompletionRef = useRef<PendingScrubCompletion | null>(null);
  const scrubSessionRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const separateAudioUri = video.audioUri;
  const separateAudio = useAudioPlayer(separateAudioUri ?? null);
  const player = useVideoPlayer(playbackUri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.timeUpdateEventInterval = 0.1;
    if (!staticThumbnail) instance.play();
  });

  useEventListener(player, 'timeUpdate', ({ currentTime: nextTime }) => {
    if (isScrubbingRef.current) return;
    const pendingCompletion = pendingScrubCompletionRef.current;
    if (pendingCompletion) {
      if (
        Math.abs(nextTime - pendingCompletion.targetTime) >
        SCRUB_SETTLE_TOLERANCE_SECONDS
      ) {
        return;
      }
      if (scrubCompletionTimerRef.current !== null) {
        clearTimeout(scrubCompletionTimerRef.current);
        scrubCompletionTimerRef.current = null;
      }
      pendingScrubCompletionRef.current = null;
      setCurrentTime(pendingCompletion.targetTime);
      previousVideoTime.current = pendingCompletion.targetTime;
      logVideoDiagnostic('scrub settled', {
        actualTime: nextTime,
        resumed: pendingCompletion.shouldResume,
        targetTime: pendingCompletion.targetTime,
        via: 'time-update',
      });
      if (pendingCompletion.shouldResume && expandedRef.current) player.play();
      return;
    }
    setCurrentTime(nextTime);
    if (!expandedRef.current || !separateAudioUri) return;
    const looped = nextTime + 0.5 < previousVideoTime.current;
    previousVideoTime.current = nextTime;
    const drift = Math.abs(separateAudio.currentTime - nextTime);
    if (looped || drift > 0.35) {
      void separateAudio
        .seekTo(nextTime)
        .then(() => {
          if (expandedRef.current && looped) separateAudio.play();
        })
        .catch(() => undefined);
    }
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    setIsPlaying(isPlaying);
    if (!expandedRef.current || !separateAudioUri) return;
    if (isPlaying) {
      void separateAudio.seekTo(player.currentTime).then(() => separateAudio.play()).catch(() => undefined);
    } else {
      pauseAudioPlayer(separateAudio);
    }
  });

  useEventListener(player, 'sourceLoad', ({
    availableAudioTracks,
    availableVideoTracks,
    duration,
    videoSource,
  }) => {
    setDuration(duration);
    if (staticThumbnail) {
      const thumbnailTime = duration * 0.25;
      thumbnailTimeRef.current = thumbnailTime;
      player.pause();
      seekVideoPlayer(player, thumbnailTime);
      setCurrentTime(thumbnailTime);
      previousVideoTime.current = thumbnailTime;
      if (Platform.OS !== 'web') {
        void player
          .generateThumbnailsAsync(thumbnailTime, { maxWidth: 720 })
          .then(([generatedThumbnail]) => setThumbnail(generatedThumbnail ?? null))
          .catch(() => setThumbnail(null));
      }
    }
    const videoTrack = availableVideoTracks[0];
    if (videoTrack?.size.width > 0 && videoTrack.size.height > 0) {
      setVideoSize(videoTrack.size);
    }
    logVideoDiagnostic('player source loaded', {
      audioTrackCount: availableAudioTracks.length,
      audioTracks: availableAudioTracks,
      availableVideoTracks,
      exportUri: video.exportUri,
      playbackIncludesOverlays: video.playbackIncludesOverlays ?? false,
      playbackUri,
      separateAudioUri,
      videoSource,
    });
  });

  const event = useMemo(
    () => getEventAtTime(video.events ?? [], currentTime * 1000),
    [currentTime, video.events],
  );
  const playbackProgress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const videoFrame = useMemo(
    () => getContainedVideoFrame(containerSize, videoSize),
    [containerSize, videoSize],
  );
  const leftChromeInset = Math.max(
    spacing.md,
    insets.top + spacing.sm - videoFrame.x,
  );
  const rightChromeInset = Math.max(
    spacing.md,
    insets.bottom + spacing.sm - videoFrame.x,
  );

  const clearControlsTimer = () => {
    if (controlsTimer.current === null) return;
    clearTimeout(controlsTimer.current);
    controlsTimer.current = null;
  };

  const clearScrubPreviewTimer = () => {
    if (scrubPreviewTimerRef.current === null) return;
    clearTimeout(scrubPreviewTimerRef.current);
    scrubPreviewTimerRef.current = null;
  };

  const clearScrubCompletion = () => {
    if (scrubCompletionTimerRef.current !== null) {
      clearTimeout(scrubCompletionTimerRef.current);
      scrubCompletionTimerRef.current = null;
    }
    pendingScrubCompletionRef.current = null;
  };

  const scheduleControlsHide = () => {
    clearControlsTimer();
    controlsTimer.current = setTimeout(() => {
      setControlsVisible(false);
      controlsTimer.current = null;
    }, 3000);
  };

  const showControls = () => {
    setControlsVisible(true);
    scheduleControlsHide();
  };

  const toggleControls = () => {
    if (controlsVisible) {
      clearControlsTimer();
      setControlsVisible(false);
    } else {
      showControls();
    }
  };

  useEffect(
    () => () => {
      if (controlsTimer.current !== null) clearTimeout(controlsTimer.current);
      if (scrubPreviewTimerRef.current !== null) clearTimeout(scrubPreviewTimerRef.current);
      if (scrubCompletionTimerRef.current !== null) {
        clearTimeout(scrubCompletionTimerRef.current);
      }
    },
    [],
  );

  const openExpanded = async () => {
    expandedRef.current = true;
    const startTime = staticThumbnail ? 0 : player.currentTime;
    if (staticThumbnail) {
      player.pause();
      seekVideoPlayer(player, 0);
      setCurrentTime(0);
    }
    previousVideoTime.current = startTime;
    setExpanded(true);
    showControls();
    await setPlaybackAudioMode().catch(() => undefined);
    if (separateAudioUri) {
      setPlayerMuted(player, true);
      await separateAudio.seekTo(startTime).catch(() => undefined);
      separateAudio.play();
      if (staticThumbnail) player.replay();
      else player.play();
    } else {
      enablePlayerAudio(player);
      if (staticThumbnail) player.replay();
    }
  };

  const closeExpanded = () => {
    clearControlsTimer();
    clearScrubPreviewTimer();
    clearScrubCompletion();
    isScrubbingRef.current = false;
    setPlayerScrubbingMode(player, false);
    setPlayerSeekTolerance(player, 0);
    expandedRef.current = false;
    pauseAudioPlayer(separateAudio);
    setPlayerMuted(player, true);
    if (staticThumbnail) {
      player.pause();
      seekVideoPlayer(player, thumbnailTimeRef.current);
      setCurrentTime(thumbnailTimeRef.current);
      previousVideoTime.current = thumbnailTimeRef.current;
    } else {
      player.play();
    }
    setExpanded(false);
    restoreAppAudioMode();
  };

  const requestDelete = () => {
    if (!onDelete) return;
    setDeleteError(null);
    setDeletePromptVisible(true);
  };

  const cancelDelete = () => {
    if (isDeleting) return;
    setDeletePromptVisible(false);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!onDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(video);
      setDeletePromptVisible(false);
      closeExpanded();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const saveFromPlayer = async () => {
    if (!onSave || isSaving || saveDisabled) return;
    const notice = await onSave(video);
    setSaveNotice(notice);
  };

  const togglePlayback = () => {
    showControls();
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  const seekTo = (time: number) => {
    showControls();
    const nextTime = Math.max(0, Math.min(duration, time));
    seekVideoPlayer(player, nextTime);
    setCurrentTime(nextTime);
    if (separateAudioUri) {
      void separateAudio.seekTo(nextTime).catch(() => undefined);
    }
  };

  const getTappedProgressTime = (event: GestureResponderEvent) => {
    if (duration <= 0 || progressWidth <= 0) return null;
    const progress = Math.min(1, Math.max(0, event.nativeEvent.locationX / progressWidth));
    return progress * duration;
  };

  const queueScrubPreview = (nextTime: number) => {
    scrubLatestTimeRef.current = nextTime;
    const elapsed = Date.now() - scrubLastPreviewAtRef.current;
    if (elapsed >= SCRUB_PREVIEW_INTERVAL_MS) {
      clearScrubPreviewTimer();
      scrubLastPreviewAtRef.current = Date.now();
      scrubPreviewCountRef.current += 1;
      seekVideoPlayer(player, nextTime);
      return;
    }
    if (scrubPreviewTimerRef.current !== null) return;
    scrubPreviewTimerRef.current = setTimeout(() => {
      scrubPreviewTimerRef.current = null;
      if (!isScrubbingRef.current) return;
      scrubLastPreviewAtRef.current = Date.now();
      scrubPreviewCountRef.current += 1;
      seekVideoPlayer(player, scrubLatestTimeRef.current);
    }, SCRUB_PREVIEW_INTERVAL_MS - elapsed);
  };

  const updateScrubTarget = (nextTime: number, preview: boolean) => {
    scrubLatestTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    previousVideoTime.current = nextTime;
    if (preview) queueScrubPreview(nextTime);
  };

  const getDraggedProgressTime = (event: GestureResponderEvent) => {
    if (duration <= 0 || progressWidth <= 0) return null;
    const movement = getScrubAxisPosition(event) - scrubStartAxisRef.current;
    scrubMovementRef.current = Math.max(scrubMovementRef.current, Math.abs(movement));
    return clampTime(
      scrubStartTimeRef.current + (movement / progressWidth) * duration,
      duration,
    );
  };

  const moveScrubbing = (event: GestureResponderEvent) => {
    if (!isScrubbingRef.current) return;
    const nextTime = getDraggedProgressTime(event);
    if (nextTime !== null) updateScrubTarget(nextTime, true);
  };

  const startScrubbing = (event: GestureResponderEvent) => {
    if (duration <= 0 || progressWidth <= 0) return;
    clearControlsTimer();
    clearScrubPreviewTimer();
    const pendingResume = pendingScrubCompletionRef.current?.shouldResume;
    clearScrubCompletion();
    setControlsVisible(true);
    wasPlayingBeforeScrubRef.current = pendingResume ?? player.playing;
    scrubStartAxisRef.current = getScrubAxisPosition(event);
    scrubStartTimeRef.current = clampTime(player.currentTime, duration);
    scrubLatestTimeRef.current = scrubStartTimeRef.current;
    scrubMovementRef.current = 0;
    scrubLastPreviewAtRef.current = 0;
    scrubPreviewCountRef.current = 0;
    isScrubbingRef.current = true;
    player.pause();
    setPlayerScrubbingMode(player, true);
    setPlayerSeekTolerance(player, 0.1);
    pauseAudioPlayer(separateAudio);
    setCurrentTime(scrubStartTimeRef.current);
    logVideoDiagnostic('scrub started', {
      axis: scrubStartAxisRef.current,
      startTime: scrubStartTimeRef.current,
      wasPlaying: wasPlayingBeforeScrubRef.current,
    });
  };

  const finishScrubbing = (event: GestureResponderEvent) => {
    if (!isScrubbingRef.current) return;
    const draggedTime = getDraggedProgressTime(event);
    const tappedTime = getTappedProgressTime(event);
    const nextTime =
      scrubMovementRef.current < SCRUB_TAP_MOVEMENT_THRESHOLD
        ? (tappedTime ?? scrubLatestTimeRef.current)
        : (draggedTime ?? scrubLatestTimeRef.current);
    const shouldResume = wasPlayingBeforeScrubRef.current;
    clearScrubPreviewTimer();
    isScrubbingRef.current = false;
    setPlayerScrubbingMode(player, false);
    setPlayerSeekTolerance(player, 0);
    updateScrubTarget(nextTime, false);

    const session = scrubSessionRef.current + 1;
    scrubSessionRef.current = session;
    pendingScrubCompletionRef.current = { session, shouldResume, targetTime: nextTime };
    seekVideoPlayer(player, nextTime);
    logVideoDiagnostic('scrub finished', {
      movement: scrubMovementRef.current,
      previewSeekCount: scrubPreviewCountRef.current,
      shouldResume,
      targetTime: nextTime,
      usedTapPosition: scrubMovementRef.current < SCRUB_TAP_MOVEMENT_THRESHOLD,
    });

    if (separateAudioUri) {
      void separateAudio.seekTo(nextTime).catch(() => undefined);
    }
    scrubCompletionTimerRef.current = setTimeout(() => {
      const pendingCompletion = pendingScrubCompletionRef.current;
      if (!pendingCompletion || pendingCompletion.session !== session) return;
      scrubCompletionTimerRef.current = null;
      pendingScrubCompletionRef.current = null;
      seekVideoPlayer(player, pendingCompletion.targetTime);
      setCurrentTime(pendingCompletion.targetTime);
      previousVideoTime.current = pendingCompletion.targetTime;
      logVideoDiagnostic('scrub settled', {
        resumed: pendingCompletion.shouldResume,
        targetTime: pendingCompletion.targetTime,
        via: 'fallback',
      });
      if (pendingCompletion.shouldResume && expandedRef.current) player.play();
    }, SCRUB_SETTLE_FALLBACK_MS);
    scheduleControlsHide();
  };

  return (
    <>
      {!expanded && (
        <View style={[styles.frame, style]}>
          {thumbnail ? (
            <Image contentFit="cover" source={thumbnail} style={StyleSheet.absoluteFill} />
          ) : (
            <VideoView
              contentFit="cover"
              nativeControls={false}
              player={player}
              style={StyleSheet.absoluteFill}
              surfaceType="textureView"
            />
          )}
          {!video.playbackIncludesOverlays && (
            <PlaybackOverlay currentTimeMs={currentTime * 1000} event={event} compact />
          )}
          {staticThumbnail && (
            <View pointerEvents="none" style={styles.thumbnailPlayBadge}>
              <Text style={styles.thumbnailPlayIcon}>{'\u25B6'}</Text>
            </View>
          )}
          <Pressable
            accessibilityHint="Opens a larger player with sound"
            accessibilityLabel="Watch round video"
            accessibilityRole="button"
            onPress={() => void openExpanded()}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}

      <Modal
        animationType="fade"
        onRequestClose={() =>
          deletePromptVisible
            ? cancelDelete()
            : saveNotice
              ? setSaveNotice(null)
              : closeExpanded()
        }
        statusBarTranslucent
        supportedOrientations={['portrait']}
        visible={expanded}
      >
        <LandscapeViewport>
          <View style={styles.modalRoot}>
            <StatusBar hidden animated={false} />
            <View
              onLayout={(layoutEvent) => {
                const { width, height } = layoutEvent.nativeEvent.layout;
                setContainerSize({ width, height });
              }}
              style={styles.expandedFrame}
            >
              <VideoView
                contentFit="contain"
                nativeControls={false}
                player={player}
                style={StyleSheet.absoluteFill}
                surfaceType="textureView"
              />
              <View
                style={[
                  styles.videoChrome,
                  {
                    height: videoFrame.height,
                    left: videoFrame.x,
                    top: videoFrame.y,
                    width: videoFrame.width,
                  },
                ]}
              >
                <Pressable
                  accessibilityLabel={controlsVisible ? 'Hide video controls' : 'Show video controls'}
                  accessibilityRole="button"
                  onPress={toggleControls}
                  style={StyleSheet.absoluteFill}
                />
                {!video.playbackIncludesOverlays && (
                  <PlaybackOverlay currentTimeMs={currentTime * 1000} event={event} />
                )}
                <View
                  style={[styles.playerActions, { left: leftChromeInset, top: spacing.md }]}
                >
                  {onSave && (
                    <Pressable
                      accessibilityLabel="Download video to device"
                      accessibilityRole="button"
                      accessibilityState={{ busy: isSaving, disabled: isSaving || saveDisabled }}
                      disabled={isSaving || saveDisabled}
                      onPress={() => void saveFromPlayer()}
                      style={({ pressed }) => [
                        styles.playerActionButton,
                        styles.downloadButton,
                        pressed && !isSaving && !saveDisabled && styles.pressed,
                        (isSaving || saveDisabled) && styles.disabled,
                      ]}
                    >
                      <Text style={styles.downloadButtonText}>
                        {video.exportStatus === 'failed'
                          ? 'EXPORT FAILED'
                          : saveDisabled
                            ? 'PREPARING...'
                            : isSaving
                              ? 'SAVING...'
                              : 'DOWNLOAD'}
                      </Text>
                    </Pressable>
                  )}
                  {onDelete && (
                    <Pressable
                      accessibilityLabel="Delete video"
                      accessibilityRole="button"
                      accessibilityState={{ busy: isDeleting, disabled: isSaving || isDeleting }}
                      disabled={isSaving || isDeleting}
                      onPress={requestDelete}
                      style={({ pressed }) => [
                        styles.playerActionButton,
                        styles.playerDeleteButton,
                        pressed && !isSaving && !isDeleting && styles.pressed,
                        (isSaving || isDeleting) && styles.disabled,
                      ]}
                    >
                      <Text style={styles.playerDeleteButtonText}>DELETE</Text>
                    </Pressable>
                  )}
                </View>
                <Pressable
                  accessibilityLabel="Close video"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={closeExpanded}
                  style={({ pressed }) => [
                    styles.closeButton,
                    { right: rightChromeInset, top: spacing.md },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.closeText}>{'\u00D7'}</Text>
                </Pressable>
                {controlsVisible && (
                  <View
                    style={[
                      styles.playbackControls,
                      { left: leftChromeInset, right: rightChromeInset },
                    ]}
                  >
                    <Pressable
                      accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
                      accessibilityRole="button"
                      onPress={togglePlayback}
                      style={({ pressed }) => [styles.playPauseButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.playPauseText}>
                        {isPlaying ? '\u2161' : '\u25B6'}
                      </Text>
                    </Pressable>
                    <Text style={styles.playbackTime}>{formatRoundClock(currentTime)}</Text>
                    <View
                      accessibilityActions={[
                        { name: 'increment', label: 'Seek forward 10 seconds' },
                        { name: 'decrement', label: 'Seek backward 10 seconds' },
                      ]}
                      accessibilityLabel="Video progress"
                      accessibilityRole="adjustable"
                      accessibilityValue={{
                        max: Math.round(duration),
                        min: 0,
                        now: Math.round(currentTime),
                        text: `${formatRoundClock(currentTime)} of ${formatRoundClock(duration)}`,
                      }}
                      onAccessibilityAction={({ nativeEvent }) => {
                        if (nativeEvent.actionName === 'increment') seekTo(currentTime + 10);
                        if (nativeEvent.actionName === 'decrement') seekTo(currentTime - 10);
                      }}
                      onLayout={(layoutEvent) => {
                        setProgressWidth(layoutEvent.nativeEvent.layout.width);
                      }}
                      onMoveShouldSetResponder={() => true}
                      onResponderGrant={startScrubbing}
                      onResponderMove={moveScrubbing}
                      onResponderRelease={finishScrubbing}
                      onResponderTerminate={finishScrubbing}
                      onStartShouldSetResponder={() => true}
                      style={styles.progressHitArea}
                    >
                      <View style={styles.progressTrack}>
                        <View
                          style={[styles.progressFill, { width: `${playbackProgress * 100}%` }]}
                        />
                        <View
                          style={[styles.progressThumb, { left: `${playbackProgress * 100}%` }]}
                        />
                      </View>
                    </View>
                    <Text style={styles.playbackTime}>{formatRoundClock(duration)}</Text>
                  </View>
                )}
              </View>
            </View>
            <ConfirmationPrompt
              busy={isDeleting}
              busyLabel="DELETING..."
              confirmLabel="DELETE VIDEO"
              destructive
              embedded
              message={
                deleteError
                  ? `The video could not be deleted. ${deleteError}`
                  : 'This removes the video from WHATZ IT on this device.'
              }
              onCancel={cancelDelete}
              onConfirm={() => void confirmDelete()}
              title={deleteError ? 'Could not delete video' : 'Delete round video?'}
              visible={deletePromptVisible}
            />
            <ConfirmationPrompt
              cancelLabel={null}
              confirmLabel="OK"
              embedded
              message={saveNotice?.message ?? ''}
              onCancel={() => setSaveNotice(null)}
              onConfirm={() => setSaveNotice(null)}
              title={saveNotice?.title ?? ''}
              visible={saveNotice !== null}
            />
          </View>
        </LandscapeViewport>
      </Modal>
    </>
  );
}

function setPlayerMuted(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

function seekVideoPlayer(player: VideoPlayer, time: number) {
  player.currentTime = time;
}

function setPlayerSeekTolerance(player: VideoPlayer, tolerance: number) {
  player.seekTolerance = { toleranceAfter: tolerance, toleranceBefore: tolerance };
}

function setPlayerScrubbingMode(player: VideoPlayer, enabled: boolean) {
  player.scrubbingModeOptions = { scrubbingModeEnabled: enabled };
}

function getScrubAxisPosition(event: GestureResponderEvent) {
  return Platform.OS === 'web' ? event.nativeEvent.pageX : event.nativeEvent.pageY;
}

function clampTime(time: number, duration: number) {
  return Math.max(0, Math.min(duration, time));
}

function pauseAudioPlayer(player: AudioPlayer) {
  try {
    player.pause();
  } catch {
    // The hook may have already released its native player while the view unmounts.
  }
}

function enablePlayerAudio(player: VideoPlayer) {
  setPlaybackAudioMode()
    .catch(() => undefined)
    .finally(() => {
      player.volume = 1;
      player.audioMixingMode = 'doNotMix';
      player.muted = false;
      player.play();
    });
}

function setPlaybackAudioMode() {
  return setAudioModeAsync({
    allowsRecording: false,
    interruptionMode: 'doNotMix',
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
  });
}

function restoreAppAudioMode() {
  setAudioModeAsync({
    allowsRecording: false,
    interruptionMode: 'mixWithOthers',
    playsInSilentMode: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => undefined);
}

function getEventAtTime(events: RoundVideoEvent[], timeMs: number) {
  let current: RoundVideoEvent | undefined;
  for (const event of events) {
    if (event.atMs > timeMs) break;
    current = event;
  }
  return current;
}

function getContainedVideoFrame(
  container: { width: number; height: number },
  video: { width: number; height: number },
) {
  if (
    container.width <= 0 ||
    container.height <= 0 ||
    video.width <= 0 ||
    video.height <= 0
  ) {
    return { x: 0, y: 0, width: container.width, height: container.height };
  }

  const containerAspect = container.width / container.height;
  const videoAspect = video.width / video.height;

  if (videoAspect > containerAspect) {
    const height = container.width / videoAspect;
    return {
      x: 0,
      y: (container.height - height) / 2,
      width: container.width,
      height,
    };
  }

  const width = container.height * videoAspect;
  return {
    x: (container.width - width) / 2,
    y: 0,
    width,
    height: container.height,
  };
}

function PlaybackOverlay({
  currentTimeMs,
  event,
  compact = false,
}: {
  currentTimeMs: number;
  event?: RoundVideoEvent;
  compact?: boolean;
}) {
  if (!event) return null;
  const palette = getEventPalette(event.kind);
  const text = event.text.replace(/\s+/g, ' ').trim();
  const byline = event.byline?.replace(/\s+/g, ' ').trim();
  const timerText = getOverlayTimerText(event, currentTimeMs);
  return (
    <View pointerEvents="none" style={[styles.overlay, compact && styles.overlayCompact]}>
      <View
        style={[
          styles.overlayCard,
          compact && styles.overlayCardCompact,
          { backgroundColor: palette.background },
        ]}
      >
        <Text
          adjustsFontSizeToFit
          allowFontScaling={false}
          ellipsizeMode="clip"
          minimumFontScale={0.01}
          numberOfLines={1}
          style={[
            styles.overlayText,
            compact && styles.overlayTextCompact,
            { color: palette.foreground },
          ]}
        >
          {text}
        </Text>
        {byline && (
          <Text
            adjustsFontSizeToFit
            allowFontScaling={false}
            ellipsizeMode="clip"
            minimumFontScale={0.01}
            numberOfLines={1}
            style={[
              styles.overlayByline,
              compact && styles.overlayBylineCompact,
              { color: palette.foreground },
            ]}
          >
            by {byline}
          </Text>
        )}
        {timerText && (
          <Text
            allowFontScaling={false}
            style={[
              styles.overlayTimer,
              compact && styles.overlayTimerCompact,
              { color: palette.foreground },
            ]}
          >
            {timerText}
          </Text>
        )}
      </View>
    </View>
  );
}

function getOverlayTimerText(event: RoundVideoEvent, currentTimeMs: number) {
  if (
    event.timerEndsAtMs === undefined ||
    (event.kind !== 'card' && event.kind !== 'correct' && event.kind !== 'passed')
  ) {
    return null;
  }
  return formatRoundClock(Math.max(0, Math.ceil((event.timerEndsAtMs - currentTimeMs) / 1000)));
}

function getEventPalette(kind: RoundVideoEvent['kind']) {
  switch (kind) {
    case 'correct':
      return { background: 'rgba(135, 237, 170, 0.64)', foreground: colors.ink };
    case 'passed':
      return { background: 'rgba(255, 119, 43, 0.64)', foreground: colors.passText };
    case 'times-up':
    case 'countdown':
      return { background: 'rgba(50, 139, 232, 0.64)', foreground: colors.white };
    case 'card':
      return { background: 'rgba(247, 245, 239, 0.64)', foreground: colors.play };
  }
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#111111' },
  thumbnailPlayBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 38,
    height: 38,
    marginTop: -19,
    marginLeft: -19,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  thumbnailPlayIcon: { marginLeft: 2, color: '#FFFFFF', fontSize: 17 },
  modalRoot: { flex: 1, backgroundColor: '#000000' },
  expandedFrame: { flex: 1, backgroundColor: '#000000' },
  videoChrome: { position: 'absolute', overflow: 'hidden' },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 52,
    alignItems: 'center',
  },
  overlayCard: {
    minWidth: '30%',
    maxWidth: '100%',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 12,
  },
  overlayCompact: {
    bottom: 5,
  },
  overlayCardCompact: {
    minHeight: 22,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  overlayText: {
    flexShrink: 1,
    fontSize: 22,
    lineHeight: 25,
    fontWeight: '900',
    textAlign: 'center',
  },
  overlayTextCompact: { fontSize: 10, lineHeight: 11 },
  overlayByline: {
    marginTop: 2,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
    opacity: 0.72,
  },
  overlayBylineCompact: { marginTop: 1, fontSize: 6, lineHeight: 7 },
  overlayTimer: { marginTop: 2, fontSize: 12, lineHeight: 14, fontWeight: '800', textAlign: 'center' },
  overlayTimerCompact: { marginTop: 1, fontSize: 5, lineHeight: 6 },
  closeButton: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    zIndex: 20,
    elevation: 20,
  },
  playerActions: {
    position: 'absolute',
    flexDirection: 'row',
    gap: spacing.sm,
    zIndex: 20,
    elevation: 20,
  },
  playerActionButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  downloadButton: { backgroundColor: 'rgba(56, 109, 236, 0.94)' },
  downloadButtonText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  playerDeleteButton: { borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.5)' },
  playerDeleteButtonText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  playbackControls: {
    position: 'absolute',
    bottom: 8,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    zIndex: 20,
    elevation: 20,
  },
  playPauseButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  playPauseText: { color: colors.white, fontSize: 18, fontWeight: '900' },
  playbackTime: {
    minWidth: 38,
    color: colors.white,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  progressHitArea: { flex: 1, height: 40, justifyContent: 'center' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.36)',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 3,
    backgroundColor: colors.play,
  },
  progressThumb: {
    position: 'absolute',
    top: -4,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.white,
  },
  closeText: { color: colors.white, fontSize: 42, fontWeight: '900', lineHeight: 42 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.55 },
});

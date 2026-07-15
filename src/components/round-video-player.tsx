import { useEventListener } from 'expo';
import { type AudioPlayer, setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, type VideoPlayer, VideoView } from 'expo-video';
import { useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  type GestureResponderEvent,
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
  onSave?: (video: RoundVideo) => Promise<VideoSaveNotice>;
  onDelete?: (video: RoundVideo) => Promise<void>;
};

export function RoundVideoPlayer({
  video,
  style,
  isSaving = false,
  saveDisabled = false,
  onSave,
  onDelete,
}: RoundVideoPlayerProps) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [saveNotice, setSaveNotice] = useState<VideoSaveNotice | null>(null);
  const [deletePromptVisible, setDeletePromptVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [duration, setDuration] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  // Keep one source for this player's entire mounted lifetime. Replacing the raw
  // recording with its finished export would otherwise restart visible playback.
  const [playbackUri] = useState(() => video.uri);
  const expandedRef = useRef(false);
  const previousVideoTime = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const separateAudioUri = video.audioUri;
  const separateAudio = useAudioPlayer(separateAudioUri ?? null);
  const player = useVideoPlayer(playbackUri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.timeUpdateEventInterval = 0.1;
    instance.play();
  });

  useEventListener(player, 'timeUpdate', ({ currentTime: nextTime }) => {
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

  useEventListener(player, 'sourceLoad', ({ availableAudioTracks, duration, videoSource }) => {
    setDuration(duration);
    logVideoDiagnostic('player source loaded', {
      audioTrackCount: availableAudioTracks.length,
      audioTracks: availableAudioTracks,
      exportUri: video.exportUri,
      playbackIncludesOverlays: false,
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

  const openExpanded = async () => {
    expandedRef.current = true;
    previousVideoTime.current = player.currentTime;
    setExpanded(true);
    await setPlaybackAudioMode().catch(() => undefined);
    if (separateAudioUri) {
      setPlayerMuted(player, true);
      await separateAudio.seekTo(player.currentTime).catch(() => undefined);
      separateAudio.play();
      player.play();
    } else {
      enablePlayerAudio(player);
    }
  };

  const closeExpanded = () => {
    expandedRef.current = false;
    pauseAudioPlayer(separateAudio);
    setPlayerMuted(player, true);
    player.play();
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
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  const seekTo = (time: number) => {
    const nextTime = Math.max(0, Math.min(duration, time));
    seekVideoPlayer(player, nextTime);
    setCurrentTime(nextTime);
    if (separateAudioUri) {
      void separateAudio.seekTo(nextTime).catch(() => undefined);
    }
  };

  const seekFromProgress = (event: GestureResponderEvent) => {
    if (duration <= 0 || progressWidth <= 0) return;
    seekTo((event.nativeEvent.locationX / progressWidth) * duration);
  };

  return (
    <>
      {!expanded && (
        <View style={[styles.frame, style]}>
          <VideoView
            contentFit="cover"
            nativeControls={false}
            player={player}
            style={StyleSheet.absoluteFill}
            surfaceType="textureView"
          />
          <PlaybackOverlay currentTimeMs={currentTime * 1000} event={event} compact />
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
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        visible={expanded}
      >
        <LandscapeViewport>
          <View style={styles.modalRoot}>
            <StatusBar hidden animated={false} />
            <View style={styles.expandedFrame}>
              <VideoView
                contentFit="contain"
                nativeControls={false}
                player={player}
                style={StyleSheet.absoluteFill}
                surfaceType="textureView"
              />
              <PlaybackOverlay currentTimeMs={currentTime * 1000} event={event} />
              <View
                style={[
                  styles.playerActions,
                  {
                    left: Math.max(spacing.md, insets.top + spacing.sm),
                    top: spacing.md,
                  },
                ]}
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
                  {
                    right: Math.max(spacing.md, insets.bottom + spacing.sm),
                    top: spacing.md,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.closeText}>{'\u00D7'}</Text>
              </Pressable>
              <View
                style={[
                  styles.playbackControls,
                  {
                    left: Math.max(spacing.md, insets.top + spacing.sm),
                    right: Math.max(spacing.md, insets.bottom + spacing.sm),
                  },
                ]}
              >
                <Pressable
                  accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
                  accessibilityRole="button"
                  onPress={togglePlayback}
                  style={({ pressed }) => [styles.playPauseButton, pressed && styles.pressed]}
                >
                  <Text style={styles.playPauseText}>{isPlaying ? 'Ⅱ' : '▶'}</Text>
                </Pressable>
                <Text style={styles.playbackTime}>{formatRoundClock(currentTime)}</Text>
                <Pressable
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
                  onPress={seekFromProgress}
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
                </Pressable>
                <Text style={styles.playbackTime}>{formatRoundClock(duration)}</Text>
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
  modalRoot: { flex: 1, backgroundColor: '#000000' },
  expandedFrame: { flex: 1, backgroundColor: '#000000' },
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
  overlayTimer: { marginTop: 2, fontSize: 12, lineHeight: 14, fontWeight: '800', textAlign: 'center' },
  overlayTimerCompact: { marginTop: 1, fontSize: 5, lineHeight: 6 },
  closeButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
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
    minHeight: 44,
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
    minHeight: 36,
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
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  playPauseText: { color: colors.white, fontSize: 16, fontWeight: '900' },
  playbackTime: {
    minWidth: 34,
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  progressHitArea: { flex: 1, height: 32, justifyContent: 'center' },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.36)',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 2,
    backgroundColor: colors.play,
  },
  progressThumb: {
    position: 'absolute',
    top: -4,
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    backgroundColor: colors.white,
  },
  closeText: { color: colors.white, fontSize: 40, fontWeight: '900' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.55 },
});

import { useEventListener } from 'expo';
import { type AudioPlayer, setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, type VideoPlayer, VideoView } from 'expo-video';
import { useMemo, useRef, useState } from 'react';
import {
  Modal,
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
  onDelete?: (video: RoundVideo) => void;
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
  const [expandedPlaybackSource, setExpandedPlaybackSource] = useState(() =>
    getPreferredPlaybackSource(video),
  );
  const expandedRef = useRef(false);
  const previousVideoTime = useRef(0);
  const [currentTime, setCurrentTime] = useState(0);
  const preferredPlaybackSource = getPreferredPlaybackSource(video);
  const playbackSource = expanded ? expandedPlaybackSource : preferredPlaybackSource;
  const playbackUri = playbackSource.uri;
  const separateAudioUri = playbackSource.isExport ? undefined : video.audioUri;
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
    if (!expandedRef.current || !separateAudioUri) return;
    if (isPlaying) {
      void separateAudio.seekTo(player.currentTime).then(() => separateAudio.play()).catch(() => undefined);
    } else {
      pauseAudioPlayer(separateAudio);
    }
  });

  useEventListener(player, 'sourceLoad', ({ availableAudioTracks, videoSource }) => {
    logVideoDiagnostic('player source loaded', {
      audioTrackCount: availableAudioTracks.length,
      audioTracks: availableAudioTracks,
      exportUri: video.exportUri,
      playbackIncludesOverlays: playbackSource.includesOverlays,
      playbackUri,
      separateAudioUri,
      videoSource,
    });
  });

  const event = useMemo(
    () => getEventAtTime(video.events ?? [], currentTime * 1000),
    [currentTime, video.events],
  );

  const openExpanded = async () => {
    setExpandedPlaybackSource(preferredPlaybackSource);
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
    closeExpanded();
    onDelete(video);
  };

  const saveFromPlayer = async () => {
    if (!onSave || isSaving || saveDisabled) return;
    const notice = await onSave(video);
    setSaveNotice(notice);
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
          {!playbackSource.includesOverlays && <PlaybackOverlay event={event} compact />}
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
        onRequestClose={() => (saveNotice ? setSaveNotice(null) : closeExpanded())}
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
              nativeControls
              player={player}
              style={StyleSheet.absoluteFill}
              surfaceType="textureView"
            />
            {!playbackSource.includesOverlays && <PlaybackOverlay event={event} />}
          </View>
          {(onSave || onDelete) && (
            <View
              style={[styles.playerActions, { top: Math.max(spacing.lg, insets.top + spacing.sm) }]}
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
                  disabled={isSaving}
                  onPress={requestDelete}
                  style={({ pressed }) => [
                    styles.playerActionButton,
                    styles.playerDeleteButton,
                    pressed && !isSaving && styles.pressed,
                    isSaving && styles.disabled,
                  ]}
                >
                  <Text style={styles.playerDeleteButtonText}>DELETE</Text>
                </Pressable>
              )}
            </View>
          )}
          <Pressable
            accessibilityLabel="Close video"
            accessibilityRole="button"
            hitSlop={16}
            onPress={closeExpanded}
            style={({ pressed }) => [
              styles.closeButton,
              { top: Math.max(spacing.lg, insets.top + spacing.sm) },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
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

function getPreferredPlaybackSource(video: RoundVideo) {
  return video.exportUri
    ? {
        uri: video.exportUri,
        isExport: true,
        includesOverlays: video.exportIncludesOverlays === true,
      }
    : { uri: video.uri, isExport: false, includesOverlays: false };
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

function PlaybackOverlay({ event, compact = false }: { event?: RoundVideoEvent; compact?: boolean }) {
  if (!event) return null;
  const palette = getEventPalette(event.kind);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.overlay,
        compact && styles.overlayCompact,
        { backgroundColor: palette.background },
      ]}
    >
      <Text
        numberOfLines={2}
        style={[
          styles.overlayText,
          compact && styles.overlayTextCompact,
          { color: palette.foreground },
        ]}
      >
        {event.text}
      </Text>
    </View>
  );
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
    left: '50%',
    transform: [{ translateX: -100 }],
    bottom: 52,
    width: 200,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 12,
  },
  overlayCompact: {
    transform: [{ translateX: -42 }],
    bottom: 5,
    width: 84,
    minHeight: 22,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  overlayText: { fontSize: 18, lineHeight: 21, fontWeight: '900', textAlign: 'center' },
  overlayTextCompact: { fontSize: 8, lineHeight: 9 },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    zIndex: 20,
    elevation: 20
  },
  playerActions: {
    position: 'absolute',
    left: spacing.lg,
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
  closeText: { color: colors.white, fontSize: 40, fontWeight: '900' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.55 },
});

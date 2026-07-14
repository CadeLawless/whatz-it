import { useEventListener } from 'expo';
import { useVideoPlayer, type VideoPlayer, VideoView } from 'expo-video';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme';
import type { RoundVideo, RoundVideoEvent } from '@/video/round-videos';

type RoundVideoPlayerProps = {
  video: RoundVideo;
  style?: StyleProp<ViewStyle>;
};

export function RoundVideoPlayer({ video, style }: RoundVideoPlayerProps) {
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const player = useVideoPlayer(video.uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.timeUpdateEventInterval = 0.1;
    instance.play();
  });

  useEventListener(player, 'timeUpdate', ({ currentTime: nextTime }) => {
    setCurrentTime(nextTime);
  });

  const event = useMemo(
    () => getEventAtTime(video.events ?? [], currentTime * 1000),
    [currentTime, video.events],
  );

  const openExpanded = () => {
    setPlayerMuted(player, false);
    player.play();
    setExpanded(true);
  };

  const closeExpanded = () => {
    setPlayerMuted(player, true);
    player.play();
    setExpanded(false);
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
          />
          <PlaybackOverlay event={event} compact />
          <Pressable
            accessibilityHint="Opens a larger player with sound"
            accessibilityLabel="Watch round video"
            accessibilityRole="button"
            onPress={openExpanded}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}

      <Modal
        animationType="fade"
        onRequestClose={closeExpanded}
        statusBarTranslucent
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        visible={expanded}
      >
        <SafeAreaView style={styles.modalRoot}>
          <View style={styles.expandedFrame}>
            <VideoView
              contentFit="contain"
              nativeControls
              player={player}
              style={StyleSheet.absoluteFill}
            />
            <PlaybackOverlay event={event} />
          </View>
          <Pressable
            accessibilityLabel="Close video"
            accessibilityRole="button"
            onPress={closeExpanded}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function setPlayerMuted(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
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
      return { background: 'rgba(135, 237, 170, 0.78)', foreground: colors.ink };
    case 'passed':
      return { background: 'rgba(225, 111, 200, 0.78)', foreground: colors.white };
    case 'times-up':
    case 'countdown':
      return { background: 'rgba(50, 139, 232, 0.78)', foreground: colors.white };
    case 'card':
      return { background: 'rgba(247, 245, 239, 0.78)', foreground: colors.play };
  }
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#111111' },
  modalRoot: { flex: 1, backgroundColor: '#000000' },
  expandedFrame: { flex: 1, backgroundColor: '#000000' },
  overlay: {
    position: 'absolute',
    left: spacing.lg,
    bottom: 72,
    maxWidth: '48%',
    minWidth: 132,
    minHeight: 66,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  overlayCompact: {
    left: 7,
    bottom: 7,
    minWidth: 48,
    minHeight: 28,
    maxWidth: '62%',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  overlayText: { fontSize: 22, lineHeight: 26, fontWeight: '900', textAlign: 'center' },
  overlayTextCompact: { fontSize: 9, lineHeight: 11 },
  closeButton: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  closeText: { color: colors.white, fontSize: 34, lineHeight: 38, fontWeight: '500' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useReducedMotion,
  useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { reactionOptionsFor, type SharePlayReactionEvent, type SharePlayReactionIndex,
  type SharePlayReactionSet } from '@/shareplay/reactions';
import { colors, radius, spacing } from '@/theme';

export function SharePlayReactionBar({ set, onReact, onColumnLayout }: {
  set: SharePlayReactionSet;
  onReact: (emoji: SharePlayReactionIndex) => void;
  onColumnLayout: (emoji: SharePlayReactionIndex, x: number, y: number, width: number, height: number) => void;
}) {
  const buttons = useRef<(View | null)[]>([]);
  return <View style={styles.bar} accessibilityRole="toolbar">
    {reactionOptionsFor(set).map((reaction, index) =>
      <Pressable key={reaction.emoji} ref={(button) => { buttons.current[index] = button; }}
        onLayout={() => buttons.current[index]?.measureInWindow((x, y, width, height) =>
          onColumnLayout(index as SharePlayReactionIndex, x, y, width, height))}
        accessibilityRole="button"
        accessibilityLabel={`React with ${reaction.label}`}
        onPress={() => onReact(index as SharePlayReactionIndex)}
        style={({ pressed }) => [styles.reactionButton, pressed && styles.pressed]}>
        <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
      </Pressable>)}
  </View>;
}

export function SharePlayReactionBurst({ reaction, playerName, originX, originBottom, onDone }: {
  reaction: SharePlayReactionEvent; playerName: string; originX?: number; originBottom: number;
  onDone: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [motion] = useState(() => ({
    left: Math.max(0, Math.min(width - 112, (originX ?? width * (reaction.emoji + 0.5) / 4) - 56)),
    drift: (Math.random() - 0.5) * 70,
    rotation: (Math.random() - 0.5) * 52,
  }));
  useEffect(() => {
    progress.set(withTiming(1, { duration: reducedMotion ? 650 : 1450,
      easing: Easing.bezier(0.23, 1, 0.32, 1) }, (finished) => {
      if (finished) scheduleOnRN(onDone, reaction.id);
    }));
    return () => cancelAnimation(progress);
  }, [onDone, progress, reaction.id, reducedMotion]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.12, 0.72, 1], [0, 1, 1, 0]),
    transform: [
      { translateY: reducedMotion ? 0 : -190 * progress.get() },
      { translateX: reducedMotion ? 0 : motion.drift * progress.get() },
      { rotate: `${reducedMotion ? 0 : motion.rotation * progress.get()}deg` },
    ],
  }));
  return <Animated.View pointerEvents="none" style={[styles.burst,
    { left: motion.left, bottom: originBottom }, animatedStyle]}>
    <Text style={styles.burstEmoji}>{reactionOptionsFor(reaction.set)[reaction.emoji].emoji}</Text>
    <Text numberOfLines={1} ellipsizeMode="tail" style={styles.playerName}>{playerName}</Text>
  </Animated.View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  reactionButton: { flex: 1, maxWidth: 76, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  reactionEmoji: { fontSize: 27, lineHeight: 36, textAlign: 'center' },
  pressed: { opacity: 0.68, transform: [{ scale: 0.97 }] },
  burst: { position: 'absolute', width: 112, alignItems: 'center' },
  burstEmoji: { fontSize: 43, lineHeight: 53, textAlign: 'center' },
  playerName: { maxWidth: 108, paddingHorizontal: 7, paddingVertical: 3,
    overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.surface,
    color: colors.ink, fontFamily: 'Inter_800ExtraBold', fontSize: 11, textAlign: 'center' },
});

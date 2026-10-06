import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring,
  withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { CircularCloseButton } from '@/components/circular-close-button';
import type { GameMode } from '@/game/game-types';
import { colors, radius, spacing } from '@/theme';

export function SharePlayRolePickerSheet({ visible, mode, participants, localId, playerNames,
  localPlayerName, disabled, onClose, onSelect }: {
  visible: boolean; mode: GameMode; participants: string[]; localId: string | null;
  playerNames: Record<string, string>; localPlayerName: string;
  disabled: boolean; onClose: () => void; onSelect: (participantId: string) => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const translateY = useSharedValue(height + 32);
  const backdropOpacity = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.get() }));
  useEffect(() => {
    translateY.set(withTiming(visible ? 0 : height + 32, { duration: reduceMotion ? 0 : 300 }));
    backdropOpacity.set(withTiming(visible ? 1 : 0, { duration: reduceMotion ? 0 : 220 }));
  }, [backdropOpacity, height, reduceMotion, translateY, visible]);
  const drag = useMemo(() => Gesture.Pan().enabled(visible)
    .activeOffsetY([-8, 8]).failOffsetX([-28, 28])
    .onUpdate(({ translationY }) => { translateY.set(Math.max(0, translationY)); })
    .onEnd(({ translationY, velocityY }) => {
      if (translationY >= 72 || velocityY >= 720) scheduleOnRN(onClose);
      else translateY.set(reduceMotion ? 0 : withSpring(0, { duration: 400, dampingRatio: 1 }));
    })
    .onFinalize((_event, success) => {
      if (!success) translateY.set(reduceMotion ? 0 : withSpring(0, { duration: 400, dampingRatio: 1 }));
    }), [onClose, reduceMotion, translateY, visible]);
  const role = mode === 'pass-n-play' ? 'starting player' : 'guesser';
  const playerLabel = (id: string) => id === localId ? `${localPlayerName} (you)` :
    playerNames[id] ?? 'Choosing a name…';
  return <>
    <Animated.View pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close player picker"
        onPress={onClose} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} accessibilityViewIsModal
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[styles.sheet, { maxHeight: Math.max(240, height - insets.top - 12),
        paddingBottom: Math.max(insets.bottom, 12) }, sheetStyle]}>
      <GestureDetector gesture={drag}>
        <View accessibilityElementsHidden style={styles.grabberArea}>
          <View style={styles.grabber} />
        </View>
      </GestureDetector>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close player picker"
            onPress={onClose} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <SymbolView name="chevron.left" size={20} tintColor={colors.play} accessibilityElementsHidden />
          </Pressable>
          <Text style={styles.title}>Choose a {role}</Text>
          <CircularCloseButton accessibilityLabel="Close player picker" appearance="sheet" onPress={onClose} />
        </View>
        <Text style={styles.body}>The new {role} will manage the deck and rounds.</Text>
        {participants.filter((id) => id !== localId).map((id) =>
          <Pressable key={id} accessibilityRole="button"
            accessibilityLabel={`Make ${playerLabel(id)} ${role}`}
            disabled={disabled} onPress={() => onSelect(id)}
            style={({ pressed }) => [styles.choice, disabled && styles.disabled, pressed && styles.pressed]}>
            <Text style={styles.choiceText}>{playerLabel(id)}</Text>
            <SymbolView name="chevron.right" size={18} tintColor={colors.play} accessibilityElementsHidden />
          </Pressable>)}
      </ScrollView>
    </Animated.View>
  </>;
}

const styles = StyleSheet.create({
  backdrop: { zIndex: 50, backgroundColor: 'rgba(15, 23, 42, 0.18)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 51, backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  grabberArea: { height: 44, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#8E8E93' },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: 20, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 27, lineHeight: 32, fontFamily: 'Inter_900Black', color: colors.play },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23, fontFamily: 'Inter_500Medium' },
  choice: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm, paddingHorizontal: 16, borderRadius: radius.lg, backgroundColor: colors.surface },
  choiceText: { color: colors.ink, fontSize: 17, fontFamily: 'Inter_700Bold' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});

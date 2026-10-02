import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { GameMode } from '@/game/game-types';
import { colors, radius, spacing, typography } from '@/theme';

const modes = [
  { value: 'classic', title: 'Classic', description: 'Phone to forehead. Friends give clues!', instruction: 'Hold the phone at your forehead' },
  { value: 'pass-n-play', title: "Pass n' Play", description: 'Give clues, then pass. Everyone gets a turn!', instruction: 'Hold the phone facing you' },
] as const;

export function GameModeSelector({ value, disabled, onChange }: {
  value: GameMode; disabled: boolean; onChange: (mode: GameMode) => void;
}) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const sideBySide = width >= 300 && fontScale <= 1.15;
  const selectedMode = modes.find((mode) => mode.value === value)!;
  return (
    <View style={styles.container} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={[styles.options, sideBySide && styles.row]}>
        {modes.map((mode) => {
          const selected = value === mode.value;
          return (
            <Pressable key={mode.value} accessibilityRole="radio"
              accessibilityLabel={`${mode.title}. ${mode.description} ${mode.instruction}.`}
              accessibilityState={{ checked: selected, disabled }} disabled={disabled}
              onPress={() => onChange(mode.value)}
              style={({ pressed }) => [styles.option, sideBySide && styles.column,
                selected && styles.selected, pressed && styles.pressed, disabled && styles.disabled]}>
              <Text style={styles.title}>{mode.title}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.01} style={styles.helper}>
        {selectedMode.description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  options: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  column: { flex: 1 },
  option: { minHeight: 56, justifyContent: 'center', borderWidth: 2, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.background },
  selected: { borderColor: colors.play, backgroundColor: colors.surface },
  title: { flexShrink: 1, fontSize: 18, lineHeight: 23, fontFamily: 'Inter_900Black', color: colors.ink, textAlign: 'center' },
  helper: { ...typography.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.65 },
});

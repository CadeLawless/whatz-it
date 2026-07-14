import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MAX_ROUND_DURATION, MIN_ROUND_DURATION } from '@/game/round-duration';
import { colors, radius, spacing } from '@/theme';

const PRESETS = [30, 60, 120, 180];

type TimerPickerProps = {
  value: number;
  onChange: (value: number) => void;
};

export function TimerPicker({ value, onChange }: TimerPickerProps) {
  const atMinimum = value <= MIN_ROUND_DURATION;
  const atMaximum = value >= MAX_ROUND_DURATION;

  return (
    <View>
      <View style={styles.presets}>
        {PRESETS.map((seconds) => {
          const selected = value === seconds;
          return (
            <Pressable
              key={seconds}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(seconds)}
              style={[styles.preset, selected && styles.presetSelected]}
            >
              <Text style={[styles.presetText, selected && styles.presetTextSelected]}>
                {formatDuration(seconds)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.customRow}>
        <View>
          <Text style={styles.customLabel}>CUSTOM TIMER</Text>
          <Text style={styles.customValue}>{formatDuration(value)}</Text>
        </View>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decrease timer by 15 seconds"
            accessibilityState={{ disabled: atMinimum }}
            disabled={atMinimum}
            onPress={() => onChange(Math.max(MIN_ROUND_DURATION, value - 15))}
            style={[styles.stepButton, atMinimum && styles.stepButtonDisabled]}
          >
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase timer by 15 seconds"
            accessibilityHint="Maximum round length is five minutes"
            accessibilityState={{ disabled: atMaximum }}
            disabled={atMaximum}
            onPress={() => onChange(Math.min(MAX_ROUND_DURATION, value + 15))}
            style={[styles.stepButton, styles.incrementButton, atMaximum && styles.stepButtonDisabled]}
          >
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

const styles = StyleSheet.create({
  presets: { flexDirection: 'row', gap: spacing.md },
  preset: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: '#D2DEE8',
    alignItems: 'center',
  },
  presetSelected: { borderColor: colors.play },
  presetText: { color: '#000000', fontSize: 15, fontWeight: '800' },
  presetTextSelected: { color: colors.play },
  customRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: '#D2DEE8',
  },
  customLabel: { color: '#000000', fontSize: 14, fontWeight: '500' },
  customValue: { color: colors.play, fontSize: 30, lineHeight: 34, fontWeight: '900', marginTop: 3 },
  stepper: { flexDirection: 'row', gap: spacing.sm },
  stepButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.playSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incrementButton: { backgroundColor: colors.playBorder },
  stepButtonDisabled: { opacity: 0.3 },
  stepText: { color: '#000000', fontSize: 30, fontWeight: '600', marginTop: -2 },
});

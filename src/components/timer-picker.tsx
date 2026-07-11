import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MAX_ROUND_DURATION, MIN_ROUND_DURATION } from '@/game/round-duration';
import { colors, radius, spacing } from '@/theme';

const PRESETS = [30, 60, 90, 120, 180];

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
            style={[styles.stepButton, atMaximum && styles.stepButtonDisabled]}
          >
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.limitText}>Maximum round length: 5 minutes</Text>
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
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preset: {
    minWidth: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  presetSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  presetText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  presetTextSelected: { color: colors.white },
  customRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  customValue: { color: colors.ink, fontSize: 22, fontWeight: '900', marginTop: 2 },
  stepper: { flexDirection: 'row', gap: spacing.sm },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: { opacity: 0.3 },
  stepText: { color: colors.ink, fontSize: 26, fontWeight: '700', marginTop: -2 },
  limitText: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: spacing.sm },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

type ConfirmationPromptProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationPrompt({
  visible,
  title,
  message,
  cancelLabel = 'CANCEL',
  confirmLabel,
  busyLabel = 'WORKING...',
  busy = false,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmationPromptProps) {
  if (!visible) return null;

  return (
    <View accessibilityViewIsModal style={styles.overlay}>
      <Pressable
        accessibilityLabel="Dismiss confirmation"
        accessibilityRole="button"
        disabled={busy}
        onPress={onCancel}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onCancel}
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && !busy && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.confirmButton,
              destructive && styles.destructiveButton,
              pressed && !busy && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            <Text style={styles.confirmText}>{busy ? busyLabel : confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(24, 35, 29, 0.48)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 12,
  },
  title: { ...typography.title, color: colors.ink, textAlign: 'center' },
  message: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  cancelButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.play,
  },
  destructiveButton: { backgroundColor: colors.pass },
  cancelText: { color: colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
  confirmText: { color: colors.white, fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.58 },
});

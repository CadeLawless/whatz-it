import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { LandscapeViewport } from '@/components/landscape-viewport';
import { colors, radius, spacing, typography } from '@/theme';

export type PromptOrientation = 'portrait' | 'landscape';

type ConfirmationPromptProps = {
  visible: boolean;
  title: string;
  message: string;
  cancelLabel?: string | null;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  embedded?: boolean;
  orientation?: PromptOrientation;
  onCancel: () => void;
  onConfirm: () => void;
  onDismissed?: () => void;
  onShown?: () => void;
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
  embedded = false,
  orientation = 'portrait',
  onCancel,
  onConfirm,
  onDismissed,
  onShown,
}: ConfirmationPromptProps) {
  const prompt = (
    <View accessibilityViewIsModal style={[styles.overlay, embedded && styles.embeddedOverlay]}>
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
          {cancelLabel && (
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
          )}
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

  if (embedded) return visible ? prompt : null;

  return (
    <Modal
      animationType="fade"
      onDismiss={onDismissed}
      onRequestClose={onCancel}
      onShow={onShown}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      transparent
      visible={visible}
    >
      {orientation === 'landscape' ? (
        <LandscapeViewport backgroundColor="transparent">{prompt}</LandscapeViewport>
      ) : (
        prompt
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    zIndex: 1000,
    elevation: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(24, 35, 29, 0.48)',
  },
  embeddedOverlay: StyleSheet.absoluteFill,
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
  cancelText: { color: colors.ink, fontSize: 10, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.9 },
  confirmText: { color: colors.white, fontSize: 10, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.9 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.58 },
});

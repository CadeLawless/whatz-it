import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

type Props = {
  busy: boolean;
  onBack: () => void;
  onContinueWithoutVideo: () => void;
  onRetry: () => void;
};

export function CaptureRecoveryOverlay({ busy, onBack, onContinueWithoutVideo, onRetry }: Props) {
  return (
    <View accessibilityViewIsModal style={styles.overlay}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>CAMERA NOT READY</Text>
        <Text style={styles.body}>
          The round is paused. Retry the camera, or keep playing without recording the rest of this round.
        </Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onRetry}
          style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}>
          <Text style={styles.primaryText}>{busy ? 'RETRYING…' : 'RETRY CAMERA'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onContinueWithoutVideo}
          style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}>
          <Text style={styles.secondaryText}>PLAY WITHOUT VIDEO</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onBack}
          style={({ pressed }) => [styles.back, (pressed || busy) && styles.pressed]}>
          <Text style={styles.backText}>END ROUND</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 200, alignItems: 'center',
    justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(24,35,29,0.62)' },
  card: { width: '100%', maxWidth: 520, alignItems: 'center', gap: spacing.md,
    padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.play },
  title: { ...typography.hero, color: colors.white, textAlign: 'center' },
  body: { ...typography.body, color: colors.white, textAlign: 'center' },
  primary: { minWidth: 240, alignItems: 'center', paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface },
  primaryText: { color: colors.ink, fontFamily: 'Inter_900Black', letterSpacing: 1.2 },
  secondary: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  secondaryText: { color: colors.white, fontFamily: 'Inter_900Black', letterSpacing: 1.1 },
  back: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backText: { color: colors.pass, fontFamily: 'Inter_900Black', letterSpacing: 1.1 },
  pressed: { opacity: 0.65 },
});

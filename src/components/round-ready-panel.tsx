import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CloseButton } from '@/components/close-button';
import { RecordingIndicator } from '@/components/recording-indicator';
import { colors, spacing } from '@/theme';

type RoundReadyPanelProps = {
  children: ReactNode;
  closeAccessibilityLabel: string;
  closeDisabled?: boolean;
  deckTitle: string;
  isRecording?: boolean;
  notice?: string;
  onClose: () => void;
  recordingIndicatorPosition?: 'top-left' | 'bottom-left';
};

export function RoundReadyPanel({
  children,
  closeAccessibilityLabel,
  closeDisabled = false,
  deckTitle,
  isRecording = false,
  notice,
  onClose,
  recordingIndicatorPosition = 'bottom-left',
}: RoundReadyPanelProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.closeButton}>
        <CloseButton
          accessibilityLabel={closeAccessibilityLabel}
          disabled={closeDisabled}
          onPress={onClose}
        />
      </View>
      <Text style={styles.deckName}>{deckTitle}</Text>
      <View style={styles.center}>{children}</View>
      {notice && (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}
      {isRecording && <RecordingIndicator position={recordingIndicatorPosition} />}
    </View>
  );
}

export function RoundReadyPosition({ title }: { title: string }) {
  return (
    <>
      <Text style={styles.positionTitle}>{title}</Text>
      <Text style={styles.instructions}>Tilt down for correct, tilt up to pass</Text>
    </>
  );
}

export function RoundReadyCountdown({
  fontSize,
  value,
}: {
  fontSize: number;
  value: number | 'GET READY';
}) {
  if (value === 'GET READY') return <Text style={styles.getReady}>GET READY</Text>;
  return (
    <Text style={[styles.count, { fontSize, lineHeight: fontSize * 1.05 }]}>
      {Math.max(1, value)}
    </Text>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 0,
    borderWidth: 6,
    borderColor: colors.playBorder,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.play,
  },
  closeButton: { position: 'absolute', top: 14, left: 14, zIndex: 2 },
  deckName: {
    position: 'absolute',
    top: 23,
    right: 28,
    color: colors.white,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
    fontWeight: '400',
    textTransform: 'uppercase',
  },
  center: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 86,
    paddingVertical: spacing.xl,
  },
  count: {
    color: colors.white,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  getReady: {
    color: colors.white,
    fontSize: 48,
    lineHeight: 56,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 1,
  },
  positionTitle: {
    color: colors.white,
    fontSize: 46,
    lineHeight: 52,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  instructions: {
    color: colors.white,
    fontSize: 21,
    lineHeight: 28,
    fontFamily: 'Inter_400Regular',
    fontWeight: '400',
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: 520,
  },
  notice: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.md,
    left: spacing.lg,
    alignItems: 'center',
  },
  noticeText: {
    color: colors.white,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
    textAlign: 'center',
  },
});

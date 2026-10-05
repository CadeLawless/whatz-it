import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { CloseButton } from '@/components/close-button';
import { PortraitTimesUpPanel } from '@/components/portrait-times-up-panel';
import { PortraitAnswerText, PortraitRoundFeedback } from '@/components/portrait-round-visuals';
import { RecordingIndicator } from '@/components/recording-indicator';
import type { CardOutcome, RoundStatus } from '@/game/game-types';
import { colors, radius, spacing, typography } from '@/theme';

type Props = {
  status: RoundStatus;
  outcome?: CardOutcome | null;
  deckTitle: string;
  clock: string;
  isRecording?: boolean;
  answer?: { text: string; byline?: string };
  onPass: () => void;
  onCorrect: () => void;
  onReveal: () => void;
  onClose: () => void;
  onResume: () => void;
  onFinish: () => void;
};

export function PassNPlayRoundPanel(props: Props) {
  const { status } = props;
  const onPass = props.onPass;
  const swipeToPass = Gesture.Pan()
    .enabled(status === 'playing')
    .maxPointers(1)
    .activeOffsetX(-20)
    .failOffsetY([-16, 16])
    .onEnd((event, success) => {
      if (success && (event.translationX <= -60 ||
        (event.translationX <= -20 && event.velocityX <= -600))) {
        scheduleOnRN(onPass);
      }
    });
  if (status === 'finished') return <PortraitTimesUpPanel />;
  const handoff = status === 'handoff';
  const paused = status === 'paused';
  if (status === 'feedback') {
    return <PortraitRoundFeedback outcome={props.outcome === 'correct' ? 'correct' : 'pass'} />;
  }
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        {!paused && status !== 'ready' && (
          <CloseButton accessibilityLabel="End round early" onPress={props.onClose} />
        )}
        <Text style={styles.deck}>{props.deckTitle}</Text>
      </View>
      <GestureDetector gesture={swipeToPass}>
        <View collapsable={false} style={styles.cardArea}>
          <View style={styles.content}>
            {status !== 'ready' && <Text style={styles.clock}>{props.clock}</Text>}
            {status === 'playing' && props.answer ? (
              <>
                <PortraitAnswerText key={props.answer.text} text={props.answer.text} />
                {props.answer.byline && <Text style={styles.byline}>{props.answer.byline}</Text>}
              </>
            ) : (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  {handoff ? 'Pass the phone' : paused ? 'Round paused' : 'GET READY'}
                </Text>
                {handoff && (
                  <View key="handoff-actions" style={styles.revealArea}>
                    <Action label="Show my card" onPress={props.onReveal} large />
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </GestureDetector>
      {status === 'playing' && (
        <View key="answer-actions" style={[styles.footer, props.isRecording && styles.recordingFooter]}>
          <View style={styles.actions}>
            <Action label="PASS" onPress={props.onPass} secondary equalWidth />
            <Action label="CORRECT" onPress={props.onCorrect} equalWidth />
          </View>
        </View>
      )}
      {paused && (
        <View key="paused-actions" style={styles.footer}>
          <Action label="Resume" onPress={props.onResume} />
          <Action label="End round" onPress={props.onFinish} secondary />
        </View>
      )}
      {props.isRecording && handoff && <View style={styles.recordingSpace} />}
      {props.isRecording && !paused && <RecordingIndicator position="bottom-left" />}
    </View>
  );
}

function Action({ label, onPress, secondary = false, large = false, equalWidth = false }: {
  label: string; onPress: () => void; secondary?: boolean; large?: boolean; equalWidth?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondary,
        large && styles.largeButton, equalWidth && styles.equalButton, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryText,
        large && styles.largeButtonText, equalWidth && styles.answerButtonText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, backgroundColor: colors.surface, borderWidth: 6,
    borderColor: colors.roundBorder, borderRadius: radius.xl, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.md, gap: spacing.md },
  clock: { ...typography.title, color: colors.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  deck: { flex: 1, ...typography.body, color: colors.muted, textAlign: 'right',
    textTransform: 'uppercase' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  cardArea: { flex: 1, minHeight: 0 },
  byline: { ...typography.body, fontSize: 21, lineHeight: 28,
    fontFamily: 'Inter_700Bold', color: colors.muted, textAlign: 'center' },
  title: { ...typography.hero, color: colors.play, textAlign: 'center' },
  revealArea: { width: '100%', maxWidth: 420, marginTop: spacing.lg },
  largeButton: { minHeight: 112, paddingVertical: spacing.xl },
  largeButtonText: { ...typography.title, color: colors.white, textAlign: 'center' },
  footer: { padding: spacing.md, gap: spacing.md },
  recordingFooter: { paddingBottom: 62 },
  recordingSpace: { height: 48 },
  actions: { flexDirection: 'row', gap: spacing.md },
  button: { flexShrink: 1, flexGrow: 1, minHeight: 56, padding: spacing.md,
    justifyContent: 'center', alignItems: 'center', backgroundColor: colors.play, borderRadius: radius.lg },
  secondary: { flexGrow: 0, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  equalButton: { flexGrow: 1, flexBasis: 0, minHeight: 80,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.sm },
  answerButtonText: { fontSize: 22, lineHeight: 28 },
  buttonText: { ...typography.body, fontFamily: 'Inter_900Black', color: colors.white, textAlign: 'center' },
  secondaryText: { color: colors.ink },
  pressed: { opacity: 0.75 },
});

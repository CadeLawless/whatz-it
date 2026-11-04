import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { CloseButton } from '@/components/close-button';
import { HandoffTapCue } from '@/components/handoff-tap-cue';
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
  const paused = status === 'paused';
  if (status === 'feedback') {
    return <PortraitRoundFeedback outcome={props.outcome === 'correct' ? 'correct' : 'pass'} passLabel="SKIP" />;
  }
  if (status === 'handoff') {
    return <View style={styles.handoff}>
      <Pressable accessibilityRole="button" accessibilityLabel="Next player: tap anywhere to reveal your card"
        onPress={props.onReveal} style={StyleSheet.absoluteFill}>
        <View pointerEvents="none" style={styles.handoffBody}>
          <Text style={styles.handoffClock}>{props.clock}</Text>
          <View style={styles.handoffMessage}>
            <Text accessibilityRole="header" style={styles.handoffTitle}>Pass the phone then tap the screen</Text>
            <HandoffTapCue />
          </View>
        </View>
      </Pressable>
      {/* A sibling of the reveal target, so closing never reveals a card. */}
      <View pointerEvents="box-none" style={styles.handoffHeader}>
        <CloseButton accessibilityLabel="End round early" onPress={props.onClose} />
      </View>
    </View>;
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
                <Text style={styles.clueInstruction}>
                  Try to get your friends to guess this answer.
                </Text>
              </>
            ) : (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  {paused ? 'Round paused' : 'GET READY'}
                </Text>
              </>
            )}
          </View>
        </View>
      </GestureDetector>
      {status === 'playing' && (
        <View key="answer-actions" style={[styles.footer, props.isRecording && styles.recordingFooter]}>
          <View style={styles.actions}>
            <View style={styles.actionColumn}>
              <Action label="SKIP" onPress={props.onPass} secondary equalWidth />
            </View>
            <View style={styles.actionColumn}>
              <Action label="CORRECT" onPress={props.onCorrect} equalWidth nextCard />
            </View>
          </View>
        </View>
      )}
      {paused && (
        <View key="paused-actions" style={styles.footer}>
          <Action label="Resume" onPress={props.onResume} />
          <Action label="End round" onPress={props.onFinish} secondary />
        </View>
      )}
      {props.isRecording && !paused && <RecordingIndicator position="bottom-left" />}
    </View>
  );
}

function Action({ label, onPress, secondary = false, equalWidth = false, nextCard = false }: {
  label: string; onPress: () => void; secondary?: boolean; equalWidth?: boolean; nextCard?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={nextCard ? 'Score this answer as correct, then pass the phone to the next player.' : undefined}
      style={({ pressed }) => [styles.button, secondary && styles.secondary,
        equalWidth && styles.equalButton, pressed && styles.pressed]}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
        style={[styles.buttonText, secondary && styles.secondaryText,
        equalWidth && styles.answerButtonText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  handoff: { flex: 1, backgroundColor: colors.play },
  handoffHeader: { position: 'absolute', top: spacing.md * 2, left: spacing.md * 2 },
  handoffBody: { flex: 1, padding: spacing.xl, paddingTop: 96 },
  handoffClock: { ...typography.title, fontSize: 42, lineHeight: 50,
    color: colors.white, textAlign: 'center', fontVariant: ['tabular-nums'] },
  handoffMessage: { flex: 1, justifyContent: 'center', gap: spacing.md, paddingBottom: spacing.xxl },
  handoffTitle: { ...typography.hero, color: colors.white, textAlign: 'center' },
  panel: { flex: 1, minHeight: 0, backgroundColor: colors.surface, borderWidth: 6,
    borderColor: colors.roundBorder, borderRadius: radius.xl, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.md, gap: spacing.md },
  clock: { ...typography.title, color: colors.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  deck: { flex: 1, ...typography.body, color: colors.muted, textAlign: 'right',
    textTransform: 'uppercase' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  cardArea: { flex: 1, minHeight: 0 },
  clueInstruction: { ...typography.body, fontSize: 14, lineHeight: 20,
    color: colors.muted, textAlign: 'center', paddingHorizontal: spacing.sm },
  byline: { ...typography.body, fontSize: 21, lineHeight: 28,
    fontFamily: 'Inter_700Bold', color: colors.muted, textAlign: 'center' },
  title: { ...typography.hero, color: colors.play, textAlign: 'center' },
  footer: { padding: spacing.md, gap: spacing.md },
  recordingFooter: { paddingBottom: 62 },
  actions: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  actionColumn: { flex: 1, minWidth: 0, gap: spacing.xs },
  button: { flexShrink: 1, flexGrow: 1, minHeight: 56, padding: spacing.md,
    justifyContent: 'center', alignItems: 'center', backgroundColor: colors.play, borderRadius: radius.lg },
  secondary: { flexGrow: 0, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  equalButton: { minHeight: 80,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.sm },
  answerButtonText: { fontSize: 22, lineHeight: 28 },
  buttonText: { ...typography.body, fontFamily: 'Inter_900Black', color: colors.white, textAlign: 'center' },
  secondaryText: { color: colors.ink },
  pressed: { opacity: 0.75 },
});

import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';

export function PortraitAnswerText({ text }: { text: string }) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const [widestWordWidth, setWidestWordWidth] = useState(0);
  const fontSize = availableWidth && widestWordWidth
    ? Math.max(1, Math.min(typography.hero.fontSize,
      typography.hero.fontSize * (availableWidth - 12) / widestWordWidth))
    : typography.hero.fontSize;
  const scale = fontSize / typography.hero.fontSize;

  return <>
    <Text style={[styles.answer, {
      fontSize, lineHeight: typography.hero.lineHeight * scale,
      letterSpacing: typography.hero.letterSpacing * scale,
      opacity: availableWidth && widestWordWidth ? 1 : 0,
    }]} onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}>
      {text}
    </Text>
    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      pointerEvents="none" style={[styles.answer, styles.wordMeasure]}
      onTextLayout={(event) => setWidestWordWidth(Math.max(
        0, ...event.nativeEvent.lines.map((line) => line.width),
      ))}>
      {text.trim().split(/\s+/u).join('\n')}
    </Text>
  </>;
}

export function PortraitRoundFeedback({ outcome }: { outcome: 'correct' | 'pass' }) {
  const correct = outcome === 'correct';
  const tint = correct ? colors.correctText : colors.passText;
  return <View style={[styles.takeover, { backgroundColor: correct ? colors.correct : colors.pass }]}>
    {correct ? <SymbolView accessibilityElementsHidden
      name={{ android: 'check', ios: 'checkmark', web: 'check' }}
      size={112} tintColor={tint} style={styles.checkIcon} /> :
      <Text accessibilityElementsHidden style={[styles.feedbackIcon, { color: tint }]}>×</Text>}
    <Text accessibilityRole="header" style={[styles.feedbackTitle, { color: tint }]}>
      {correct ? 'CORRECT!' : 'PASS'}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  answer: { ...typography.hero, width: '100%', color: colors.play, textAlign: 'center' },
  wordMeasure: { position: 'absolute', width: 10000, opacity: 0 },
  takeover: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  checkIcon: { width: 112, height: 130 },
  feedbackIcon: { fontSize: 124, lineHeight: 130, fontFamily: 'Inter_700Bold' },
  feedbackTitle: { ...typography.hero, fontWeight: '900', textAlign: 'center' },
});

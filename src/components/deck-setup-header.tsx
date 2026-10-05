import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, radius, spacing } from '@/theme';

export function DeckSetupHeader({ backLabel, onBack, onSharePlay }: {
  backLabel: string; onBack: () => void; onSharePlay?: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const compactBack = !!onSharePlay && (width < 400 || fontScale > 1.1);
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back_ios_new', web: 'arrow_back_ios_new' }} size={18} tintColor="#000000" accessibilityElementsHidden />
        {fontScale <= 1.6 && <Text style={styles.backText}>{compactBack ? 'Back' : backLabel}</Text>}
      </Pressable>
      {onSharePlay && <Pressable accessibilityRole="button" accessibilityLabel="SharePlay" accessibilityHint="Invite friends to play over FaceTime" onPress={onSharePlay} style={({ pressed }) => [styles.button, styles.shareButton, pressed && styles.pressed]}>
        <SymbolView name="shareplay" size={20} tintColor={colors.white} accessibilityElementsHidden />
        <Text maxFontSizeMultiplier={2} style={styles.shareText}>SharePlay</Text>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  button: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, shadowColor: '#64748B', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.16, shadowRadius: 12, elevation: 5 },
  backText: { color: '#000000', fontSize: 17, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  shareButton: { backgroundColor: '#4BCDFD' },
  shareText: { color: colors.white, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  pressed: { opacity: 0.7 },
});

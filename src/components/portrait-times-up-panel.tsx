import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme';

export function PortraitTimesUpPanel() {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" adjustsFontSizeToFit maxFontSizeMultiplier={1}
        minimumFontScale={0.8} numberOfLines={1} style={styles.title}>
        TIME&apos;S UP!
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minHeight: 0, borderWidth: 6, borderColor: colors.playBorder,
    borderRadius: 28, backgroundColor: colors.play, alignItems: 'center', justifyContent: 'center' },
  title: { maxWidth: '100%', paddingHorizontal: spacing.xl, color: colors.white,
    fontSize: 48, lineHeight: 56, fontFamily: 'Inter_900Black', fontWeight: '900', textAlign: 'center' },
});

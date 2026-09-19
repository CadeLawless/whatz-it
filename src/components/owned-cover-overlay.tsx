import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme';

export function OwnedCoverOverlay() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.overlay}
    >
      <View style={styles.badge}>
        <Text style={styles.badgeText}>OWNED</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.57)',
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.white,
    borderRadius: 99,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  badgeText: {
    color: colors.white,
    fontSize: 13,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});

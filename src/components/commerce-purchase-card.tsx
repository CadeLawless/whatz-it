import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/theme';
import {
  commercePresentation,
  type CommerceProductState,
  type CommerceTarget,
} from '@/storefront/commerce-state';

type CommercePurchaseCardProps = {
  onOwned?: () => void;
  onPurchase?: () => void;
  onRetry?: () => void;
  state: CommerceProductState;
  style?: StyleProp<ViewStyle>;
  target: CommerceTarget;
};

export function CommercePurchaseCard({
  onOwned,
  onPurchase,
  onRetry,
  state,
  style,
  target,
}: CommercePurchaseCardProps) {
  const presentation = commercePresentation(state, target);
  const onPress =
    state.status === 'owned' && onOwned
      ? onOwned
      : presentation.action === 'purchase'
      ? onPurchase
      : presentation.action === 'retry'
        ? onRetry
        : undefined;
  const disabled = onPress === undefined;
  const buttonLabel =
    state.status === 'owned' && onOwned
      ? target.kind === 'deck'
        ? 'PLAY DECK'
        : 'VIEW BUNDLE'
      : presentation.buttonLabel;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.card, styles[`${presentation.tone}Card`], style]}
    >
      <Text style={styles.title}>{presentation.title}</Text>
      <Text style={styles.copy}>{presentation.copy}</Text>
      <Pressable
        accessibilityLabel={buttonLabel}
        accessibilityRole="button"
        accessibilityState={{ busy: presentation.busy, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          styles[`${presentation.tone}Button`],
          disabled && styles.disabledButton,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <Text style={styles.buttonText}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  mutedCard: {},
  primaryCard: { backgroundColor: '#EEF4FF' },
  successCard: { backgroundColor: '#EFF9E4' },
  warningCard: { backgroundColor: '#FFF4E8' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    borderRadius: radius.pill,
  },
  mutedButton: { backgroundColor: '#CBD5E1' },
  primaryButton: { backgroundColor: colors.play },
  successButton: { backgroundColor: colors.correctText },
  warningButton: { backgroundColor: colors.pass },
  disabledButton: { opacity: 0.72 },
  buttonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});

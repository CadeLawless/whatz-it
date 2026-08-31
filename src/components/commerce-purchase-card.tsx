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
  purchaseLabel?: string;
  state: CommerceProductState;
  showTargetTitle?: boolean;
  style?: StyleProp<ViewStyle>;
  target: CommerceTarget;
};

export function CommercePurchaseCard({
  onOwned,
  onPurchase,
  onRetry,
  purchaseLabel,
  state,
  showTargetTitle = false,
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
      : presentation.action === 'purchase' && purchaseLabel
        ? purchaseLabel
      : presentation.buttonLabel;
  const accessibilityLabel = showTargetTitle
    ? `${buttonLabel}, ${target.title}`
    : buttonLabel;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={style}
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ busy: presentation.busy, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          showTargetTitle && styles.buttonWithTargetTitle,
          styles[`${presentation.tone}Button`],
          disabled && styles.disabledButton,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <Text style={styles.buttonText}>{buttonLabel}</Text>
        {showTargetTitle && (
          <Text numberOfLines={1} style={styles.targetTitle}>
            {target.title}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  buttonWithTargetTitle: {
    minHeight: 58,
    gap: 2,
  },
  mutedButton: { backgroundColor: '#CBD5E1' },
  primaryButton: { backgroundColor: colors.play },
  successButton: { backgroundColor: colors.correctText },
  warningButton: { backgroundColor: colors.pass },
  disabledButton: { opacity: 0.72 },
  buttonText: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 18,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  targetTitle: {
    maxWidth: '90%',
    color: colors.white,
    fontSize: 13,
    lineHeight: 16,
    fontFamily: 'Inter_600SemiBold',
    fontWeight: '600',
  },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});

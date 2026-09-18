import { useState } from 'react';
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
  comparisonKind?: 'bundle' | 'individual-decks' | null;
  comparisonPrice?: string | null;
  onOwned?: () => void;
  onPurchase?: () => void;
  onRetry?: () => void;
  purchaseLabel?: string;
  purchaseHint?: string | null;
  primaryColor?: 'brand' | 'blue';
  state: CommerceProductState;
  showTargetTitle?: boolean;
  style?: StyleProp<ViewStyle>;
  target: CommerceTarget;
};

export function CommercePurchaseCard({
  comparisonKind,
  comparisonPrice,
  onOwned,
  onPurchase,
  onRetry,
  purchaseLabel,
  purchaseHint,
  primaryColor = 'brand',
  state,
  showTargetTitle = false,
  style,
  target,
}: CommercePurchaseCardProps) {
  const presentation = commercePresentation(state, target);
  const defaultPurchaseLabel = purchaseLabel ?? `BUY ${target.kind.toUpperCase()}`;
  const currentPurchaseLabel =
    presentation.action === 'purchase'
      ? purchaseLabel ?? presentation.buttonLabel
      : null;
  const [stablePurchaseLabel, setStablePurchaseLabel] = useState(
    currentPurchaseLabel ?? defaultPurchaseLabel,
  );
  const handlePurchase =
    currentPurchaseLabel && onPurchase
      ? () => {
          setStablePurchaseLabel(currentPurchaseLabel);
          onPurchase();
        }
      : undefined;

  const onPress =
    state.status === 'owned' && onOwned
      ? onOwned
      : presentation.action === 'purchase'
      ? handlePurchase
      : presentation.action === 'retry'
        ? onRetry
        : undefined;
  const disabled = onPress === undefined;
  const buttonLabel =
    state.status === 'owned'
      ? onOwned
        ? target.kind === 'deck'
          ? 'PLAY DECK'
          : 'VIEW BUNDLE'
        : presentation.buttonLabel
      : presentation.action === 'retry' || state.status === 'unavailable'
        ? presentation.buttonLabel
        : presentation.action === 'purchase' && currentPurchaseLabel
          ? currentPurchaseLabel
          : stablePurchaseLabel;
  const accessibilityLabel = showTargetTitle
    ? `${buttonLabel}, ${target.title}`
    : buttonLabel;
  const showWarningCopy = presentation.tone === 'warning';
  const showPurchaseOffer = presentation.action === 'purchase' && Boolean(comparisonPrice && purchaseHint);
  const priceSuffix = showPurchaseOffer && state.status === 'available'
    ? state.localizedPrice
    : null;
  const visibleButtonLabel = priceSuffix ? `BUY ${target.kind.toUpperCase()}` : buttonLabel;
  const comparisonDescription = comparisonKind === 'individual-decks'
    ? 'for decks bought separately'
    : 'for the regular bundle';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={style}
    >
      {showWarningCopy && (
        <View style={styles.warningCopy}>
          <Text selectable style={styles.warningTitle}>
            {presentation.title}
          </Text>
          <Text selectable style={styles.warningBody}>
            {presentation.copy}
          </Text>
        </View>
      )}
      {showPurchaseOffer && (
        <Text style={styles.purchaseHint}>{purchaseHint}</Text>
      )}
      <Pressable
        accessibilityLabel={priceSuffix ? `${visibleButtonLabel}, ${comparisonPrice} ${comparisonDescription}, now ${priceSuffix}${showTargetTitle ? `, ${target.title}` : ''}` : accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ busy: presentation.busy, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          showTargetTitle && styles.buttonWithTargetTitle,
          styles[`${presentation.tone}Button`],
          presentation.tone === 'primary' && primaryColor === 'blue' && styles.bluePrimaryButton,
          disabled && styles.disabledButton,
          pressed && !disabled && styles.pressed,
        ]}
      >
        {priceSuffix ? (
          <View style={styles.offerButtonContent}>
            <Text style={styles.buttonText}>{visibleButtonLabel}</Text>
            <View style={styles.offerPrices}>
              <Text style={styles.comparisonPrice}>{comparisonPrice}</Text>
              <Text style={styles.buttonText}>{priceSuffix}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        )}
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
  purchaseHint: {
    color: colors.pass,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  warningCopy: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  warningTitle: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    textAlign: 'center',
  },
  warningBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Inter_500Medium',
    fontWeight: '500',
    textAlign: 'center',
  },
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
  primaryButton: { backgroundColor: colors.pass },
  bluePrimaryButton: { backgroundColor: colors.play },
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
  offerButtonContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.sm,
    rowGap: 2,
  },
  offerPrices: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  comparisonPrice: {
    color: '#FFD0AD',
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
    textDecorationLine: 'line-through',
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

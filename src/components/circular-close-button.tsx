import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';

type CircularCloseButtonProps = {
  accessibilityLabel: string;
  appearance?: 'overlay' | 'sheet';
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function CircularCloseButton({
  accessibilityLabel,
  appearance = 'overlay',
  onPress,
  style,
}: CircularCloseButtonProps) {
  const isSheet = appearance === 'sheet';

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isSheet && styles.sheetButton,
        style,
        pressed && styles.pressed,
      ]}
    >
      <Text
        accessibilityElementsHidden
        style={[styles.icon, isSheet && styles.sheetIcon]}
      >
        {'\u00D7'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    zIndex: 20,
    elevation: 20,
  },
  icon: {
    color: '#FFFFFF',
    fontSize: 42,
    lineHeight: 42,
    fontWeight: '900',
  },
  sheetButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(100, 116, 139, 0.11)',
    elevation: 0,
  },
  sheetIcon: {
    color: '#64748B',
    fontSize: 32,
    lineHeight: 32,
    fontWeight: '600',
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});

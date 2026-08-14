import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';

type CircularCloseButtonProps = {
  accessibilityLabel: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function CircularCloseButton({
  accessibilityLabel,
  onPress,
  style,
}: CircularCloseButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        style,
        pressed && styles.pressed,
      ]}
    >
      <Text accessibilityElementsHidden style={styles.icon}>
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
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});

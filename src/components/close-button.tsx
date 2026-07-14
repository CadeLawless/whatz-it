import { Pressable, StyleSheet, View } from 'react-native';

type CloseButtonProps = {
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
};

export function CloseButton({ accessibilityLabel, disabled, onPress }: CloseButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={[styles.bar, styles.barForward]} />
      <View style={[styles.bar, styles.barBackward]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4BCBFD',
  },
  bar: {
    position: 'absolute',
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#000000',
  },
  barForward: { transform: [{ rotate: '45deg' }] },
  barBackward: { transform: [{ rotate: '-45deg' }] },
  pressed: { opacity: 0.76, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.45 },
});

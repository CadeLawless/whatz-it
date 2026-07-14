import { StatusBar } from 'expo-status-bar';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

type OrientationTransitionProps = {
  style?: StyleProp<ViewStyle>;
};

export function PortraitTransition({ style }: OrientationTransitionProps) {
  return (
    <View accessibilityLabel="Returning to portrait" style={[styles.portraitContainer, style]}>
      <StatusBar hidden animated={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  portraitContainer: { backgroundColor: colors.background },
});

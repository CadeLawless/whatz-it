import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

type OrientationTransitionProps = {
  style?: StyleProp<ViewStyle>;
};

export function OrientationTransition({ style }: OrientationTransitionProps) {
  return (
    <View accessibilityLabel="Turning sideways" style={[styles.container, style]}>
      <StatusBar hidden animated={false} />
      <Image
        accessibilityLabel="Goose shuffling cards"
        autoplay
        contentFit="contain"
        source={require('../../assets/images/goose-shuffling.gif')}
        style={styles.animation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.play,
  },
  animation: { width: 230, height: 230 },
});

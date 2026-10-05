import { StyleSheet, Text } from 'react-native';
import type { RemoteView } from '@/shareplay/remote-round';
import { colors } from '@/theme';

export function SharePlayReadyCounter({ view }: { view: Pick<RemoteView, 'ready' | 'participants'> }) {
  const ready = view.participants.filter((id) => view.ready.includes(id)).length;
  return <Text accessibilityLiveRegion="polite" style={styles.counter}>
    {ready} OF {view.participants.length} READY
  </Text>;
}

const styles = StyleSheet.create({
  counter: { color: colors.play, fontSize: 14, fontFamily: 'Inter_900Black',
    letterSpacing: 0.6, textAlign: 'center' },
});

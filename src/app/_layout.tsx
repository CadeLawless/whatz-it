import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { RoundProvider } from '@/game/round-context';
import { ScreenshotTransitionProvider } from '@/components/screenshot-transition-provider';
import { RoundSoundProvider } from '@/video/round-sound-provider';
import { logRoundDiagnostic, warnRoundDiagnostic } from '@/video/video-diagnostics';
import { loadHomeBranding } from '@/utils/home-branding';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    void loadHomeBranding()
      .catch(() => undefined)
      .finally(() => setIsReady(true));
  }, []);

  useEffect(() => {
    logRoundDiagnostic('root audio mode configuration started');
    setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    })
      .then(() => logRoundDiagnostic('root audio mode configuration completed'))
      .catch((error) => warnRoundDiagnostic('root audio mode configuration failed', error));
  }, []);

  const handleRootLayout = useCallback(() => {
    if (isReady) SplashScreen.hide();
  }, [isReady]);

  if (!isReady) return null;

  return (
    <View onLayout={handleRootLayout} style={styles.root}>
      <SafeAreaProvider>
      <RoundSoundProvider>
        <ScreenshotTransitionProvider>
          <RoundProvider>
          <StatusBar style="dark" />
          <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: '800' },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            animation: 'none',
            headerShown: false,
            orientation: 'portrait',
            title: 'Back to Decks',
          }}
        />
        <Stack.Screen
          name="deck/[deckId]"
          options={({ route }) => ({
            animation:
              (route.params as { transition?: string } | undefined)?.transition === 'apple-slide'
                ? 'default'
                : 'none',
            title: 'Choose your round',
            orientation: 'portrait',
            headerBackTitle: 'Back to Decks',
          })}
        />
        <Stack.Screen
          name="ready"
          options={{
            headerShown: false,
            gestureEnabled: false,
            animation: 'none',
            orientation: 'portrait',
          }}
        />
        <Stack.Screen
          name="game"
          options={{
            headerShown: false,
            gestureEnabled: false,
            animation: 'none',
            orientation: 'landscape_right',
          }}
        />
        <Stack.Screen
          name="results"
          options={{
            headerShown: false,
            gestureEnabled: false,
            animation: 'none',
            orientation: 'portrait',
          }}
        />
          </Stack>
          </RoundProvider>
        </ScreenshotTransitionProvider>
      </RoundSoundProvider>
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

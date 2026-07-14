import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { RoundProvider } from '@/game/round-context';
import { ScreenshotTransitionProvider } from '@/components/screenshot-transition-provider';

export default function RootLayout() {
  useEffect(() => {
    setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, []);

  return (
    <SafeAreaProvider>
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
            orientation: 'portrait',
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
    </SafeAreaProvider>
  );
}

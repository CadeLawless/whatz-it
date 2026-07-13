import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { RoundProvider } from '@/game/round-context';

export default function RootLayout() {
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false }).catch(() => undefined);
  }, []);

  return (
    <SafeAreaProvider>
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
          options={{ headerShown: false, orientation: 'portrait', title: 'Back to Decks' }}
        />
        <Stack.Screen
          name="deck/[deckId]"
          options={{
            title: 'Choose your round',
            orientation: 'portrait',
            headerBackTitle: 'Back to Decks',
          }}
        />
        <Stack.Screen
          name="ready"
          options={{
            headerShown: false,
            gestureEnabled: false,
            animation: 'none',
          }}
        />
        <Stack.Screen
          name="game"
          options={{
            headerShown: false,
            gestureEnabled: false,
            animation: 'none',
          }}
        />
        <Stack.Screen
          name="results"
          options={{ headerShown: false, gestureEnabled: false, orientation: 'portrait' }}
        />
        </Stack>
      </RoundProvider>
    </SafeAreaProvider>
  );
}

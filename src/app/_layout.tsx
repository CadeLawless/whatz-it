import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme';
import { RoundProvider } from '@/game/round-context';

export default function RootLayout() {
  return (
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
            orientation: 'landscape',
            animation: 'none',
          }}
        />
        <Stack.Screen
          name="game"
          options={{
            headerShown: false,
            gestureEnabled: false,
            orientation: 'landscape',
            animation: 'none',
          }}
        />
        <Stack.Screen
          name="results"
          options={{ headerShown: false, gestureEnabled: false, orientation: 'portrait' }}
        />
      </Stack>
    </RoundProvider>
  );
}

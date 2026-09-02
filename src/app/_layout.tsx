import { Inter_300Light } from '@expo-google-fonts/inter/300Light';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { Inter_900Black } from '@expo-google-fonts/inter/900Black';
import { useFonts } from 'expo-font';
import { NavigationBar } from 'expo-navigation-bar';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { CatalogProvider, useCatalog } from '@/catalog/catalog-provider';
import { RoundProvider } from '@/game/round-context';
import { ScreenshotTransitionProvider } from '@/components/screenshot-transition-provider';
import { RoundSoundProvider } from '@/video/round-sound-provider';
import { StoreCommerceProvider } from '@/storefront/store-commerce-provider';
import {
  consumeSettingsReturnRequest,
  settingsPermissionsChanged,
} from '@/storage/settings-return';
import { initializeRoundVideoStorage } from '@/video/round-videos';
import { loadHomeBranding } from '@/utils/home-branding';
import { getSettingsPermissionSnapshot } from '@/utils/settings-permission-snapshot';
import { platformReleaseCapabilities } from '@/release/platform-release';
import {
  initializeFlightRecorder,
  markFlightRecorderExpectedExit,
  recordFlightRecorderMemoryWarning,
  setFlightRecorderAppState,
  setFlightRecorderRoute,
} from '@/utils/flight-recorder';

void SplashScreen.preventAutoHideAsync();

const releaseCapabilities = platformReleaseCapabilities(Platform.OS);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });
  if (!fontsLoaded && !fontError) return null;

  const content = <RootLayoutContent />;

  return (
    <CatalogProvider>
      {releaseCapabilities.nativeStoreCommerce ? (
        <StoreCommerceProvider>{content}</StoreCommerceProvider>
      ) : content}
    </CatalogProvider>
  );
}

function RootLayoutContent() {
  const { catalog, status: catalogStatus } = useCatalog();
  const [isReady, setIsReady] = useState(false);
  const [rootHasLaidOut, setRootHasLaidOut] = useState(false);
  const [settingsReturnDeckId, setSettingsReturnDeckId] =
    useState<string | null | undefined>(undefined);
  const settingsReturnHandled = useRef(false);
  const settingsReturnPath = settingsReturnDeckId
    ? `/deck/${encodeURIComponent(settingsReturnDeckId)}`
    : settingsReturnDeckId;
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    initializeFlightRecorder();
    void initializeRoundVideoStorage();
    const appStateSubscription = AppState.addEventListener('change', setFlightRecorderAppState);
    const memoryWarningSubscription = AppState.addEventListener(
      'memoryWarning',
      recordFlightRecorderMemoryWarning,
    );
    return () => {
      appStateSubscription.remove();
      memoryWarningSubscription.remove();
      markFlightRecorderExpectedExit('root-layout-unmounted');
    };
  }, []);

  useEffect(() => {
    setFlightRecorderRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    if (catalogStatus === 'loading') return;
    void Promise.all([
      loadHomeBranding().catch(() => undefined),
      getSettingsReturnDeckId().catch(() => null),
    ]).then(([, deckId]) => {
      setSettingsReturnDeckId(
        deckId && catalog.getDeckById(deckId) ? deckId : null,
      );
      setIsReady(true);
    });
  }, [catalog, catalogStatus]);

  useEffect(() => {
    if (
      !isReady ||
      settingsReturnPath === undefined ||
      settingsReturnHandled.current
    ) {
      return;
    }
    settingsReturnHandled.current = true;
    if (
      settingsReturnDeckId &&
      settingsReturnPath &&
      pathname !== settingsReturnPath
    ) {
      router.push({
        pathname: '/deck/[deckId]',
        params: {
          deckId: settingsReturnDeckId,
          transition: 'settings-restore',
        },
      });
    }
  }, [
    isReady,
    pathname,
    router,
    settingsReturnDeckId,
    settingsReturnPath,
  ]);

  useEffect(() => {
    if (
      rootHasLaidOut &&
      isReady &&
      settingsReturnPath !== undefined &&
      (!settingsReturnPath || pathname === settingsReturnPath)
    ) {
      SplashScreen.hide();
    }
  }, [isReady, pathname, rootHasLaidOut, settingsReturnPath]);

  const handleRootLayout = useCallback(() => {
    setRootHasLaidOut(true);
  }, []);

  if (!isReady || settingsReturnPath === undefined) return null;

  return (
    <GestureHandlerRootView onLayout={handleRootLayout} style={styles.root}>
      <SafeAreaProvider>
      <RoundSoundProvider>
        <ScreenshotTransitionProvider>
          <RoundProvider>
          <StatusBar style="dark" />
          {/* One route-based owner keeps the controls hidden across Ready → Game
              and restores them on Results, cancellation, or returning to decks. */}
          {Platform.OS === 'android' && (
            <NavigationBar hidden={pathname === '/ready' || pathname === '/game'} />
          )}
          <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
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
          listeners={({ navigation, route }) => ({
            transitionEnd: (event) => {
              const transition = (
                route.params as { transition?: string } | undefined
              )?.transition;
              if (!event.data.closing && transition === 'settings-restore') {
                navigation.setParams({ transition: 'apple-slide' });
              }
            },
          })}
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
        <Stack.Protected guard={releaseCapabilities.storefront}>
          <Stack.Screen
            name="store/deck/[deckId]"
            options={{
              headerShown: false,
              orientation: 'portrait',
              title: 'Deck details',
            }}
          />
          <Stack.Screen
            name="store/bundles-for-deck/[deckId]"
            options={{
              animation: 'none',
              contentStyle: { backgroundColor: 'transparent' },
              gestureEnabled: false,
              headerShown: false,
              presentation: 'transparentModal',
              title: 'Bundles',
            }}
          />
          <Stack.Screen
            name="store/bundle/[bundleId]"
            options={{
              headerShown: false,
              orientation: 'portrait',
              title: 'Bundle details',
            }}
          />
          <Stack.Screen
            name="store/deck-preview/[deckId]"
            options={{
              animation: 'none',
              contentStyle: { backgroundColor: 'transparent' },
              gestureEnabled: false,
              headerShown: false,
              presentation: 'transparentModal',
              title: 'Deck preview',
            }}
          />
        </Stack.Protected>
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
      </RoundSoundProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

async function getSettingsReturnDeckId() {
  const request = await consumeSettingsReturnRequest();
  if (!request) return null;
  if (request.source === 'explicit') return request.deckId;
  if (!request.permissions) return null;

  const currentPermissions = await getSettingsPermissionSnapshot();
  return settingsPermissionsChanged(request.permissions, currentPermissions)
    ? request.deckId
    : null;
}

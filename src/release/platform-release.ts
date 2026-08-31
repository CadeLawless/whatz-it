export type RuntimePlatform = 'android' | 'ios' | 'macos' | 'web' | 'windows';

export type PlatformReleaseCapabilities = {
  catalogUpdates: boolean;
  nativeStoreCommerce: boolean;
  storefront: boolean;
};

/**
 * Android launches as a self-contained free edition. Keep this policy in one
 * place so Google Play commerce can be enabled deliberately in a later release.
 */
export function platformReleaseCapabilities(
  platform: RuntimePlatform,
): PlatformReleaseCapabilities {
  const androidFreeEdition = platform === 'android';

  return {
    catalogUpdates: !androidFreeEdition,
    nativeStoreCommerce: platform === 'ios',
    storefront: !androidFreeEdition,
  };
}

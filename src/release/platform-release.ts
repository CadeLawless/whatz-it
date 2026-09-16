export type RuntimePlatform = 'android' | 'ios' | 'macos' | 'web' | 'windows';

export type PlatformReleaseCapabilities = {
  catalogUpdates: boolean;
  nativeStoreCommerce: boolean;
  storefront: boolean;
};

export function platformReleaseCapabilities(
  platform: RuntimePlatform,
): PlatformReleaseCapabilities {
  return {
    catalogUpdates: true,
    nativeStoreCommerce: platform === 'ios' || platform === 'android',
    storefront: true,
  };
}

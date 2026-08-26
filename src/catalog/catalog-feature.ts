export type CatalogRuntimeSource = 'bundled' | 'sqlite';

function developmentBuildDefault() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function configuredDevPreviewEnabled(
  value = process.env.EXPO_PUBLIC_DEV_PREVIEW,
  developmentBuild = developmentBuildDefault(),
) {
  return developmentBuild && value === 'enabled';
}

export function configuredDevPreviewKey(
  value = process.env.EXPO_PUBLIC_DEV_PREVIEW_KEY,
  enabled = configuredDevPreviewEnabled(),
) {
  if (!enabled || !value || !/^[a-f0-9]{64}$/.test(value)) return null;
  return value;
}

export function configuredCatalogSource(
  value = process.env.EXPO_PUBLIC_CATALOG_SOURCE,
): CatalogRuntimeSource {
  if (value === undefined || value === '' || value === 'sqlite') return 'sqlite';
  return 'bundled';
}

export function configuredCatalogManifestUrl(
  value = process.env.EXPO_PUBLIC_CATALOG_MANIFEST_URL,
  syncValue = process.env.EXPO_PUBLIC_CATALOG_SYNC,
  developmentPreview = configuredDevPreviewEnabled(),
  developmentPreviewValue = process.env.EXPO_PUBLIC_DEV_PREVIEW_MANIFEST_URL,
) {
  if (!configuredCatalogSyncEnabled(syncValue)) return null;
  const selectedValue = developmentPreview ? developmentPreviewValue : value;
  if (!selectedValue) return null;
  try {
    const url = new URL(selectedValue);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function configuredCatalogSyncEnabled(
  value = process.env.EXPO_PUBLIC_CATALOG_SYNC,
) {
  return value !== 'disabled';
}

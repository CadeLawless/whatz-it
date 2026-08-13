export type CatalogRuntimeSource = 'bundled' | 'sqlite';

export function configuredCatalogSource(
  value = process.env.EXPO_PUBLIC_CATALOG_SOURCE,
): CatalogRuntimeSource {
  if (value === undefined || value === '' || value === 'sqlite') return 'sqlite';
  return 'bundled';
}

export function configuredCatalogManifestUrl(
  value = process.env.EXPO_PUBLIC_CATALOG_MANIFEST_URL,
) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

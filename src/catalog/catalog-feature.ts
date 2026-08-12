export type CatalogRuntimeSource = 'bundled' | 'sqlite';

export function configuredCatalogSource(
  value = process.env.EXPO_PUBLIC_CATALOG_SOURCE,
): CatalogRuntimeSource {
  return value === 'sqlite' ? 'sqlite' : 'bundled';
}

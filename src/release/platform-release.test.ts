import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { platformReleaseCapabilities } from './platform-release';

describe('platform release capabilities', () => {
  it('enables the catalog, storefront, and Google Play commerce on Android', () => {
    assert.deepEqual(platformReleaseCapabilities('android'), {
      catalogUpdates: true,
      nativeStoreCommerce: true,
      storefront: true,
    });
  });

  it('preserves the existing iOS storefront and commerce behavior', () => {
    assert.deepEqual(platformReleaseCapabilities('ios'), {
      catalogUpdates: true,
      nativeStoreCommerce: true,
      storefront: true,
    });
  });

  it('does not initialize native commerce on web', () => {
    assert.deepEqual(platformReleaseCapabilities('web'), {
      catalogUpdates: true,
      nativeStoreCommerce: false,
      storefront: true,
    });
  });
});

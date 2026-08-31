import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { platformReleaseCapabilities } from './platform-release';

describe('platform release capabilities', () => {
  it('ships Android as a frozen free edition', () => {
    assert.deepEqual(platformReleaseCapabilities('android'), {
      catalogUpdates: false,
      nativeStoreCommerce: false,
      storefront: false,
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

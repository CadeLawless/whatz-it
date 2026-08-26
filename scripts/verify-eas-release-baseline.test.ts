import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyEasReleaseBaseline } from './verify-eas-release-baseline';

describe('EAS production release baseline verification', () => {
  it('does not affect development and preview build profiles', async () => {
    let called = false;
    const result = await verifyEasReleaseBaseline({}, '/repository', async () => {
      called = true;
      return { current: true, revision: 43 };
    });

    assert.deepEqual(result, { status: 'skipped' });
    assert.equal(called, false);
  });

  it('requires the production manifest when the gate is enabled', async () => {
    await assert.rejects(
      verifyEasReleaseBaseline(
        { WHATZIT_VERIFY_RELEASE_BASELINE: 'enabled' },
        '/repository',
      ),
      /EXPO_PUBLIC_CATALOG_MANIFEST_URL environment variable is missing/,
    );
  });

  it('accepts a committed baseline that matches the active production revision', async () => {
    const result = await verifyEasReleaseBaseline(
      {
        WHATZIT_VERIFY_RELEASE_BASELINE: 'enabled',
        EXPO_PUBLIC_CATALOG_MANIFEST_URL: 'https://api.example.test/manifest',
      },
      '/repository',
      async (manifestUrl, repositoryRoot) => {
        assert.equal(manifestUrl, 'https://api.example.test/manifest');
        assert.equal(repositoryRoot, '/repository');
        return { current: true, revision: 47 };
      },
    );

    assert.deepEqual(result, { status: 'current', revision: 47 });
  });

  it('blocks production builds whose committed baseline is stale', async () => {
    await assert.rejects(
      verifyEasReleaseBaseline(
        {
          WHATZIT_VERIFY_RELEASE_BASELINE: 'enabled',
          CATALOG_MANIFEST_URL: 'https://api.example.test/manifest',
        },
        '/repository',
        async () => ({ current: false, revision: 48 }),
      ),
      /Bundled catalog is stale for production revision 48/,
    );
  });
});

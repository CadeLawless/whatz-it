import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  catalogRolloutSelectedDetails,
  catalogSyncCompletedDetails,
  catalogSyncFailedDetails,
} from './catalog-rollout-observability';
import { CatalogSyncError } from './catalog-sync';

describe('catalog rollout observability', () => {
  it('identifies bundled, local-only, and server-sync rollout cohorts', () => {
    assert.equal(
      catalogRolloutSelectedDetails('bundled', null, 42, 1).cohort,
      'bundled-fallback',
    );
    assert.equal(
      catalogRolloutSelectedDetails('sqlite', null, 42, 1).cohort,
      'sqlite-local-only',
    );
    assert.equal(
      catalogRolloutSelectedDetails(
        'sqlite',
        'https://api.example.test/manifest',
        42,
        1,
      ).cohort,
      'sqlite-server-sync',
    );
  });

  it('records successful updates without URLs or catalog content', () => {
    assert.deepEqual(
      catalogSyncCompletedDetails(
        {
          status: 'updated',
          revision: 43,
          downloadedDecks: 2,
          downloadedMedia: 3,
        },
        123.6,
      ),
      {
        durationMs: 124,
        downloadedDecks: 2,
        downloadedMedia: 3,
        revision: 43,
        status: 'updated',
      },
    );
  });

  it('records only a sanitized error class and retry schedule', () => {
    assert.deepEqual(
      catalogSyncFailedDetails(
        new CatalogSyncError('invalid_manifest', 'sensitive server response'),
        22.4,
        2,
        4_000,
      ),
      {
        durationMs: 22,
        errorCode: 'invalid_manifest',
        errorName: 'CatalogSyncError',
        retryAttempt: 2,
        retryDelayMs: 4_000,
      },
    );
  });
});

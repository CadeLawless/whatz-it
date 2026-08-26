import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCatalogSnapshot } from './catalog-snapshot';
import {
  buildCatalogSupportDiagnosticsText,
  buildCatalogSupportFallbackEmailUrl,
} from './catalog-support-diagnostics';

describe('catalog support diagnostics', () => {
  it('includes rollout and installed-version state without card content or secrets', () => {
    const catalog = buildCatalogSnapshot({
      schemaVersion: 5,
      revision: 43,
      source: 'sqlite',
      decks: [
        {
          id: 'starter',
          order: 1,
          title: 'Starter',
          description: 'Fixture',
          version: 2,
          access: 'free',
          cards: [{ id: 'secret-card', text: 'Never include this clue' }],
          tags: [],
          cardCount: 1,
          cardContentVersion: 3,
          installedContentVersion: 2,
          installationStatus: 'installed',
        },
        {
          id: 'paid',
          order: 1,
          title: 'Paid',
          description: 'Fixture',
          version: 1,
          access: 'paid',
          cards: [],
          tags: [],
          cardCount: 20,
          cardContentVersion: 1,
          installationStatus: 'failed',
        },
      ],
      bundleRecords: [],
      deckOrders: { free: ['starter'], paid: ['paid'] },
    });

    const diagnostics = buildCatalogSupportDiagnosticsText({
      appVersion: '1.0.0',
      catalog,
      platform: 'ios',
      rolloutCohort: 'sqlite-server-sync',
      syncErrorCode: 'invalid_manifest',
      syncStatus: 'failed',
    });

    assert.match(diagnostics, /Catalog: revision 43, schema 5, source sqlite/);
    assert.match(diagnostics, /starter: installed 2, desired 3/);
    assert.match(diagnostics, /paid: failed/);
    assert.doesNotMatch(diagnostics, /Never include this clue/);
    assert.doesNotMatch(diagnostics, /secret-card/);
    assert.doesNotMatch(diagnostics, /credential|receipt|token/i);
  });

  it('keeps the fallback email body clear of technical diagnostics', () => {
    const decoded = decodeURIComponent(
      buildCatalogSupportFallbackEmailUrl('support@example.test'),
    );

    assert.match(decoded, /Please describe what happened/);
    assert.doesNotMatch(decoded, /Catalog:|Rollout:|Sync:|Deck states:/);
  });
});

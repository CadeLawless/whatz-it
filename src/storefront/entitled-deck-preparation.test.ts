import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CommerceEntitlements } from './commerce-api';
import {
  EntitledDeckPreparationError,
  EntitledDeckPreparationQueue,
  entitlementsForPreparation,
} from './entitled-deck-preparation';

describe('entitled deck preparation queue', () => {
  it('finishes a new purchase without retrying an unrelated removed test deck', async () => {
    const entitlements = fixtureEntitlements(['fall-favorties', 'fall-favorites']);
    const calls: string[] = [];
    const queue = new EntitledDeckPreparationQueue(async (deckId: string) => {
      calls.push(deckId);
      if (deckId === 'fall-favorties') throw new Error('No published artifact');
    }, async () => undefined);
    const scoped = entitlementsForPreparation(entitlements, ['fall-favorites']);
    await queue.prepare('installation-1', scoped, undefined);
    assert.deepEqual(calls, ['fall-favorites']);
    assert.deepEqual(entitlements.deckIds, ['fall-favorties', 'fall-favorites']);
    assert.equal(scoped.products, entitlements.products);
    assert.equal(entitlementsForPreparation(entitlements), entitlements);
  });

  it('prepares all purchased bundle members while ignoring unrelated entitlements', async () => {
    const calls: string[] = [];
    const queue = new EntitledDeckPreparationQueue(async (deckId: string) => {
      calls.push(deckId);
    }, async () => undefined);
    await queue.prepare('installation-1', entitlementsForPreparation(
      fixtureEntitlements(['unrelated', 'deck-a', 'deck-b']), ['deck-a', 'deck-b'],
    ), undefined);
    assert.deepEqual(calls, ['deck-a', 'deck-b']);
  });

  it('does not reload the catalog for an empty entitlement set', async () => {
    let refreshes = 0;
    const queue = new EntitledDeckPreparationQueue(
      async () => undefined,
      async () => {
        refreshes += 1;
      },
    );

    await queue.prepare('installation-1', fixtureEntitlements([]), undefined);
    assert.equal(refreshes, 0);
  });

  it('deduplicates an identical entitlement batch already in flight', async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let refreshes = 0;
    const queue = new EntitledDeckPreparationQueue(
      async (deckId: string) => {
        calls.push(deckId);
        if (deckId === 'deck-a') await firstGate;
      },
      async () => {
        refreshes += 1;
      },
    );
    const entitlements = fixtureEntitlements(['deck-a', 'deck-b']);

    const first = queue.prepare('installation-1', entitlements, undefined);
    const duplicate = queue.prepare('installation-1', entitlements, undefined);
    assert.equal(first, duplicate);
    await Promise.resolve();
    assert.deepEqual(calls, ['deck-a']);

    releaseFirst();
    await Promise.all([first, duplicate]);
    assert.deepEqual(calls, ['deck-a', 'deck-b']);
    assert.equal(refreshes, 1);
  });

  it('continues preparing later bundle members and reports every failure', async () => {
    const calls: string[] = [];
    let refreshes = 0;
    const queue = new EntitledDeckPreparationQueue(
      async (deckId: string) => {
        calls.push(deckId);
        if (deckId === 'deck-b') throw new Error('interrupted');
      },
      async () => {
        refreshes += 1;
      },
    );

    await assert.rejects(
      queue.prepare(
        'installation-1',
        fixtureEntitlements(['deck-a', 'deck-b', 'deck-c']),
        undefined,
      ),
      (error: unknown) => {
        assert.ok(error instanceof EntitledDeckPreparationError);
        assert.deepEqual(error.failures.map((failure) => failure.deckId), ['deck-b']);
        return true;
      },
    );
    assert.deepEqual(calls, ['deck-a', 'deck-b', 'deck-c']);
    assert.equal(refreshes, 1);
  });

  it('serializes different batches so SQLite installation writes cannot overlap', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = new EntitledDeckPreparationQueue(
      async (deckId: string) => {
        events.push(`start:${deckId}`);
        if (deckId === 'deck-a') await firstGate;
        events.push(`end:${deckId}`);
      },
      async () => undefined,
    );

    const first = queue.prepare(
      'installation-1',
      fixtureEntitlements(['deck-a']),
      undefined,
    );
    const second = queue.prepare(
      'installation-1',
      fixtureEntitlements(['deck-b']),
      undefined,
    );
    await Promise.resolve();
    assert.deepEqual(events, ['start:deck-a']);

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, [
      'start:deck-a',
      'end:deck-a',
      'start:deck-b',
      'end:deck-b',
    ]);
  });
});

function fixtureEntitlements(deckIds: string[]): CommerceEntitlements {
  return {
    installationId: 'installation-1',
    products: [
      {
        productId: 'bundle-product',
        kind: 'bundle',
        targetId: 'bundle-a',
      },
    ],
    deckIds,
    verifiedAt: '2026-08-25T12:00:00Z',
  };
}

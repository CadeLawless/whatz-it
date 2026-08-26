import type { CommerceEntitlements } from './commerce-api';

export type EntitledDeckOwnershipSource = 'purchase' | 'bundle';

export type EntitledDeckPreparationFailure = {
  deckId: string;
  error: unknown;
};

export class EntitledDeckPreparationError extends Error {
  public constructor(
    public readonly failures: readonly EntitledDeckPreparationFailure[],
  ) {
    super(
      failures.length === 1
        ? `Deck ${failures[0].deckId} could not be prepared.`
        : `${failures.length} decks could not be prepared.`,
    );
    this.name = 'EntitledDeckPreparationError';
  }
}

type PreparationEntitlements = Pick<
  CommerceEntitlements,
  'deckIds' | 'products'
>;

export class EntitledDeckPreparationQueue<Context> {
  private readonly batches = new Map<string, Promise<void>>();
  private tail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly install: (
      deckId: string,
      ownershipSource: EntitledDeckOwnershipSource,
      context: Context,
    ) => Promise<void>,
    private readonly refreshCatalog: () => Promise<void>,
  ) {}

  public prepare(
    scope: string,
    entitlements: PreparationEntitlements,
    context: Context,
  ) {
    const key = preparationKey(scope, entitlements);
    const existing = this.batches.get(key);
    if (existing) return existing;

    const run = this.tail.then(
      () => this.run(entitlements, context),
      () => this.run(entitlements, context),
    );
    let tracked!: Promise<void>;
    tracked = run.finally(() => {
      if (this.batches.get(key) === tracked) this.batches.delete(key);
    });
    this.batches.set(key, tracked);
    this.tail = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }

  private async run(
    entitlements: PreparationEntitlements,
    context: Context,
  ) {
    const directlyOwnedDecks = new Set(
      entitlements.products
        .filter((product) => product.kind === 'deck')
        .map((product) => product.targetId),
    );
    const failures: EntitledDeckPreparationFailure[] = [];

    for (const deckId of new Set(entitlements.deckIds)) {
      try {
        await this.install(
          deckId,
          directlyOwnedDecks.has(deckId) ? 'purchase' : 'bundle',
          context,
        );
      } catch (error) {
        failures.push({ deckId, error });
      }
    }

    await this.refreshCatalog();
    if (failures.length > 0) throw new EntitledDeckPreparationError(failures);
  }
}

function preparationKey(
  scope: string,
  entitlements: PreparationEntitlements,
) {
  const directlyOwnedDecks = new Set(
    entitlements.products
      .filter((product) => product.kind === 'deck')
      .map((product) => product.targetId),
  );
  const decks = [...new Set(entitlements.deckIds)]
    .map((deckId) =>
      `${deckId}:${directlyOwnedDecks.has(deckId) ? 'purchase' : 'bundle'}`,
    )
    .sort();
  return `${scope}|${decks.join('|')}`;
}

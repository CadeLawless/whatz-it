import type { CatalogDeck } from '../catalog/catalog-snapshot';

// Only the owner supplies paid content. Invited participants need no ownership
// and must never receive a permanent catalog entitlement from the session.
export function canShareDeck(
  deck: Pick<CatalogDeck, 'id' | 'access' | 'installationStatus' | 'cards'> | undefined,
  ownedDeckIds: ReadonlySet<string>,
) {
  return !!deck && deck.installationStatus === 'installed' && deck.cards.length > 0 &&
    (deck.access === 'free' || ownedDeckIds.has(deck.id));
}

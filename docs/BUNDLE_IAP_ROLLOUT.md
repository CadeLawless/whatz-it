# Bundle IAP rollout and verification

## Store products to create

Create every item below as a non-consumable in App Store Connect and as a
non-consumable one-time product in Google Play. Prices remain store-managed;
choose each tier's price in the store consoles.

The compact Google IDs intentionally stay within Google Play's 40-character,
lowercase product-ID constraint; do not substitute the longer Apple IDs there.

| Bundle | Tier | App Store Connect ID | Google Play ID |
| --- | --- | --- | --- |
| Christianity | Full / owns 0 | `com.cadelawless.whatzit.bundle.christianity` | `wz.bundle.christianity` |
| Christianity | Owns 1 | `com.cadelawless.whatzit.bundle.christianity.owned_1` | `wz.bundle.christianity.owned_1` |
| Christianity | Owns 2 | `com.cadelawless.whatzit.bundle.christianity.owned_2` | `wz.bundle.christianity.owned_2` |
| Christianity | Owns 3 | `com.cadelawless.whatzit.bundle.christianity.owned_3` | `wz.bundle.christianity.owned_3` |
| On The Big Screen | Full / owns 0 | `com.cadelawless.whatzit.bundle.on_the_big_screen` | `wz.bundle.on_the_big_screen` |
| On The Big Screen | Owns 1 | `com.cadelawless.whatzit.bundle.on_the_big_screen.owned_1` | `wz.bundle.on_the_big_screen.owned_1` |
| On The Big Screen | Owns 2 | `com.cadelawless.whatzit.bundle.on_the_big_screen.owned_2` | `wz.bundle.on_the_big_screen.owned_2` |
| On The Big Screen | Owns 3 | `com.cadelawless.whatzit.bundle.on_the_big_screen.owned_3` | `wz.bundle.on_the_big_screen.owned_3` |

The catalog currently marks the new tier products and all Google products as
`draft`. After each product resolves in its store sandbox, change that mapping
to `available` and publish the catalog. The existing Apple full products remain
available. Android also needs Google products for the ten existing paid decks;
their compact `wz.deck.*` IDs are already recorded as draft in the catalog.
Those IDs are `wz.deck.lift_your_voice`, `wz.deck.worship_icons`,
`wz.deck.bible_characters`, `wz.deck.growing_up_christian`,
`wz.deck.accents_and_impressions`, `wz.deck.rom_com`,
`wz.deck.commercial_classics`, `wz.deck.movie_musicals`,
`wz.deck.action_movies`, and `wz.deck.dramas`.

For a future bundle of N decks, configure one full product and only the desired
`ownedDeckCountProducts` entries from 1 through N-1. An absent or non-available
tier deliberately selects the full product. Never create an N-owned tier.

## Entitlement and product-selection flow

On registration the device is bound to the active store. The server verifies
the Apple signed transaction or Google Play purchase token. For a new purchase,
it also checks that a discounted product's `owned_deck_count` exactly matches
the installation's current entitled members of that bundle.

The first successful processing of a store transaction copies the active
bundle membership into `purchase_deck_grants`. That snapshot is keyed by store,
original transaction, and deck. Re-processing is idempotent. Entitlement reads,
paid-content authorization, and restores join through this snapshot rather than
the bundle's current membership. A direct-deck purchase creates a one-deck
snapshot through the same path.

The app persists the server's explicit `deckIds`. For each current bundle it
counts the intersection with those IDs. Zero selects the full product, a
configured and available exact count selects that tier, a missing tier selects
the full product, and owning every current member disables purchase. The same
selected product is used to fetch the store's localized price, render Explore
and bundle details, and submit the purchase.

## Schema and deployment

Apply deck-platform migration
`008_bundle_purchase_snapshots_and_discount_tiers.sql` before deploying the new
API. It adds nullable `store_products.owned_deck_count` and the durable
`purchase_deck_grants` table. No historical entitlement backfill is included,
because paid IAP has not launched in production.

The app's local catalog schema moves to version 6. It stores Google product IDs,
available discount-tier maps, and a cache of verified deck entitlements. This
is an automatic additive SQLite migration.

Configure the backend with `WHATZIT_GOOGLE_PACKAGE_NAME` and an absolute
`WHATZIT_GOOGLE_SERVICE_ACCOUNT_PATH`. Grant that service account access to the
app in Play Console. Keep the JSON key outside the web root and source control.

## Sandbox / TestFlight checklist

Run each applicable case on both an iOS sandbox/TestFlight build and a Google
Play internal-test build:

1. With no owned members, confirm Explore and details show the localized full
   price and the full product is submitted.
2. Own one member directly; confirm the owns-1 product and its localized price
   appear in both places. Repeat with two and three owned members.
3. Temporarily leave a matching tier draft; confirm both screens and checkout
   use the full product.
4. Obtain a member from a different bundle and confirm it contributes exactly
   once to the current ownership count.
5. Own all current members; confirm the bundle shows owned and cannot be bought.
6. Cancel checkout and force a store/server verification failure; confirm no
   deck becomes available.
7. Complete a bundle purchase; confirm every current member downloads and is
   playable. Submit/restore the same transaction again and confirm no duplicate
   or corrupted ownership.
8. Add a new member and publish. Confirm the previous purchaser does not receive
   it, while a new purchaser receives the expanded current set.
9. Remove a member and publish. Confirm the previous purchaser retains it.
10. On a fresh installation/device, restore purchases. Confirm the historical
    deck snapshot returns, then confirm product selection is recomputed from
    those restored deck IDs.
11. Change device language/region and confirm the store-formatted price—not the
    catalog's numeric display price—matches Explore, details, and checkout.

## Limitations

The fallback full product is safe when a tier is absent, but a store will not
sell the same non-consumable full SKU twice. If a past full-bundle purchaser
later lacks a newly-added member, configure the matching ownership tier before
publishing that membership change so the customer has a different purchasable
SKU. Refund/revocation freshness still depends on purchase verification or a
restore; real-time App Store/Play notification ingestion is outside this change.

# Renaming decks and checking purchase availability

To correct a spelling or rename a deck/bundle, edit its visible title in Deck
Manager. Keep its internal ID and Apple product ID. Neither identifier is a
customer-facing title. The editor keeps existing IDs read-only, preserves the
saved Apple mapping, and rejects a changed ID on save. New records derive their
initial identifiers from their title until first saved.

Apple lets you edit IAP display metadata without replacing the product:
https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/view-and-edit-in-app-purchase-information

For a genuinely new deck, create its IAP with the exact product ID, finish its
metadata, price, and availability, then publish the matching catalog mapping.
Use a TestFlight purchase to verify sandbox readiness. TestFlight uses Apple's
sandbox; the product's review status alone does not establish whether StoreKit
will return it to that device. Public App Store sale additionally requires the
appropriate Apple approval and availability.
https://developer.apple.com/help/app-store-connect/test-a-beta-version/testing-subscriptions-and-in-app-purchases-in-testflight

## App behavior

- Paid browsing lists only show products confirmed by the current store lookup
  while the purchase verification service is working. A catalog price is not
  proof that a product can be bought.
- Bundles check the selected SKU for the customer's current ownership count.
  A returned full-price SKU does not make a missing discount SKU purchasable.
  Bundle contents remain intact: a deck may be included in a purchasable bundle
  even when its individual IAP is unavailable.
- Initial loading, failed lookups, missing products, draft mappings, and retired
  mappings cannot advertise an unowned product. Owned content and in-progress
  purchase recovery remain accessible.
- Store results replace the previous lookup. Changed catalog mappings invalidate
  old prices immediately; superseded requests cannot activate an old offer.
- Availability is refreshed after catalog product mappings change, after a
  connection is restored, when the app returns to the foreground, and on retry.
- Device disconnection, store failures, purchase-service failures, and owned
  content download failures are separate conditions. A failed download cannot
  mark unrelated purchases offline. No cached-price or “Last seen” message is
  displayed.
- Purchase completion and download retries prepare only the purchased target's
  entitled decks. An unrelated removed sandbox deck cannot turn a successfully
  installed new purchase into an endless retry.

## Fall Favorites investigation — October 15, 2026

The public production manifest at revision 76 contained `fall-favorites`, title
`Fall Favorites`, and Apple product `com.cadelawless.whatzit.deck.fall_favorites`.
The Hello, Fall! bundle referenced that new deck ID. The remote change had
therefore published successfully; this observation does not prove the device
had activated that revision or that Apple returned the new product.

The previous bundled catalog used `fall-favorties` and
`com.cadelawless.whatzit.deck.fall_favorties`. Deck Manager regenerated both IDs
when an existing title changed. The commerce provider also treated any error
during registration, entitlement refresh, or owned-deck preparation as offline.
An entitlement for the removed old ID can fail preparation with “no published
content artifact,” triggering that misleading global state. That failure path
is covered by a regression test. Device diagnostics would still be needed to
prove the exact error encountered by a particular TestFlight installation.

The owner confirmed that no IAPs have launched publicly and no customer purchases
are affected. Keep the current corrected IDs for new testing. Older sandbox
purchases remain separate Apple products; creating a new IAP does not rename an
old transaction. No production ownership data was changed by this fix.

The code changes require a new app release/TestFlight build (or a compatible
authorized OTA update) and deployment of the Deck Manager changes. Publishing
catalog metadata alone cannot replace the installed app's commerce logic.

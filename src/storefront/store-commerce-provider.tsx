import type { Purchase } from 'expo-iap';
import { useIAP } from 'expo-iap';
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { openCatalogDatabase } from '@/catalog/catalog-database';
import { useCatalog } from '@/catalog/catalog-provider';

import {
  configuredCommerceApiBaseUrl,
  CommerceApiError,
  fetchEntitlements,
  registerInstallation,
  resetSandboxPurchases,
  type CommerceEntitlements,
  verifyApplePurchase,
} from './commerce-api';
import { reconcileApplePurchases } from './apple-purchase-restore';
import {
  CommerceProvider,
  type CommerceAdapter,
  type CommerceRestoreState,
  type CommerceTestingState,
} from './commerce-provider';
import type { CommerceProductState, CommerceTarget } from './commerce-state';
import { installEntitledDeck } from './entitled-deck-installer';
import { resetLocalPaidOwnership } from './commerce-testing';
import {
  loadOrCreateInstallationIdentity,
  resetInstallationIdentity,
  type InstallationIdentity,
} from './installation-identity';

type OwnedProduct = CommerceEntitlements['products'][number];

export function StoreCommerceProvider({ children }: PropsWithChildren) {
  const { catalog, refreshCatalog } = useCatalog();
  const apiBaseUrl = configuredCommerceApiBaseUrl();
  const [identity, setIdentity] = useState<InstallationIdentity | null>(null);
  const [ownedProducts, setOwnedProducts] = useState<OwnedProduct[]>([]);
  const [operationStates, setOperationStates] = useState<Map<string, CommerceProductState>>(new Map());
  const [restoreState, setRestoreState] = useState<CommerceRestoreState>({ status: 'idle' });
  const [testingState, setTestingState] = useState<CommerceTestingState>({ status: 'idle' });
  const [serverReachable, setServerReachable] = useState(true);
  const processedTransactions = useRef(new Set<string>());
  const failedPurchases = useRef(new Map<string, Purchase>());
  const restoreInFlight = useRef(false);
  const restoreSnapshotPending = useRef(false);

  const appleProducts = useMemo(() => {
    const result = new Map<string, { kind: 'deck' | 'bundle'; id: string }>();
    for (const deck of catalog.decks) {
      const id = deck.storeProducts?.apple?.productId;
      if (id) result.set(id, { kind: 'deck', id: deck.id });
    }
    for (const bundle of catalog.bundles) {
      const id = bundle.storeProducts?.apple?.productId;
      if (id) result.set(id, { kind: 'bundle', id: bundle.id });
    }
    return result;
  }, [catalog]);

  const setTargetState = useCallback((target: { kind: string; id: string }, state?: CommerceProductState) => {
    const key = `${target.kind}:${target.id}`;
    setOperationStates((current) => {
      const next = new Map(current);
      if (state) next.set(key, state);
      else next.delete(key);
      return next;
    });
  }, []);

  const persistEntitlements = useCallback(async (entitlements: CommerceEntitlements) => {
    const database = await openCatalogDatabase();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM commerce_entitlements');
      for (const product of entitlements.products) {
        await transaction.runAsync(
          `INSERT INTO commerce_entitlements (product_id, target_type, target_id, verified_at)
           VALUES (?, ?, ?, ?)`,
          product.productId,
          product.kind,
          product.targetId,
          entitlements.verifiedAt,
        );
      }
      await transaction.runAsync(
        `INSERT INTO commerce_state (singleton_id, last_synced_at, last_error_code)
         VALUES (1, ?, NULL)
         ON CONFLICT(singleton_id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at, last_error_code = NULL`,
        entitlements.verifiedAt,
      );
    });
    setOwnedProducts(entitlements.products);
    return database;
  }, []);

  const prepareEntitledDecks = useCallback(async (
    entitlements: CommerceEntitlements,
    currentIdentity: InstallationIdentity,
  ) => {
    if (!apiBaseUrl) return;
    const database = await openCatalogDatabase();
    const directlyOwnedDecks = new Set(
      entitlements.products
        .filter((product) => product.kind === 'deck')
        .map((product) => product.targetId),
    );
    for (const deckId of entitlements.deckIds) {
      await installEntitledDeck(
        database,
        apiBaseUrl,
        currentIdentity,
        deckId,
        directlyOwnedDecks.has(deckId) ? 'purchase' : 'bundle',
      );
    }
    await refreshCatalog();
  }, [apiBaseUrl, refreshCatalog]);

  const processPurchaseRef = useRef<(purchase: Purchase) => Promise<void>>(async () => {});
  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      void processPurchaseRef.current(purchase);
    },
    onPurchaseError: (error) => {
      if (error.productId) {
        const target = appleProducts.get(error.productId);
        if (target) setTargetState(target);
      }
    },
  });

  const {
    availablePurchases,
    connected,
    fetchProducts,
    finishTransaction,
    products,
    requestPurchase,
    restorePurchases: restoreStorePurchases,
  } = iap;
  const prices = useMemo(
    () => new Map(products.map((product) => [product.id, product.displayPrice])),
    [products],
  );

  const processPurchase = useCallback(async (purchase: Purchase) => {
    if (!apiBaseUrl || !identity || Platform.OS !== 'ios') return;
    const transactionKey = purchase.transactionId ?? purchase.id;
    if (processedTransactions.current.has(transactionKey)) return;
    if (purchase.purchaseState === 'pending') {
      const target = appleProducts.get(purchase.productId);
      if (target) setTargetState(target, { status: 'pending' });
      return;
    }
    if (purchase.purchaseState !== 'purchased' || !purchase.purchaseToken) return;
    processedTransactions.current.add(transactionKey);
    const target = appleProducts.get(purchase.productId);
    if (target) setTargetState(target, { status: 'verifying' });
    try {
      const entitlements = await verifyApplePurchase(
        apiBaseUrl,
        identity,
        purchase.purchaseToken,
        'purchase',
      );
      await persistEntitlements(entitlements);
      await finishTransaction({ purchase, isConsumable: false });
      if (target) setTargetState(target, { status: 'preparing' });
      await prepareEntitledDecks(entitlements, identity);
      if (target) failedPurchases.current.delete(`${target.kind}:${target.id}`);
      if (target) setTargetState(target);
      setServerReachable(true);
    } catch (error) {
      processedTransactions.current.delete(transactionKey);
      console.error('[StoreCommerce] Purchase verification or preparation failed', {
        error,
        productId: purchase.productId,
        transactionId: purchase.transactionId,
      });
      if (target) {
        failedPurchases.current.set(`${target.kind}:${target.id}`, purchase);
        setTargetState(target, {
          status: 'retry',
          message: purchaseFailureMessage(error),
        });
      }
    }
  }, [apiBaseUrl, appleProducts, finishTransaction, identity, persistEntitlements, prepareEntitledDecks, setTargetState]);
  useEffect(() => {
    processPurchaseRef.current = processPurchase;
  }, [processPurchase]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const database = await openCatalogDatabase();
      const local = await database.getAllAsync<OwnedProduct>(
        'SELECT product_id AS productId, target_type AS kind, target_id AS targetId FROM commerce_entitlements',
      );
      if (!cancelled) setOwnedProducts(local);
      if (!apiBaseUrl || Platform.OS !== 'ios') return;
      const currentIdentity = await loadOrCreateInstallationIdentity();
      if (cancelled) return;
      setIdentity(currentIdentity);
      try {
        await registerInstallation(apiBaseUrl, currentIdentity);
        const entitlements = await fetchEntitlements(apiBaseUrl, currentIdentity);
        if (cancelled) return;
        await persistEntitlements(entitlements);
        await prepareEntitledDecks(entitlements, currentIdentity);
        setServerReachable(true);
      } catch {
        if (!cancelled) setServerReachable(false);
      }
    })().catch(() => {
      if (!cancelled) setServerReachable(false);
    });
    return () => { cancelled = true; };
  }, [apiBaseUrl, persistEntitlements, prepareEntitledDecks]);

  useEffect(() => {
    if (!connected || Platform.OS !== 'ios' || appleProducts.size === 0) return;
    void fetchProducts({ skus: [...appleProducts.keys()], type: 'in-app' });
  }, [appleProducts, connected, fetchProducts]);

  const targetProductId = useCallback((target: CommerceTarget) => {
    const record = target.kind === 'deck'
      ? catalog.getDeckById(target.id)
      : catalog.getBundleById(target.id);
    return record?.storeProducts?.apple?.productId;
  }, [catalog]);

  const getProductState = useCallback((target: CommerceTarget): CommerceProductState => {
    if (target.access === 'free') return { status: 'owned', source: 'included' };
    const activeOperation = operationStates.get(`${target.kind}:${target.id}`);
    if (activeOperation) return activeOperation;
    const direct = ownedProducts.some((product) => product.kind === target.kind && product.targetId === target.id);
    if (direct) return { status: 'owned', source: 'purchase' };
    if (target.kind === 'deck') {
      const viaBundle = ownedProducts.some(
        (product) => product.kind === 'bundle' && catalog.getBundleById(product.targetId)?.deckIds.includes(target.id),
      );
      if (viaBundle) return { status: 'owned', source: 'bundle' };
    }
    const productId = targetProductId(target);
    if (!productId || Platform.OS !== 'ios' || !apiBaseUrl) {
      return { status: 'unavailable', reason: 'not_configured' };
    }
    const price = prices.get(productId);
    if (!serverReachable) return { status: 'offline', ...(price ? { lastKnownPrice: price } : {}) };
    if (!connected || !price) return { status: 'loading' };
    return { status: 'available', localizedPrice: price };
  }, [apiBaseUrl, catalog, connected, operationStates, ownedProducts, prices, serverReachable, targetProductId]);

  const purchase = useCallback(async (target: CommerceTarget) => {
    const productId = targetProductId(target);
    if (!productId || !identity || Platform.OS !== 'ios') return;
    setTargetState(target, { status: 'purchasing', localizedPrice: prices.get(productId) ?? '' });
    try {
      await requestPurchase({
        request: { apple: { sku: productId, appAccountToken: identity.appAccountToken } },
        type: 'in-app',
      });
    } catch {
      setTargetState(target);
    }
  }, [identity, prices, requestPurchase, setTargetState, targetProductId]);

  const restorePurchases = useCallback(async () => {
    if (restoreInFlight.current) return;
    if (!identity || !apiBaseUrl || Platform.OS !== 'ios' || !connected) {
      setRestoreState({
        status: 'error',
        message: 'Connect to the App Store and try restoring again.',
      });
      return;
    }

    restoreInFlight.current = true;
    restoreSnapshotPending.current = true;
    setRestoreState({ status: 'restoring' });
    try {
      await restoreStorePurchases({ alsoPublishToEventListenerIOS: false });
    } catch {
      restoreInFlight.current = false;
      restoreSnapshotPending.current = false;
      setRestoreState({
        status: 'error',
        message: 'Purchases could not be restored. Check your connection and try again.',
      });
    }
  }, [apiBaseUrl, connected, identity, restoreStorePurchases]);

  useEffect(() => {
    if (!restoreSnapshotPending.current || !identity || !apiBaseUrl) return;
    restoreSnapshotPending.current = false;

    void reconcileApplePurchases({
      purchases: availablePurchases,
      knownProductIds: new Set(appleProducts.keys()),
      verify: (signedTransaction) =>
        verifyApplePurchase(apiBaseUrl, identity, signedTransaction, 'restore'),
      finish: (purchase) => finishTransaction({ purchase, isConsumable: false }),
      fetchEntitlements: () => fetchEntitlements(apiBaseUrl, identity),
      persistEntitlements,
      prepareEntitledDecks: (entitlements) =>
        prepareEntitledDecks(entitlements, identity),
    })
      .then((result) => {
        for (const purchase of availablePurchases) {
          if (
            purchase.purchaseState === 'purchased'
            && purchase.purchaseToken
            && appleProducts.has(purchase.productId)
          ) {
            processedTransactions.current.add(purchase.transactionId ?? purchase.id);
          }
        }
        restoreInFlight.current = false;
        setServerReachable(true);
        setRestoreState({
          status: 'success',
          restoredProductCount: result.entitlements.products.length,
        });
      })
      .catch(() => {
        restoreInFlight.current = false;
        setRestoreState({
          status: 'error',
          message: 'Your purchases are safe, but restoration could not finish. Please try again.',
        });
      });
  }, [
    apiBaseUrl,
    appleProducts,
    availablePurchases,
    finishTransaction,
    identity,
    persistEntitlements,
    prepareEntitledDecks,
  ]);

  const retryPreparation = useCallback(async (target: CommerceTarget) => {
    if (!identity || !apiBaseUrl) return;
    const failedPurchase = failedPurchases.current.get(`${target.kind}:${target.id}`);
    if (failedPurchase) {
      await processPurchase(failedPurchase);
      return;
    }
    setTargetState(target, { status: 'preparing' });
    try {
      const entitlements = await fetchEntitlements(apiBaseUrl, identity);
      await persistEntitlements(entitlements);
      await prepareEntitledDecks(entitlements, identity);
      setTargetState(target);
      setServerReachable(true);
    } catch {
      setTargetState(target, { status: 'retry' });
    }
  }, [apiBaseUrl, identity, persistEntitlements, prepareEntitledDecks, processPurchase, setTargetState]);

  const testingEnabled =
    process.env.EXPO_PUBLIC_COMMERCE_TESTING === 'enabled'
    && Platform.OS === 'ios'
    && Boolean(apiBaseUrl);

  const clearLocalOwnership = useCallback(async () => {
    const database = await openCatalogDatabase();
    await resetLocalPaidOwnership(database);
    processedTransactions.current.clear();
    setOwnedProducts([]);
    setOperationStates(new Map());
    setRestoreState({ status: 'idle' });
    await refreshCatalog();
  }, [refreshCatalog]);

  const simulateNewDevice = useCallback(async () => {
    if (!testingEnabled || !apiBaseUrl) return;
    setTestingState({ status: 'working', operation: 'new-device' });
    try {
      await clearLocalOwnership();
      const newIdentity = await resetInstallationIdentity();
      await registerInstallation(apiBaseUrl, newIdentity);
      setIdentity(newIdentity);
      setServerReachable(true);
      setTestingState({
        status: 'success',
        message: 'A new test installation is ready. Tap Restore Purchases to recover this Apple Account’s decks.',
      });
    } catch {
      setTestingState({
        status: 'error',
        message: 'The new-device simulation could not finish. Check the staging connection and try again.',
      });
    }
  }, [apiBaseUrl, clearLocalOwnership, testingEnabled]);

  const resetSandboxOwnership = useCallback(async () => {
    if (!testingEnabled || !apiBaseUrl) return;
    if (!identity) {
      setTestingState({
        status: 'error',
        message: 'The staging installation is still connecting. Wait a moment and try again.',
      });
      return;
    }
    setTestingState({ status: 'working', operation: 'reset-ownership' });
    try {
      const result = await resetSandboxPurchases(apiBaseUrl, identity);
      await clearLocalOwnership();
      setServerReachable(true);
      setTestingState({
        status: 'success',
        message: `${result.revokedEntitlementCount} sandbox entitlement${result.revokedEntitlementCount === 1 ? '' : 's'} reset. Clear the Sandbox Apple Account purchase history before buying again.`,
      });
    } catch {
      setTestingState({
        status: 'error',
        message: 'Sandbox ownership could not be reset. Confirm the staging API is deployed and try again.',
      });
    }
  }, [apiBaseUrl, clearLocalOwnership, identity, testingEnabled]);

  const adapter = useMemo<CommerceAdapter>(() => ({
    getProductState,
    purchase,
    restorePurchases:
      Platform.OS === 'ios' && apiBaseUrl ? restorePurchases : undefined,
    restoreState,
    retryPreparation,
    testing: testingEnabled ? {
      simulateNewDevice,
      resetSandboxOwnership,
      state: testingState,
    } : undefined,
  }), [
    apiBaseUrl,
    getProductState,
    purchase,
    resetSandboxOwnership,
    restorePurchases,
    restoreState,
    retryPreparation,
    simulateNewDevice,
    testingEnabled,
    testingState,
  ]);

  return <CommerceProvider adapter={adapter}>{children}</CommerceProvider>;
}

function purchaseFailureMessage(error: unknown) {
  if (error instanceof CommerceApiError) {
    if (process.env.EXPO_PUBLIC_COMMERCE_TESTING === 'enabled') {
      return `${error.message} [${error.code}; HTTP ${error.status}]`;
    }
    if (error.code === 'network_error') {
      return 'Your transaction is safe. Reconnect and retry preparing this purchase.';
    }
    return error.message;
  }
  return 'Your transaction is safe, but its offline content could not be prepared. Please retry.';
}

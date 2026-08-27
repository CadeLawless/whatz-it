import NetInfo from '@react-native-community/netinfo';
import { getAvailablePurchases, type Purchase, useIAP } from 'expo-iap';
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
import {
  entitledCommerceState,
  type CommerceProductState,
  type CommerceTarget,
} from './commerce-state';
import { installEntitledDeck } from './entitled-deck-installer';
import { EntitledDeckPreparationQueue } from './entitled-deck-preparation';
import { resetLocalPaidOwnership } from './commerce-testing';
import { describeCommerceError, logCommerceDiagnostic } from './commerce-diagnostics';
import {
  commerceProductFingerprint,
  commerceProductIndexFromFingerprint,
} from './commerce-product-index';
import {
  loadOrCreateInstallationIdentity,
  resetInstallationIdentity,
  type InstallationIdentity,
} from './installation-identity';

type OwnedProduct = CommerceEntitlements['products'][number];
type StoreProductRequestState = 'waiting' | 'loading' | 'complete' | 'error';

const STORE_CONNECTION_TIMEOUT_MS = 10_000;
const STORE_PROMPT_DELAY_NOTICE_MS = 8_000;

type ActivePurchase = {
  operationId: string;
  productId: string;
  startedAt: number;
  target: { kind: 'deck' | 'bundle'; id: string };
};

export function StoreCommerceProvider({ children }: PropsWithChildren) {
  const { catalog, refreshCatalog } = useCatalog();
  const apiBaseUrl = configuredCommerceApiBaseUrl();
  const [identity, setIdentity] = useState<InstallationIdentity | null>(null);
  const [ownedProducts, setOwnedProducts] = useState<OwnedProduct[]>([]);
  const [operationStates, setOperationStates] = useState<Map<string, CommerceProductState>>(new Map());
  const [restoreState, setRestoreState] = useState<CommerceRestoreState>({ status: 'idle' });
  const [testingState, setTestingState] = useState<CommerceTestingState>({ status: 'idle' });
  const [serverReachable, setServerReachable] = useState(true);
  const [storeProductRequestState, setStoreProductRequestState] =
    useState<StoreProductRequestState>('waiting');
  const processedTransactions = useRef(new Set<string>());
  const failedPurchases = useRef(new Map<string, Purchase>());
  const restoreInFlight = useRef(false);
  const connectionRefreshRef = useRef<Promise<boolean> | null>(null);
  const storeProductRefreshRef = useRef<Promise<void> | null>(null);
  const activePurchaseRef = useRef<ActivePurchase | null>(null);

  const appleProductFingerprint = commerceProductFingerprint(catalog);
  const appleProducts = useMemo(
    () => commerceProductIndexFromFingerprint(appleProductFingerprint),
    [appleProductFingerprint],
  );

  const setTargetState = useCallback((target: { kind: string; id: string }, state?: CommerceProductState) => {
    const key = `${target.kind}:${target.id}`;
    setOperationStates((current) => {
      const next = new Map(current);
      if (state) next.set(key, state);
      else next.delete(key);
      return next;
    });
  }, []);

  const preparationQueue = useMemo(
    () => new EntitledDeckPreparationQueue<{
      database: Awaited<ReturnType<typeof openCatalogDatabase>>;
      identity: InstallationIdentity;
    }>(
      async (deckId, ownershipSource, context) => {
        if (!apiBaseUrl) return;
        await installEntitledDeck(
          context.database,
          apiBaseUrl,
          context.identity,
          deckId,
          ownershipSource,
        );
      },
      refreshCatalog,
    ),
    [apiBaseUrl, refreshCatalog],
  );

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
    await preparationQueue.prepare(
      currentIdentity.installationId,
      entitlements,
      { database, identity: currentIdentity },
    );
  }, [apiBaseUrl, preparationQueue]);

  const refreshCommerceConnection = useCallback(() => {
    if (!apiBaseUrl || Platform.OS !== 'ios') return Promise.resolve(false);
    if (connectionRefreshRef.current) return connectionRefreshRef.current;

    const startedAt = Date.now();
    logCommerceDiagnostic('server-refresh-started');
    const request = (async () => {
      const currentIdentity = await loadOrCreateInstallationIdentity();
      setIdentity(currentIdentity);
      await registerInstallation(apiBaseUrl, currentIdentity);
      const entitlements = await fetchEntitlements(apiBaseUrl, currentIdentity);
      await persistEntitlements(entitlements);
      await prepareEntitledDecks(entitlements, currentIdentity);
      setServerReachable(true);
      logCommerceDiagnostic('server-refresh-completed', {
        durationMs: Date.now() - startedAt,
        productCount: entitlements.products.length,
      });
      return true;
    })()
      .catch((error) => {
        logCommerceDiagnostic('server-refresh-failed', {
          durationMs: Date.now() - startedAt,
          error: describeCommerceError(error),
        }, 'warn');
        console.warn('[StoreCommerce] Commerce connection refresh failed', error);
        setServerReachable(false);
        return false;
      })
      .finally(() => {
        if (connectionRefreshRef.current === request) {
          connectionRefreshRef.current = null;
        }
      });

    connectionRefreshRef.current = request;
    return request;
  }, [apiBaseUrl, persistEntitlements, prepareEntitledDecks]);

  const processPurchaseRef = useRef<(purchase: Purchase) => Promise<void>>(async () => {});
  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      const currentActive = activePurchaseRef.current;
      const active = currentActive?.productId === purchase.productId
        ? currentActive
        : null;
      logCommerceDiagnostic('store.purchase-success-callback', {
        elapsedMs: active ? Date.now() - active.startedAt : null,
        operationId: active?.operationId ?? null,
        productId: purchase.productId,
        purchaseState: purchase.purchaseState,
        tokenPresent: Boolean(purchase.purchaseToken),
      });
      if (restoreInFlight.current) {
        logCommerceDiagnostic('restore.purchase-callback-deferred', {
          productId: purchase.productId,
        });
        return;
      }
      void processPurchaseRef.current(purchase);
    },
    onPurchaseError: (error) => {
      const active = activePurchaseRef.current;
      const target = error.productId
        ? appleProducts.get(error.productId)
          ?? (active?.productId === error.productId ? active.target : undefined)
        : active?.target;
      logCommerceDiagnostic('store.purchase-error-callback', {
        elapsedMs: active ? Date.now() - active.startedAt : null,
        error: describeCommerceError(error),
        operationId: active?.operationId ?? null,
        productId: error.productId ?? active?.productId ?? null,
      }, 'warn');
      if (target) setTargetState(target);
      if (!error.productId || active?.productId === error.productId) {
        activePurchaseRef.current = null;
      }
    },
    onError: (error) => {
      logCommerceDiagnostic('store.general-error', {
        error: describeCommerceError(error),
      }, 'warn');
      console.error('[StoreCommerce] App Store request failed', error);
      setStoreProductRequestState('error');
    },
  });

  const {
    connected,
    fetchProducts,
    finishTransaction,
    products,
    reconnect,
    requestPurchase,
    restorePurchases: restoreStorePurchases,
  } = iap;
  const prices = useMemo(
    () => new Map(products.map((product) => [product.id, product.displayPrice])),
    [products],
  );

  useEffect(() => {
    logCommerceDiagnostic('store.connection-state', {
      connected,
      loadedProductCount: products.length,
    });
  }, [connected, products.length]);

  const refreshStoreProducts = useCallback(() => {
    if (Platform.OS !== 'ios' || appleProducts.size === 0) return Promise.resolve();
    if (storeProductRefreshRef.current) return storeProductRefreshRef.current;
    setStoreProductRequestState('loading');
    const startedAt = Date.now();
    logCommerceDiagnostic('store.products-requested', {
      connected,
      productCount: appleProducts.size,
    });

    const request = (async () => {
      try {
        const storeConnected = connected || await reconnect();
        if (!storeConnected) {
          throw new Error('The App Store connection is unavailable.');
        }

        await fetchProducts({ skus: [...appleProducts.keys()], type: 'in-app' });
        setStoreProductRequestState('complete');
        logCommerceDiagnostic('store.products-request-returned', {
          durationMs: Date.now() - startedAt,
          requestedProductCount: appleProducts.size,
        });
      } catch (error) {
        logCommerceDiagnostic('store.products-request-failed', {
          durationMs: Date.now() - startedAt,
          error: describeCommerceError(error),
          requestedProductCount: appleProducts.size,
        }, 'warn');
        console.error('[StoreCommerce] Product loading failed', error);
        setStoreProductRequestState('error');
      }
    })().finally(() => {
      if (storeProductRefreshRef.current === request) {
        storeProductRefreshRef.current = null;
      }
    });

    storeProductRefreshRef.current = request;
    return request;
  }, [appleProducts, connected, fetchProducts, reconnect]);

  const processPurchase = useCallback(async (purchase: Purchase) => {
    const currentActive = activePurchaseRef.current;
    const active = currentActive?.productId === purchase.productId
      ? currentActive
      : null;
    const target = appleProducts.get(purchase.productId) ?? active?.target;
    if (!apiBaseUrl || !identity || Platform.OS !== 'ios') {
      logCommerceDiagnostic('purchase-processing-missing-prerequisite', {
        apiConfigured: Boolean(apiBaseUrl),
        identityReady: Boolean(identity),
        operationId: active?.operationId ?? null,
        platform: Platform.OS,
        productId: purchase.productId,
      }, 'warn');
      if (target) {
        setTargetState(target, {
          status: 'retry',
          message: 'Your transaction is safe, but purchase verification could not start. Please retry.',
        });
      }
      if (activePurchaseRef.current?.operationId === active?.operationId) {
        activePurchaseRef.current = null;
      }
      return;
    }
    const transactionKey = purchase.transactionId ?? purchase.id;
    if (processedTransactions.current.has(transactionKey)) {
      logCommerceDiagnostic('purchase-processing-duplicate', {
        operationId: active?.operationId ?? null,
        productId: purchase.productId,
      });
      if (target) setTargetState(target);
      if (activePurchaseRef.current?.operationId === active?.operationId) {
        activePurchaseRef.current = null;
      }
      return;
    }
    if (purchase.purchaseState === 'pending') {
      if (target) setTargetState(target, { status: 'pending' });
      logCommerceDiagnostic('purchase-pending', {
        operationId: active?.operationId ?? null,
        productId: purchase.productId,
      });
      if (activePurchaseRef.current?.operationId === active?.operationId) {
        activePurchaseRef.current = null;
      }
      return;
    }
    if (purchase.purchaseState !== 'purchased' || !purchase.purchaseToken) {
      logCommerceDiagnostic('purchase-invalid-callback', {
        operationId: active?.operationId ?? null,
        productId: purchase.productId,
        purchaseState: purchase.purchaseState,
        tokenPresent: Boolean(purchase.purchaseToken),
      }, 'warn');
      if (target) {
        setTargetState(target, {
          status: 'retry',
          message: 'The App Store responded, but purchase verification could not start. Please retry.',
        });
      }
      if (activePurchaseRef.current?.operationId === active?.operationId) {
        activePurchaseRef.current = null;
      }
      return;
    }
    processedTransactions.current.add(transactionKey);
    if (target) setTargetState(target, { status: 'verifying' });
    logCommerceDiagnostic('verification-started', {
      elapsedMs: active ? Date.now() - active.startedAt : null,
      operationId: active?.operationId ?? null,
      productId: purchase.productId,
    });
    try {
      const entitlements = await verifyApplePurchase(
        apiBaseUrl,
        identity,
        purchase.purchaseToken,
        'purchase',
      );
      logCommerceDiagnostic('verification-completed', {
        elapsedMs: active ? Date.now() - active.startedAt : null,
        operationId: active?.operationId ?? null,
        productCount: entitlements.products.length,
        productId: purchase.productId,
      });
      await persistEntitlements(entitlements);
      await finishTransaction({ purchase, isConsumable: false });
      logCommerceDiagnostic('store-transaction-finished', {
        elapsedMs: active ? Date.now() - active.startedAt : null,
        operationId: active?.operationId ?? null,
        productId: purchase.productId,
      });
      if (target) setTargetState(target, { status: 'preparing' });
      await prepareEntitledDecks(entitlements, identity);
      if (target) failedPurchases.current.delete(`${target.kind}:${target.id}`);
      if (target) setTargetState(target);
      setServerReachable(true);
      if (activePurchaseRef.current?.operationId === active?.operationId) {
        activePurchaseRef.current = null;
      }
      logCommerceDiagnostic('purchase-completed', {
        elapsedMs: active ? Date.now() - active.startedAt : null,
        operationId: active?.operationId ?? null,
        productId: purchase.productId,
      });
    } catch (error) {
      processedTransactions.current.delete(transactionKey);
      if (activePurchaseRef.current?.operationId === active?.operationId) {
        activePurchaseRef.current = null;
      }
      logCommerceDiagnostic('purchase-processing-failed', {
        elapsedMs: active ? Date.now() - active.startedAt : null,
        error: describeCommerceError(error),
        operationId: active?.operationId ?? null,
        productId: purchase.productId,
      }, 'warn');
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
      if (!cancelled) await refreshCommerceConnection();
    })().catch(() => {
      if (!cancelled) setServerReachable(false);
    });
    return () => { cancelled = true; };
  }, [refreshCommerceConnection]);

  useEffect(() => {
    if (!apiBaseUrl || Platform.OS !== 'ios') return;
    let wasOnline: boolean | null = null;
    return NetInfo.addEventListener((network) => {
      const online = network.isConnected === true
        && network.isInternetReachable !== false;
      if (!online) {
        if (network.isConnected === false || network.isInternetReachable === false) {
          setServerReachable(false);
        }
      } else if (wasOnline !== true) {
        void refreshCommerceConnection();
        void refreshStoreProducts();
      }
      wasOnline = online;
    });
  }, [apiBaseUrl, refreshCommerceConnection, refreshStoreProducts]);

  useEffect(() => {
    if (!connected || Platform.OS !== 'ios' || appleProducts.size === 0) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void refreshStoreProducts();
    });
    return () => { cancelled = true; };
  }, [appleProducts, connected, refreshStoreProducts]);

  useEffect(() => {
    if (connected || Platform.OS !== 'ios' || appleProducts.size === 0) return;
    const timeout = setTimeout(() => {
      setStoreProductRequestState((current) =>
        current === 'waiting' ? 'error' : current,
      );
    }, STORE_CONNECTION_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [appleProducts, connected]);

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
    if (direct) {
      if (target.kind === 'deck') {
        return entitledCommerceState('purchase', [target.installationStatus]);
      }
      const bundle = catalog.getBundleById(target.id);
      return entitledCommerceState(
        'purchase',
        bundle?.decks.map((deck) => deck.installationStatus) ?? [],
      );
    }
    if (target.kind === 'deck') {
      const viaBundle = ownedProducts.some(
        (product) => product.kind === 'bundle' && catalog.getBundleById(product.targetId)?.deckIds.includes(target.id),
      );
      if (viaBundle) {
        return entitledCommerceState('bundle', [target.installationStatus]);
      }
    }
    const productId = targetProductId(target);
    if (!productId || Platform.OS !== 'ios' || !apiBaseUrl) {
      return { status: 'unavailable', reason: 'not_configured' };
    }
    const price = prices.get(productId);
    if (!serverReachable) return { status: 'offline', ...(price ? { lastKnownPrice: price } : {}) };
    if (price) return { status: 'available', localizedPrice: price };
    if (storeProductRequestState === 'error' || storeProductRequestState === 'complete') {
      return { status: 'unavailable', reason: 'store_unavailable' };
    }
    return { status: 'loading' };
  }, [apiBaseUrl, catalog, operationStates, ownedProducts, prices, serverReachable, storeProductRequestState, targetProductId]);

  const purchase = useCallback(async (target: CommerceTarget) => {
    const productId = targetProductId(target);
    if (!productId || !identity || Platform.OS !== 'ios') {
      logCommerceDiagnostic('store.request-skipped', {
        identityReady: Boolean(identity),
        platform: Platform.OS,
        productId: productId ?? null,
        targetId: target.id,
        targetKind: target.kind,
      }, 'warn');
      return;
    }
    if (activePurchaseRef.current) {
      logCommerceDiagnostic('store.request-ignored-while-active', {
        activeOperationId: activePurchaseRef.current.operationId,
        activeProductId: activePurchaseRef.current.productId,
        productId,
      }, 'warn');
      return;
    }
    const operation: ActivePurchase = {
      operationId: createCommerceOperationId(),
      productId,
      startedAt: Date.now(),
      target: { kind: target.kind, id: target.id },
    };
    activePurchaseRef.current = operation;
    logCommerceDiagnostic('store.request-started', {
      connected,
      operationId: operation.operationId,
      productId,
      targetId: target.id,
      targetKind: target.kind,
    });
    setTargetState(target, { status: 'purchasing', localizedPrice: prices.get(productId) ?? '' });
    setTimeout(() => {
      if (activePurchaseRef.current?.operationId !== operation.operationId) return;
      setTargetState(target, {
        status: 'purchasing',
        localizedPrice: prices.get(productId) ?? '',
        waitingForStore: true,
      });
      logCommerceDiagnostic('store.prompt-delayed', {
        elapsedMs: Date.now() - operation.startedAt,
        operationId: operation.operationId,
        productId,
      }, 'warn');
    }, STORE_PROMPT_DELAY_NOTICE_MS);
    try {
      await requestPurchase({
        request: { apple: { sku: productId, appAccountToken: identity.appAccountToken } },
        type: 'in-app',
      });
      logCommerceDiagnostic('store.request-returned', {
        elapsedMs: Date.now() - operation.startedAt,
        operationId: operation.operationId,
        productId,
      });
    } catch (error) {
      logCommerceDiagnostic('store.request-rejected', {
        elapsedMs: Date.now() - operation.startedAt,
        error: describeCommerceError(error),
        operationId: operation.operationId,
        productId,
      }, 'warn');
      if (activePurchaseRef.current?.operationId === operation.operationId) {
        activePurchaseRef.current = null;
      }
      setTargetState(target);
    }
  }, [connected, identity, prices, requestPurchase, setTargetState, targetProductId]);

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
    const ownedBeforeRestore = new Set(ownedProducts.map((product) => product.productId));
    const startedAt = Date.now();
    logCommerceDiagnostic('restore.started', {
      ownedProductCount: ownedBeforeRestore.size,
    });
    setRestoreState({ status: 'restoring' });
    try {
      await restoreStorePurchases({ alsoPublishToEventListenerIOS: false });
      logCommerceDiagnostic('restore.store-sync-completed', {
        elapsedMs: Date.now() - startedAt,
      });
      const purchases = await getAvailablePurchases({
        alsoPublishToEventListenerIOS: false,
        onlyIncludeActiveItemsIOS: true,
      });
      logCommerceDiagnostic('restore.purchase-snapshot-received', {
        elapsedMs: Date.now() - startedAt,
        purchaseCount: purchases.length,
      });
      const result = await reconcileApplePurchases({
        purchases,
        knownProductIds: new Set(appleProducts.keys()),
        verify: (signedTransaction) =>
          verifyApplePurchase(apiBaseUrl, identity, signedTransaction, 'restore'),
        finish: (purchase) => finishTransaction({ purchase, isConsumable: false }),
        fetchEntitlements: () => fetchEntitlements(apiBaseUrl, identity),
        persistEntitlements,
        prepareEntitledDecks: (entitlements) =>
          prepareEntitledDecks(entitlements, identity),
      });
      for (const purchase of purchases) {
        if (
          purchase.purchaseState === 'purchased'
          && purchase.purchaseToken
          && appleProducts.has(purchase.productId)
        ) {
          processedTransactions.current.add(purchase.transactionId ?? purchase.id);
        }
      }
      const newlyRestoredProductCount = result.entitlements.products.filter(
        (product) => !ownedBeforeRestore.has(product.productId),
      ).length;
      setServerReachable(true);
      setRestoreState({
        status: 'success',
        newlyRestoredProductCount,
        restoredProductCount: result.entitlements.products.length,
      });
      logCommerceDiagnostic('restore.completed', {
        elapsedMs: Date.now() - startedAt,
        finishFailureCount: result.finishFailureCount,
        newlyRestoredProductCount,
        restoredProductCount: result.entitlements.products.length,
        verifiedTransactionCount: result.verifiedTransactionCount,
      });
    } catch (error) {
      logCommerceDiagnostic('restore.failed', {
        elapsedMs: Date.now() - startedAt,
        error: describeCommerceError(error),
      }, 'warn');
      setRestoreState({
        status: 'error',
        message: 'Your purchases are safe, but restoration could not finish. Please try again.',
      });
    } finally {
      restoreInFlight.current = false;
    }
  }, [
    apiBaseUrl,
    appleProducts,
    connected,
    finishTransaction,
    identity,
    ownedProducts,
    persistEntitlements,
    prepareEntitledDecks,
    restoreStorePurchases,
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
    refreshCommerceConnection: () => { void refreshCommerceConnection(); },
    refreshStoreProducts,
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
    refreshCommerceConnection,
    refreshStoreProducts,
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

function createCommerceOperationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

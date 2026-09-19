import { useRouter } from 'expo-router';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  createCatalogDiscoveryRepository,
  type CatalogBundleCursor,
  type CatalogBundleSummary,
  type CatalogDeckCursor,
  type CatalogDeckSummary,
  type CatalogDiscoveryRepository,
} from '@/catalog/catalog-discovery';
import type { CatalogDeck, CatalogSnapshot } from '@/catalog/catalog-snapshot';
import { CatalogCoverImage } from '@/components/catalog-cover-image';
import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { OwnedCoverOverlay } from '@/components/owned-cover-overlay';
import { bundleRemainingDeckSavingsLabel } from '@/storefront/bundle-offer';
import {
  localizedCommercePrice,
  useBundleOffer,
  useCommerceProduct,
  useCommerceTesting,
  useOwnedDeckIds,
  useRestorePurchases,
} from '@/storefront/commerce-provider';
import { successfulRestoreNotice } from '@/storefront/restore-purchases-notice';
import {
  alphabeticalStorefrontOrder,
  sortStorefrontItems,
} from '@/storefront/storefront-catalog-order';
import { colors } from '@/theme';

const DISCOVERY_PAGE_SIZE = 100;

type ExploreSection = 'bundles' | 'decks';

export type RestorePurchasesNotice = {
  title: string;
  message: string;
};

function createQueryKey(search: string) {
  return search.trim();
}

function catalogDeckPage(catalog: CatalogSnapshot) {
  return catalog.paidDecks
    .map<CatalogDeckSummary>(({ cards: _cards, order: _order, version, ...deck }) => ({
      ...deck,
      deckVersion: version,
    }));
}

function catalogBundles(catalog: CatalogSnapshot) {
  return catalog.bundles
    .filter((bundle) => bundle.access === 'paid')
    .map<CatalogBundleSummary>((bundle) => ({
      id: bundle.id,
      title: bundle.title,
      description: bundle.description,
      access: bundle.access,
      ...(bundle.price === undefined ? {} : { price: bundle.price }),
      bundleVersion: bundle.version,
      deckIds: [...bundle.deckIds],
    }));
}

async function queryAllDecks(repository: CatalogDiscoveryRepository, search: string) {
  const decks: CatalogDeckSummary[] = [];
  let after: CatalogDeckCursor | undefined;
  do {
    const page = await repository.queryDecks({
      access: 'paid',
      search,
      limit: DISCOVERY_PAGE_SIZE,
      after,
    });
    decks.push(...page.decks);
    after = page.nextCursor ?? undefined;
  } while (after);
  return decks;
}

async function queryAllBundles(repository: CatalogDiscoveryRepository, search: string) {
  const bundles: CatalogBundleSummary[] = [];
  let after: CatalogBundleCursor | undefined;
  do {
    const page = await repository.queryBundles({
      access: 'paid',
      search,
      limit: DISCOVERY_PAGE_SIZE,
      after,
    });
    bundles.push(...page.bundles);
    after = page.nextCursor ?? undefined;
  } while (after);
  return bundles;
}

export const StorefrontExplore = forwardRef<
  { blurSearch: () => void },
  {
    catalog: CatalogSnapshot;
    onBrowseFocus?: (offset: number) => void;
    onRestoreNotice?: (notice: RestorePurchasesNotice) => void;
  }
>(function StorefrontExplore(
  {
    catalog,
    onBrowseFocus,
    onRestoreNotice,
  },
  ref,
) {
  const router = useRouter();
  const restore = useRestorePurchases();
  const commerceTesting = useCommerceTesting();
  const ownedDeckIds = useOwnedDeckIds();
  const restoreNoticePending = useRef(false);
  const [testingPrompt, setTestingPrompt] = useState<'new-device' | 'reset-ownership' | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  useImperativeHandle(ref, () => ({
    blurSearch: () => searchInputRef.current?.blur(),
  }), []);
  const [section, setSection] = useState<ExploreSection>('bundles');
  const [search, setSearch] = useState('');
  const [repository, setRepository] = useState<CatalogDiscoveryRepository | null>(null);
  const [decks, setDecks] = useState<CatalogDeckSummary[]>(
    () => catalogDeckPage(catalog),
  );
  const [bundles, setBundles] = useState<CatalogBundleSummary[]>(() => catalogBundles(catalog));
  const [searchOffset, setSearchOffset] = useState(0);
  const [sectionControlWidth, setSectionControlWidth] = useState(0);
  const loadedQueryKeys = useRef<Record<ExploreSection, string>>({
    bundles: '',
    decks: '',
  });
  const loadedRepositories = useRef<
    Record<ExploreSection, CatalogDiscoveryRepository | null>
  >({ bundles: null, decks: null });
  const reduceMotion = useReducedMotion();
  const activeSectionPosition = useSharedValue(section === 'decks' ? 1 : 0);
  const displayedDecks = useMemo(
    () => sortStorefrontItems(
      decks,
      alphabeticalStorefrontOrder(decks),
      (deck) => ownedDeckIds.has(deck.id),
    ),
    [decks, ownedDeckIds],
  );
  const displayedBundles = useMemo(
    () => sortStorefrontItems(
      bundles,
      catalog.bundles
        .filter((bundle) => bundle.access === 'paid')
        .sort((left, right) => left.order - right.order)
        .map((bundle) => bundle.id),
      (bundle) => bundle.deckIds.length > 0
        && bundle.deckIds.every((deckId) => ownedDeckIds.has(deckId)),
    ),
    [bundles, catalog.bundles, ownedDeckIds],
  );

  useEffect(() => {
    if (!restoreNoticePending.current) return;

    if (restore.state.status === 'success') {
      restoreNoticePending.current = false;
      onRestoreNotice?.(successfulRestoreNotice(restore.state));
    } else if (restore.state.status === 'error') {
      restoreNoticePending.current = false;
      onRestoreNotice?.({
        title: 'Restore couldn’t finish',
        message: restore.state.message,
      });
    }
  }, [onRestoreNotice, restore.state]);

  useEffect(() => {
    activeSectionPosition.value = withTiming(section === 'decks' ? 1 : 0, {
      duration: reduceMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeSectionPosition, reduceMotion, section]);

  const sectionIndicatorStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateX: activeSectionPosition.value * (sectionControlWidth / 2) },
      ],
    }),
    [sectionControlWidth],
  );

  useEffect(() => {
    let cancelled = false;
    const hydrateRepository = async () => {
      await Promise.resolve();
      if (cancelled) return;

      try {
        const nextRepository = await createCatalogDiscoveryRepository(catalog.source);
        if (cancelled) return;
        setRepository(nextRepository);
      } catch (cause: unknown) {
        if (!cancelled) {
          console.warn(
            '[StorefrontExplore] Cached discovery index could not be opened.',
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      }
    };

    void hydrateRepository();
    return () => {
      cancelled = true;
    };
  }, [catalog]);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    const queryKey = createQueryKey(search);
    if (
      loadedRepositories.current[section] === repository
      && loadedQueryKeys.current[section] === queryKey
    ) return;

    const timer = setTimeout(() => {
      const request =
        section === 'decks'
          ? queryAllDecks(repository, search).then((results) => {
              if (cancelled) return;
              setDecks(results);
              loadedQueryKeys.current.decks = queryKey;
              loadedRepositories.current.decks = repository;
            })
          : queryAllBundles(repository, search)
              .then((results) => {
                if (cancelled) return;
                setBundles(results);
                loadedQueryKeys.current.bundles = queryKey;
                loadedRepositories.current.bundles = repository;
              });
      void request
        .catch((cause: unknown) => {
          if (!cancelled) {
            console.warn(
              '[StorefrontExplore] Cached search could not be refreshed.',
              cause instanceof Error ? cause.message : String(cause),
            );
          }
        });
    }, 75);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repository, search, section]);

  const selectSection = (nextSection: ExploreSection) => {
    searchInputRef.current?.blur();
    setSection(nextSection);
  };

  return (
    <View style={styles.container}>
      <View
        accessibilityRole="tablist"
        onLayout={(event) => {
          setSectionControlWidth(event.nativeEvent.layout.width);
        }}
        style={styles.sectionControl}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sectionTabIndicator,
            {
              left: Math.max(0, sectionControlWidth / 4 - 32),
              opacity: sectionControlWidth > 0 ? 1 : 0,
            },
            sectionIndicatorStyle,
          ]}
        />
        <ExploreTab
          active={section === 'bundles'}
          label="BUNDLES"
          onPress={() => selectSection('bundles')}
        />
        <ExploreTab
          active={section === 'decks'}
          label="ALL DECKS"
          onPress={() => selectSection('decks')}
        />
      </View>

      <View
        onLayout={(event) => setSearchOffset(event.nativeEvent.layout.y)}
        style={styles.searchField}
      >
        <Text accessibilityElementsHidden style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel={`Search ${section === 'bundles' ? 'bundles' : 'decks'}`}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          onFocus={() => onBrowseFocus?.(searchOffset)}
          placeholder={section === 'bundles' ? 'Search bundles or included decks' : 'Search decks'}
          placeholderTextColor="#94A3B8"
          ref={searchInputRef}
          returnKeyType="search"
          style={styles.searchInput}
          value={search}
        />
        {search.length > 0 && (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setSearch('')}
            style={({ pressed }) => [styles.clearSearch, pressed && styles.pressed]}
          >
            <Text style={styles.clearSearchText}>×</Text>
          </Pressable>
        )}
      </View>

      {section === 'bundles' && search.trim().length === 0 && (
        <Text style={styles.bundleSavingsIntro}>Save more when you buy decks as a bundle!</Text>
      )}

      <Animated.View
        entering={reduceMotion ? undefined : FadeInUp.duration(200)}
        key={section}
        style={styles.resultSurface}
      >
          {section === 'bundles' ? (
            bundles.length > 0 ? (
              <View style={styles.bundleList}>
                {displayedBundles.map((bundle) => (
                  <BundleBrowseCard
                    bundle={bundle}
                    catalog={catalog}
                    key={bundle.id}
                    onPress={() =>
                      router.push({
                        pathname: '/store/bundle/[bundleId]',
                        params: { bundleId: bundle.id },
                      })
                    }
                  />
                ))}
              </View>
            ) : (
              <EmptyResults search={search} type="bundles" />
            )
          ) : decks.length > 0 ? (
            <>
              <View style={styles.deckList}>
                {displayedDecks.map((deck) => (
                  <DeckBrowseCard
                    deck={catalog.getDeckById(deck.id) ?? deck}
                    key={deck.id}
                    owned={ownedDeckIds.has(deck.id)}
                    onPress={() =>
                      router.push({
                        pathname: '/store/deck/[deckId]',
                        params: { deckId: deck.id },
                      })
                    }
                  />
                ))}
              </View>
            </>
          ) : (
            <EmptyResults search={search} type="decks" />
          )}
      </Animated.View>

      {restore.restorePurchases && (
        <View
          accessibilityLiveRegion="polite"
          style={styles.restorePurchases}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              busy: restore.state.status === 'restoring',
              disabled: restore.state.status === 'restoring',
            }}
            disabled={restore.state.status === 'restoring'}
            onPress={() => {
              restoreNoticePending.current = true;
              void restore.restorePurchases?.();
            }}
            style={({ pressed }) => [
              styles.restorePurchasesButton,
              pressed && styles.pressed,
            ]}
          >
            {restore.state.status === 'restoring' && (
              <ActivityIndicator color="#2563EB" size="small" />
            )}
            <Text style={styles.restorePurchasesText}>
              {restore.state.status === 'restoring'
                ? 'RESTORING…'
                : 'RESTORE PURCHASES'}
            </Text>
          </Pressable>

        </View>
      )}

      {commerceTesting && (
        <View accessibilityLiveRegion="polite" style={styles.testingTools}>
          <Text style={styles.testingTitle}>STAGING PURCHASE TESTING</Text>
          <Text style={styles.testingDescription}>
            These controls affect only this staging build and its sandbox ownership.
          </Text>
          <View style={styles.testingActions}>
            <Pressable
              accessibilityRole="button"
              disabled={commerceTesting.state.status === 'working'}
              onPress={() => setTestingPrompt('new-device')}
              style={({ pressed }) => [styles.testingButton, pressed && styles.pressed]}
            >
              <Text style={styles.testingButtonText}>SIMULATE NEW DEVICE</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={commerceTesting.state.status === 'working'}
              onPress={() => setTestingPrompt('reset-ownership')}
              style={({ pressed }) => [styles.testingButton, pressed && styles.pressed]}
            >
              <Text style={styles.testingButtonText}>RESET SANDBOX OWNERSHIP</Text>
            </Pressable>
          </View>
          {commerceTesting.state.status === 'working' && (
            <ActivityIndicator color="#2563EB" size="small" />
          )}
          {(commerceTesting.state.status === 'success' || commerceTesting.state.status === 'error') && (
            <Text
              selectable
              style={commerceTesting.state.status === 'success'
                ? styles.restorePurchasesMessage
                : styles.restorePurchasesError}
            >
              {commerceTesting.state.message}
            </Text>
          )}
        </View>
      )}

      <ConfirmationPrompt
        visible={testingPrompt !== null}
        title={testingPrompt === 'new-device' ? 'Simulate a new device?' : 'Reset sandbox ownership?'}
        message={testingPrompt === 'new-device'
          ? 'This clears paid decks from this installation and creates a new installation identity. Your Apple sandbox purchase remains available to restore.'
          : 'This revokes this installation’s staging entitlements and removes its paid decks. You must also clear the Sandbox Apple Account purchase history before buying again.'}
        confirmLabel={testingPrompt === 'new-device' ? 'SIMULATE' : 'RESET'}
        destructive={testingPrompt === 'reset-ownership'}
        onCancel={() => setTestingPrompt(null)}
        onConfirm={() => {
          const operation = testingPrompt;
          setTestingPrompt(null);
          if (operation === 'new-device') void commerceTesting?.simulateNewDevice();
          if (operation === 'reset-ownership') void commerceTesting?.resetSandboxOwnership();
        }}
      />
    </View>
  );
});

function ExploreTab({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.sectionTab, pressed && styles.pressed]}
    >
      <Text style={[styles.sectionTabText, active && styles.sectionTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function BundleBrowseCard({
  bundle,
  catalog,
  onPress,
}: {
  bundle: CatalogBundleSummary;
  catalog: CatalogSnapshot;
  onPress: () => void;
}) {
  const catalogBundle = catalog.getBundleById(bundle.id);
  const commerceTarget = {
    access: catalogBundle?.access ?? bundle.access,
    id: bundle.id,
    kind: 'bundle' as const,
    title: bundle.title,
  };
  const commerce = useCommerceProduct(commerceTarget);
  const offer = useBundleOffer(bundle.id);
  const ownedDeckIds = useOwnedDeckIds();
  const ownedDeckCount = bundle.deckIds.filter((id) => ownedDeckIds.has(id)).length;
  const hasPartialOwnership = ownedDeckCount > 0 && ownedDeckCount < bundle.deckIds.length;
  const localizedPrice = localizedCommercePrice(commerce.state);
  const bundleStatus = commerce.state.status === 'owned'
    ? 'OWNED'
    : localizedPrice;
  const remainingSavingsLabel = localizedPrice
    ? bundleRemainingDeckSavingsLabel(offer)
    : null;
  const comparisonPrice = localizedPrice ? offer?.comparisonPrice : null;
  const comparisonDescription = offer?.comparisonKind === 'bundle' ? 'regular bundle price' : 'separately';
  const decks = useMemo(
    () => bundle.deckIds
      .map((id) => catalog.getDeckById(id))
      .filter((deck): deck is CatalogDeck => deck !== undefined)
      .slice(0, 3),
    [bundle.deckIds, catalog],
  );
  return (
    <Pressable
      accessibilityHint="Opens bundle details"
      accessibilityLabel={`${bundle.title}, ${bundle.deckIds.length} decks${hasPartialOwnership ? `, ${ownedDeckCount} of ${bundle.deckIds.length} owned` : ''}${bundleStatus ? `, bundle ${bundleStatus}` : ''}${comparisonPrice ? `, compared with ${comparisonPrice} ${comparisonDescription}` : ''}${remainingSavingsLabel ? `, ${remainingSavingsLabel}` : ''}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.bundleCard,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.bundleBody}>
        <View style={styles.bundleCopy}>
          <Text numberOfLines={2} style={styles.bundleTitle}>{bundle.title}</Text>
          <Text style={styles.bundleDescription}>{bundle.description || `${bundle.deckIds.length} decks in one collection.`}</Text>
          <Text style={styles.bundleMeta}>{bundle.deckIds.length} DECKS{hasPartialOwnership ? ` · ${ownedDeckCount}/${bundle.deckIds.length} OWNED` : ''}</Text>
          {bundleStatus && (
            <View style={styles.bundlePriceBadge}>
              <View style={styles.bundlePriceRow}>
                <Text style={styles.bundlePrice}>{bundleStatus}</Text>
                {comparisonPrice && (
                  <Text style={styles.bundleComparisonPrice}>{comparisonPrice}</Text>
                )}
              </View>
              {remainingSavingsLabel && (
                <Text style={styles.bundleSavingsLabel}>{remainingSavingsLabel}</Text>
              )}
            </View>
          )}
        </View>
        <View accessibilityElementsHidden style={styles.fan}>
          {decks.map((deck, index) => {
            return (
              <View
                key={deck.id}
                style={[
                  styles.fanCard,
                  {
                    left: 13 + (decks.length - 1) * 8 - index * 12,
                    transform: [
                      { rotate: `${-6 - index * 5}deg` },
                      { translateY: index * 12 },
                    ],
                    zIndex: decks.length - index,
                  },
                ]}
              >
                <CatalogCoverImage
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  deck={deck}
                  fallback={<View style={styles.fanFallback} />}
                  localOnly
                  style={StyleSheet.absoluteFill}
                />
              </View>
            );
          })}
        </View>
      </View>
    </Pressable>
  );
}

function DeckBrowseCard({
  deck,
  owned,
  onPress,
}: {
  deck: CatalogDeckSummary | CatalogSnapshot['decks'][number];
  owned: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens deck details"
      accessibilityLabel={`${deck.title}, ${deck.cardCount} cards${owned ? ', owned' : ''}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.deckCard, pressed && styles.cardPressed]}
    >
      <View style={styles.deckCover}>
        <CatalogCoverImage
          accessibilityLabel={deck.title}
          cachePolicy="memory-disk"
          contentFit="cover"
          deck={deck}
          fallback={(
            <View style={styles.deckFallback}>
              <Text style={styles.deckFallbackText}>{deck.title}</Text>
            </View>
          )}
          localOnly
          style={StyleSheet.absoluteFill}
        />
        {owned && <OwnedCoverOverlay />}
      </View>
    </Pressable>
  );
}

function EmptyResults({ search, type }: { search: string; type: string }) {
  return (
    <View style={styles.messageCard}>
      <Text style={styles.messageTitle}>No {type} found</Text>
      <Text style={styles.messageBody}>{search ? 'Try a different search.' : `No ${type} are available yet.`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  sectionControl: {
    position: 'relative',
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CBD5E1',
  },
  sectionTab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 1,
  },
  sectionTabText: { color: '#64748B', fontSize: 12, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.6 },
  sectionTabTextActive: { color: '#2563EB' },
  sectionTabIndicator: {
    width: 64,
    height: 3,
    position: 'absolute',
    bottom: -StyleSheet.hairlineWidth,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#459EFE',
  },
  searchField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, borderWidth: 1, borderColor: '#DCE5EF', borderRadius: 18, backgroundColor: '#FFFFFF' },
  searchIcon: { color: '#64748B', fontSize: 25, marginTop: -4 },
  searchInput: { flex: 1, color: '#111827', fontSize: 15, paddingVertical: 14 },
  clearSearch: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#E2E8F0' },
  clearSearchText: { color: '#475569', fontSize: 23, lineHeight: 25, fontFamily: 'Inter_700Bold', fontWeight: '700', marginTop: -2 },
  resultSurface: { gap: 14 },
  bundleSavingsIntro: { color: '#475569', fontSize: 13, lineHeight: 18, fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
  bundleList: { gap: 16 },
  bundleCard: { minHeight: 210, overflow: 'hidden', padding: 22, borderWidth: 1, borderColor: '#DCE8F5', borderRadius: 26, backgroundColor: '#FFFFFF', boxShadow: '0 5px 16px rgba(71, 85, 105, 0.10)' },
  bundleBody: { minHeight: 190, position: 'relative', justifyContent: 'center' },
  bundleCopy: { width: '60%', gap: 8, zIndex: 10 },
  bundleTitle: { color: '#111827', fontSize: 21, lineHeight: 25, fontFamily: 'Inter_900Black', fontWeight: '900' },
  bundleDescription: { color: '#64748B', fontSize: 13, lineHeight: 18 },
  bundleMeta: { color: '#459EFE', fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.7 },
  bundlePriceBadge: { alignSelf: 'flex-start', maxWidth: '100%', gap: 2, alignItems: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: '#FFF1E8' },
  bundlePriceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  bundleComparisonPrice: { color: '#64748B', fontSize: 11, fontFamily: 'Inter_600SemiBold', fontWeight: '600', textDecorationLine: 'line-through' },
  bundlePrice: { color: colors.pass, fontSize: 17, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.2 },
  bundleSavingsLabel: { color: '#64748B', fontSize: 11, lineHeight: 15, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  fan: { width: 190, height: 190, position: 'absolute', top: '50%', right: -90, marginTop: -99, zIndex: 2 },
  fanCard: { width: 104, height: 156, position: 'absolute', top: 10, overflow: 'hidden', borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 9, backgroundColor: '#DCE5EF', boxShadow: '0 5px 12px rgba(15, 23, 42, 0.24)' },
  fanFallback: { flex: 1, backgroundColor: '#BFDBFE' },
  deckList: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  deckCard: { width: '29.8%', aspectRatio: 2 / 3, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 7, backgroundColor: '#FFFFFF', boxShadow: '0 3px 10px rgba(71, 85, 105, 0.13)' },
  deckCover: { width: '100%', aspectRatio: 2 / 3, overflow: 'hidden', backgroundColor: '#DBEAFE' },
  deckFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  deckFallbackText: { color: '#1E3A8A', textAlign: 'center', fontSize: 15, fontFamily: 'Inter_900Black', fontWeight: '900' },
  messageCard: { gap: 8, padding: 22, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 20, backgroundColor: '#FFFFFF' },
  messageTitle: { color: '#111827', fontSize: 17, fontFamily: 'Inter_900Black', fontWeight: '900' },
  messageBody: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  restorePurchases: { alignItems: 'center', gap: 9, paddingTop: 8 },
  restorePurchasesButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
  },
  restorePurchasesText: {
    color: '#2563EB',
    fontSize: 11,
    fontFamily: 'Inter_900Black',
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  restorePurchasesMessage: {
    color: '#4B7A27',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  restorePurchasesError: {
    color: '#B45309',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  testingTools: {
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 18,
    backgroundColor: '#FFFBEB',
  },
  testingTitle: { color: '#92400E', fontSize: 11, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.8 },
  testingDescription: { color: '#78716C', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  testingActions: { width: '100%', gap: 8 },
  testingButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
  },
  testingButtonText: { color: '#92400E', fontSize: 10, fontFamily: 'Inter_900Black', fontWeight: '900', letterSpacing: 0.65 },
  pressed: { opacity: 0.72 },
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
});

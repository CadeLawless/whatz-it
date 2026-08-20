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
  type CatalogBundleSummary,
  type CatalogDeckCursor,
  type CatalogDeckSummary,
  type CatalogDiscoveryRepository,
} from '@/catalog/catalog-discovery';
import { catalogLocalCoverSources } from '@/catalog/catalog-media';
import type { CatalogSnapshot } from '@/catalog/catalog-snapshot';
import { CatalogCoverImage } from '@/components/catalog-cover-image';
import { useRestorePurchases } from '@/storefront/commerce-provider';

const PAGE_SIZE = 24;

type ExploreSection = 'bundles' | 'decks';

function createQueryKey(search: string) {
  return search.trim();
}

export const StorefrontExplore = forwardRef<
  { blurSearch: () => void },
  {
    catalog: CatalogSnapshot;
    syncStatus: 'disabled' | 'syncing' | 'synced' | 'failed' | null;
    onBrowseFocus?: (offset: number) => void;
  }
>(function StorefrontExplore(
  {
    catalog,
    syncStatus,
    onBrowseFocus,
  },
  ref,
) {
  const router = useRouter();
  const restore = useRestorePurchases();
  const searchInputRef = useRef<TextInput>(null);
  const isScrollingProgrammatically = useRef(false);

  useImperativeHandle(ref, () => ({
    blurSearch: () => {
      if (!isScrollingProgrammatically.current) {
        searchInputRef.current?.blur();
      }
    },
  }), []);
  const [section, setSection] = useState<ExploreSection>('bundles');
  const [search, setSearch] = useState('');
  const [repository, setRepository] = useState<CatalogDiscoveryRepository | null>(null);
  const [decks, setDecks] = useState<CatalogDeckSummary[]>([]);
  const [bundles, setBundles] = useState<CatalogBundleSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<CatalogDeckCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOffset, setSearchOffset] = useState(0);
  const [tabsOffset, setTabsOffset] = useState(0);
  const [sectionControlWidth, setSectionControlWidth] = useState(0);
  const [resultVersion, setResultVersion] = useState(0);
  const loadedQueryKeys = useRef<Record<ExploreSection, string>>({
    bundles: '',
    decks: '',
  });
  const reduceMotion = useReducedMotion();
  const activeSectionPosition = useSharedValue(section === 'decks' ? 1 : 0);

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

      setLoading(true);
      setError(null);
      setRepository(null);

      try {
        const localCoverSources = catalog.paidDecks.map(
          (deck) => catalogLocalCoverSources(deck, 'cover')[0],
        );
        if (localCoverSources.some((source) => source === undefined)) {
          return;
        }

        const nextRepository = await createCatalogDiscoveryRepository(catalog.source);
        const [deckPage, bundlePage] = await Promise.all([
          nextRepository.queryDecks({ access: 'paid', limit: PAGE_SIZE }),
          nextRepository.queryBundles({ access: 'paid', limit: PAGE_SIZE }),
        ]);
        if (cancelled) return;

        setDecks(deckPage.decks);
        setNextCursor(deckPage.nextCursor);
        setBundles(bundlePage.bundles);
        loadedQueryKeys.current = {
          bundles: createQueryKey(''),
          decks: createQueryKey(''),
        };
        setResultVersion((current) => current + 1);
        setRepository(nextRepository);
        setLoading(false);
      } catch (cause: unknown) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Explore could not be loaded.');
          setLoading(false);
        }
      }
    };

    void hydrateRepository();
    return () => {
      cancelled = true;
    };
  }, [catalog, syncStatus]);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    const queryKey = createQueryKey(search);
    if (loadedQueryKeys.current[section] === queryKey) return;

    const timer = setTimeout(() => {
      setError(null);
      const request =
        section === 'decks'
          ? repository.queryDecks({
              access: 'paid',
              search,
              limit: PAGE_SIZE,
            }).then((page) => {
              if (cancelled) return;
              setDecks(page.decks);
              setNextCursor(page.nextCursor);
              loadedQueryKeys.current.decks = queryKey;
              setResultVersion((current) => current + 1);
            })
          : repository
              .queryBundles({ access: 'paid', search, limit: PAGE_SIZE })
              .then((page) => {
                if (cancelled) return;
                setBundles(page.bundles);
                loadedQueryKeys.current.bundles = queryKey;
                setResultVersion((current) => current + 1);
              });
      void request
        .catch((cause: unknown) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : 'Explore could not be loaded.');
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repository, search, section]);

  const selectSection = (nextSection: ExploreSection) => {
    isScrollingProgrammatically.current = true;
    searchInputRef.current?.blur();
    setSection(nextSection);
    onBrowseFocus?.(tabsOffset - 18);
    setTimeout(() => {
      isScrollingProgrammatically.current = false;
    }, 500);
  };

  const loadMore = async () => {
    if (!repository || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await repository.queryDecks({
        access: 'paid',
        search,
        limit: PAGE_SIZE,
        after: nextCursor,
      });
      setDecks((current) => [...current, ...page.decks]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'More decks could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <View style={styles.container}>
      <View
        accessibilityRole="tablist"
        onLayout={(event) => {
          setTabsOffset(event.nativeEvent.layout.y);
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
          onFocus={() => {
            isScrollingProgrammatically.current = true;
            onBrowseFocus?.(searchOffset);
            setTimeout(() => {
              isScrollingProgrammatically.current = false;
            }, 500);
          }}
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

      {loading ? (
        <View accessibilityRole="progressbar" style={styles.loading}>
          <ActivityIndicator color="#459EFE" />
        </View>
      ) : (
        <Animated.View
          entering={reduceMotion ? undefined : FadeInUp.duration(200)}
          key={`${section}-${resultVersion}`}
          style={styles.resultSurface}
        >
          {error ? (
            <View accessibilityLiveRegion="polite" style={styles.messageCard}>
              <Text selectable style={styles.messageTitle}>Explore is unavailable</Text>
              <Text selectable style={styles.messageBody}>{error}</Text>
            </View>
          ) : section === 'bundles' ? (
            bundles.length > 0 ? (
              <View style={styles.bundleList}>
                {bundles.map((bundle, index) => (
                  <BundleBrowseCard
                    bundle={bundle}
                    catalog={catalog}
                    fanSide={index % 2 === 0 ? 'right' : 'left'}
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
                {decks.map((deck) => (
                  <DeckBrowseCard
                    deck={catalog.getDeckById(deck.id) ?? deck}
                    key={deck.id}
                    onPress={() =>
                      router.push({
                        pathname: '/store/deck/[deckId]',
                        params: { deckId: deck.id },
                      })
                    }
                  />
                ))}
              </View>
              {nextCursor && (
                <Pressable
                  accessibilityRole="button"
                  disabled={loadingMore}
                  onPress={() => void loadMore()}
                  style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
                >
                  {loadingMore ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.loadMoreText}>LOAD MORE DECKS</Text>
                  )}
                </Pressable>
              )}
            </>
          ) : (
            <EmptyResults search={search} type="decks" />
          )}
        </Animated.View>
      )}

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
            onPress={() => void restore.restorePurchases?.()}
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

          {restore.state.status === 'success' && (
            <Text selectable style={styles.restorePurchasesMessage}>
              {restore.state.restoredProductCount > 0
                ? 'Your purchases are restored and available decks are ready offline.'
                : 'No previous purchases were found for this Apple Account.'}
            </Text>
          )}
          {restore.state.status === 'error' && (
            <Text selectable style={styles.restorePurchasesError}>
              {restore.state.message}
            </Text>
          )}
        </View>
      )}
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
  fanSide,
  onPress,
}: {
  bundle: CatalogBundleSummary;
  catalog: CatalogSnapshot;
  fanSide: 'left' | 'right';
  onPress: () => void;
}) {
  const decks = useMemo(
    () => bundle.deckIds.map((id) => catalog.getDeckById(id)).filter(Boolean).slice(0, 4),
    [bundle.deckIds, catalog],
  );
  return (
    <Pressable
      accessibilityHint="Opens bundle details"
      accessibilityLabel={`${bundle.title}, ${bundle.deckIds.length} decks`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.bundleCard,
        pressed && styles.cardPressed,
      ]}
    >
      <View
        style={[
          styles.bundleCopy,
          fanSide === 'left' ? styles.bundleCopyRight : styles.bundleCopyLeft,
        ]}
      >
        <Text numberOfLines={2} style={styles.bundleTitle}>{bundle.title}</Text>
        <Text numberOfLines={3} style={styles.bundleDescription}>{bundle.description || `${bundle.deckIds.length} decks in one collection.`}</Text>
        <Text style={styles.bundleMeta}>{bundle.deckIds.length} DECKS</Text>
      </View>
      <View
        accessibilityElementsHidden
        style={[
          styles.fan,
          fanSide === 'left' ? styles.fanLeft : styles.fanRight,
        ]}
      >
        {decks.map((deck, index) => (
          <View
            key={deck!.id}
            style={[
              styles.fanCard,
              {
                ...(fanSide === 'left'
                  ? { right: 13 + index * 14 }
                  : { left: 13 + index * 14 }),
                transform: [
                  {
                    rotate: `${(index - (decks.length - 1) / 2) * 8 * (fanSide === 'left' ? -1 : 1)}deg`,
                  },
                  { translateY: Math.abs(index - (decks.length - 1) / 2) * 4 },
                ],
                zIndex: index + 1,
              },
            ]}
          >
            <CatalogCoverImage
              cachePolicy="memory-disk"
              contentFit="cover"
              deck={deck!}
              fallback={<View style={styles.fanFallback} />}
              localOnly
              style={StyleSheet.absoluteFill}
            />
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function DeckBrowseCard({
  deck,
  onPress,
}: {
  deck: CatalogDeckSummary | CatalogSnapshot['decks'][number];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens deck details"
      accessibilityLabel={`${deck.title}, ${deck.cardCount} cards`}
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
  sectionTabText: { color: '#64748B', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
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
  clearSearchText: { color: '#475569', fontSize: 23, lineHeight: 25, fontWeight: '700', marginTop: -2 },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
  resultSurface: { gap: 14 },
  bundleList: { gap: 16 },
  bundleCard: { minHeight: 190, position: 'relative', justifyContent: 'center', overflow: 'hidden', padding: 22, borderWidth: 1, borderColor: '#DCE8F5', borderRadius: 26, backgroundColor: '#FFFFFF', boxShadow: '0 5px 16px rgba(71, 85, 105, 0.10)' },
  bundleCopy: { width: '57%', gap: 8, zIndex: 10 },
  bundleCopyLeft: { alignSelf: 'flex-start' },
  bundleCopyRight: { alignSelf: 'flex-end' },
  bundleTitle: { color: '#111827', fontSize: 21, lineHeight: 25, fontWeight: '900' },
  bundleDescription: { color: '#64748B', fontSize: 13, lineHeight: 18 },
  bundleMeta: { color: '#459EFE', fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  fan: { width: 150, height: 150, position: 'absolute', top: '50%', marginTop: -57, zIndex: 2 },
  fanLeft: { left: -30, transform: [{ rotate: '12deg' }] },
  fanRight: { right: -30, transform: [{ rotate: '-12deg' }] },
  fanCard: { width: 82, aspectRatio: 2 / 3, position: 'absolute', top: 10, overflow: 'hidden', borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 9, backgroundColor: '#DCE5EF', boxShadow: '0 5px 12px rgba(15, 23, 42, 0.24)' },
  fanFallback: { flex: 1, backgroundColor: '#BFDBFE' },
  deckList: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  deckCard: { width: '29.8%', aspectRatio: 2 / 3, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 7, backgroundColor: '#FFFFFF', boxShadow: '0 3px 10px rgba(71, 85, 105, 0.13)' },
  deckCover: { width: '100%', aspectRatio: 2 / 3, overflow: 'hidden', backgroundColor: '#DBEAFE' },
  deckFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  deckFallbackText: { color: '#1E3A8A', textAlign: 'center', fontSize: 15, fontWeight: '900' },
  messageCard: { gap: 8, padding: 22, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 20, backgroundColor: '#FFFFFF' },
  messageTitle: { color: '#111827', fontSize: 17, fontWeight: '900' },
  messageBody: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#459EFE' },
  loadMoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
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
  pressed: { opacity: 0.72 },
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
});

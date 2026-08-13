import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createCatalogDiscoveryRepository,
  type CatalogBundleSummary,
  type CatalogDeckCursor,
  type CatalogDeckSummary,
  type CatalogDiscoveryRepository,
  type CatalogTagFacet,
} from '@/catalog/catalog-discovery';
import type { CatalogSnapshot } from '@/catalog/catalog-snapshot';

const PAGE_SIZE = 24;

type ExploreSection = 'bundles' | 'decks';

export function StorefrontExplore({ catalog }: { catalog: CatalogSnapshot }) {
  const [section, setSection] = useState<ExploreSection>('bundles');
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [repository, setRepository] = useState<CatalogDiscoveryRepository | null>(null);
  const [decks, setDecks] = useState<CatalogDeckSummary[]>([]);
  const [bundles, setBundles] = useState<CatalogBundleSummary[]>([]);
  const [tags, setTags] = useState<CatalogTagFacet[]>([]);
  const [nextCursor, setNextCursor] = useState<CatalogDeckCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void createCatalogDiscoveryRepository(catalog.source)
      .then((nextRepository) => {
        if (!cancelled) setRepository(nextRepository);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Explore could not be loaded.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [catalog.revision, catalog.source]);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      const request =
        section === 'decks'
          ? Promise.all([
              repository.queryDecks({
                access: 'paid',
                search,
                tags: selectedTags,
                tagMode: 'all',
                limit: PAGE_SIZE,
              }),
              repository.listTags('paid'),
            ]).then(([page, facets]) => {
              if (cancelled) return;
              setDecks(page.decks);
              setNextCursor(page.nextCursor);
              setTags(facets);
            })
          : repository
              .queryBundles({ access: 'paid', search, limit: PAGE_SIZE })
              .then((page) => {
                if (cancelled) return;
                setBundles(page.bundles);
                setNextCursor(null);
              });
      void request
        .catch((cause: unknown) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : 'Explore could not be loaded.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repository, search, section, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((candidate) => candidate !== tag)
        : [...current, tag],
    );
  };

  const loadMore = async () => {
    if (!repository || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await repository.queryDecks({
        access: 'paid',
        search,
        tags: selectedTags,
        tagMode: 'all',
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
      <Text style={styles.eyebrow}>EXPLORE</Text>
      <Text style={styles.title}>Find your next favorite deck</Text>
      <Text style={styles.intro}>
        Browse the latest catalog even when you are offline. Purchases will be added in a later phase.
      </Text>

      <View accessibilityRole="tablist" style={styles.sectionControl}>
        <ExploreTab
          active={section === 'bundles'}
          label="BUNDLES"
          onPress={() => {
            setSection('bundles');
            setSelectedTags([]);
          }}
        />
        <ExploreTab
          active={section === 'decks'}
          label="ALL DECKS"
          onPress={() => setSection('decks')}
        />
      </View>

      <View style={styles.searchField}>
        <Text accessibilityElementsHidden style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel={`Search ${section === 'bundles' ? 'bundles' : 'decks'}`}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setSearch}
          placeholder={section === 'bundles' ? 'Search bundles or included decks' : 'Search names, descriptions, or tags'}
          placeholderTextColor="#94A3B8"
          returnKeyType="search"
          style={styles.searchInput}
          value={search}
        />
      </View>

      {section === 'decks' && tags.length > 0 && (
        <View style={styles.filters}>
          <Text style={styles.filterLabel}>FILTER BY TAG</Text>
          <View style={styles.tagList}>
            {tags.map((facet) => (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedTags.includes(facet.tag) }}
                key={facet.tag}
                onPress={() => toggleTag(facet.tag)}
                style={({ pressed }) => [
                  styles.tag,
                  selectedTags.includes(facet.tag) && styles.tagSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.tagText,
                    selectedTags.includes(facet.tag) && styles.tagTextSelected,
                  ]}
                >
                  {facet.tag} · {facet.deckCount}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {loading ? (
        <View accessibilityRole="progressbar" style={styles.loading}>
          <ActivityIndicator color="#459EFE" />
          <Text style={styles.loadingText}>Loading your saved catalog…</Text>
        </View>
      ) : error ? (
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
              />
            ))}
          </View>
        ) : (
          <EmptyResults search={search} type="bundles" />
        )
      ) : decks.length > 0 ? (
        <>
          <View style={styles.deckList}>
            {decks.map((deck) => <DeckBrowseCard deck={deck} key={deck.id} />)}
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
    </View>
  );
}

function ExploreTab({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.sectionTab, active && styles.sectionTabActive, pressed && styles.pressed]}
    >
      <Text style={[styles.sectionTabText, active && styles.sectionTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function BundleBrowseCard({
  bundle,
  catalog,
  fanSide,
}: {
  bundle: CatalogBundleSummary;
  catalog: CatalogSnapshot;
  fanSide: 'left' | 'right';
}) {
  const decks = useMemo(
    () => bundle.deckIds.map((id) => catalog.getDeckById(id)).filter(Boolean).slice(0, 4),
    [bundle.deckIds, catalog],
  );
  return (
    <Pressable
      accessibilityHint="Bundle details are coming soon"
      accessibilityLabel={`${bundle.title}, ${bundle.deckIds.length} decks`}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.bundleCard,
        fanSide === 'left' && styles.bundleCardReversed,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.bundleCopy}>
        <Text numberOfLines={2} style={styles.bundleTitle}>{bundle.title}</Text>
        <Text numberOfLines={3} style={styles.bundleDescription}>{bundle.description || `${bundle.deckIds.length} decks in one collection.`}</Text>
        <Text style={styles.bundleMeta}>{bundle.deckIds.length} DECKS</Text>
      </View>
      <View accessibilityElementsHidden style={styles.fan}>
        {decks.map((deck, index) => (
          <View
            key={deck!.id}
            style={[
              styles.fanCard,
              {
                left: 10 + index * 12,
                transform: [
                  { rotate: `${(index - (decks.length - 1) / 2) * 7}deg` },
                  { translateY: Math.abs(index - (decks.length - 1) / 2) * 3 },
                ],
                zIndex: index + 1,
              },
            ]}
          >
            {deck!.coverUri || deck!.coverImage ? (
              <Image
                cachePolicy="memory-disk"
                contentFit="cover"
                source={deck!.coverUri || deck!.coverImage}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <View style={styles.fanFallback} />
            )}
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function DeckBrowseCard({ deck }: { deck: CatalogDeckSummary }) {
  return (
    <Pressable
      accessibilityHint="Deck preview and purchasing are coming soon"
      accessibilityLabel={`${deck.title}, ${deck.cardCount} cards`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.deckCard, pressed && styles.cardPressed]}
    >
      <View style={styles.deckCover}>
        {deck.thumbnailUri || deck.coverUri || deck.coverImage ? (
          <Image
            accessibilityLabel={deck.title}
            cachePolicy="memory-disk"
            contentFit="cover"
            source={deck.thumbnailUri || deck.coverUri || deck.coverImage}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={styles.deckFallback}><Text style={styles.deckFallbackText}>{deck.title}</Text></View>
        )}
      </View>
      <View style={styles.deckCopy}>
        <Text numberOfLines={2} style={styles.deckTitle}>{deck.title}</Text>
        <Text numberOfLines={2} style={styles.deckDescription}>{deck.description}</Text>
        <Text style={styles.deckMeta}>{deck.cardCount} CARDS</Text>
      </View>
    </Pressable>
  );
}

function EmptyResults({ search, type }: { search: string; type: string }) {
  return (
    <View style={styles.messageCard}>
      <Text style={styles.messageTitle}>No {type} found</Text>
      <Text style={styles.messageBody}>{search ? 'Try a different search or remove a filter.' : `No ${type} are available yet.`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 18, paddingTop: 4 },
  eyebrow: { color: '#459EFE', fontSize: 14, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#111827', fontSize: 28, lineHeight: 32, fontWeight: '900' },
  intro: { color: '#64748B', fontSize: 15, lineHeight: 22 },
  sectionControl: { flexDirection: 'row', gap: 6, padding: 5, borderRadius: 20, backgroundColor: '#E8EEF5' },
  sectionTab: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  sectionTabActive: { backgroundColor: '#FFFFFF', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.12)' },
  sectionTabText: { color: '#64748B', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  sectionTabTextActive: { color: '#2563EB' },
  searchField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, borderWidth: 1, borderColor: '#DCE5EF', borderRadius: 18, backgroundColor: '#FFFFFF' },
  searchIcon: { color: '#64748B', fontSize: 25, marginTop: -4 },
  searchInput: { flex: 1, color: '#111827', fontSize: 15, paddingVertical: 14 },
  filters: { gap: 10 },
  filterLabel: { color: '#64748B', fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  tagList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#DCE5EF', borderRadius: 17, backgroundColor: '#FFFFFF' },
  tagSelected: { borderColor: '#459EFE', backgroundColor: '#EAF4FF' },
  tagText: { color: '#64748B', fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  tagTextSelected: { color: '#2563EB' },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#64748B', fontSize: 14, fontWeight: '700' },
  bundleList: { gap: 16 },
  bundleCard: { minHeight: 174, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden', padding: 20, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 26, backgroundColor: '#FFFFFF', boxShadow: '0 5px 16px rgba(71, 85, 105, 0.10)' },
  bundleCardReversed: { flexDirection: 'row-reverse' },
  bundleCopy: { flex: 1, gap: 8, zIndex: 10 },
  bundleTitle: { color: '#111827', fontSize: 21, lineHeight: 25, fontWeight: '900' },
  bundleDescription: { color: '#64748B', fontSize: 13, lineHeight: 18 },
  bundleMeta: { color: '#459EFE', fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  fan: { width: 128, height: 134, position: 'relative' },
  fanCard: { width: 74, height: 111, position: 'absolute', top: 10, overflow: 'hidden', borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 9, backgroundColor: '#DCE5EF', boxShadow: '0 4px 10px rgba(15, 23, 42, 0.18)' },
  fanFallback: { flex: 1, backgroundColor: '#BFDBFE' },
  deckList: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  deckCard: { width: '47.5%', overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 18, backgroundColor: '#FFFFFF', boxShadow: '0 3px 10px rgba(71, 85, 105, 0.10)' },
  deckCover: { width: '100%', aspectRatio: 2 / 3, overflow: 'hidden', backgroundColor: '#DBEAFE' },
  deckFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  deckFallbackText: { color: '#1E3A8A', textAlign: 'center', fontSize: 15, fontWeight: '900' },
  deckCopy: { gap: 5, padding: 12 },
  deckTitle: { color: '#111827', fontSize: 15, lineHeight: 18, fontWeight: '900' },
  deckDescription: { color: '#64748B', fontSize: 11, lineHeight: 15 },
  deckMeta: { color: '#459EFE', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  messageCard: { gap: 8, padding: 22, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 20, backgroundColor: '#FFFFFF' },
  messageTitle: { color: '#111827', fontSize: 17, fontWeight: '900' },
  messageBody: { color: '#64748B', fontSize: 14, lineHeight: 20 },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#459EFE' },
  loadMoreText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
  pressed: { opacity: 0.72 },
  cardPressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
});

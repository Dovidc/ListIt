import { useAuth } from '../auth/AuthContext.mjs';
import { useListings } from './ListingsContext.mjs';
import {
  asArray,
  normalizeListingsResponse
} from '../../app/shared/utils.mjs';

const ReactGlobal = typeof React !== 'undefined' ? React : null;
const useCallback = ReactGlobal?.useCallback?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;

const PAGE_SIZE = 75;

export function useListingsController(api, { onCoverPatch } = {}) {
  if (!useCallback || !useEffect) {
    throw new Error('useListingsController requires React to be loaded globally.');
  }
  if (!api || typeof api.listAll !== 'function') {
    throw new Error('useListingsController requires an API client.');
  }

  const { user } = typeof useAuth === 'function' ? useAuth() : { user: null };
  const listings = useListings();

  const {
    tab,
    setTab,
    tabRef,
    all,
    setAll,
    mine,
    setMine,
    query,
    setQuery,
    locationQuery,
    setLocationQuery,
    sort,
    setSort,
    ads,
    setAds,
    viewingSeller,
    setViewingSeller,
    hasNext,
    setHasNext,
    isFetchingListings,
    setIsFetchingListings,
    sentinelRef,
    loadingListingsRef,
    nextCursorRef,
    reloadReqRef,
    selectedListing,
    setSelectedListing,
    editing,
    setEditing,
    debouncedQuery,
    debouncedLocation
  } = listings;

  const refreshAds = useCallback(async () => {
    try {
      const rows = await api.listAds({ silent: true });
      setAds(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load ads', err);
      setAds([]);
    }
  }, [api, setAds]);

  const reloadMineOnly = useCallback(async () => {
    if (!user) {
      setMine([]);
      return;
    }
    try {
      const mineRows = await api.listMine({ silent: true });
      setMine(asArray(mineRows));
    } catch {
      setMine([]);
    }
  }, [api, user?.id, setMine]);

  const loadListings = useCallback(async ({ cursor = null, replace = false } = {}) => {
    const req = ++reloadReqRef.current;
    loadingListingsRef.current = true;
    setIsFetchingListings(true);
    try {
      const res = await api.listAll({
        q: debouncedQuery.trim() || '',
        loc: debouncedLocation.trim() || '',
        cursor,
        limit: PAGE_SIZE,
        sort
      });

      if (req !== reloadReqRef.current) return;

      const { rows, hasNext: next, nextCursor } = normalizeListingsResponse(res, PAGE_SIZE);
      const newRows = rows || [];
      setHasNext(!!next);

      setAll((prev) => {
        if (replace || cursor == null) return newRows;
        if (!prev || !prev.length) return newRows;
        const existing = new Set(prev.map((r) => r.id));
        const appended = newRows.filter((r) => !existing.has(r.id));
        return appended.length ? [...prev, ...appended] : prev;
      });

      if (cursor == null) {
        if (user) {
          try {
            const mineRows = await api.listMine({ silent: true });
            setMine(asArray(mineRows));
          } catch {
            setMine([]);
          }
        } else {
          setMine([]);
        }
      }

      if (newRows.length) {
        try {
          const ids = (cursor == null ? newRows.slice(0, 24) : newRows).map((r) => r.id);
          if (ids.length) {
            const covers = await api.getCoversBatch(ids, { silent: true });
            if (req === reloadReqRef.current && Array.isArray(covers) && covers.length && typeof onCoverPatch === 'function') {
              const patch = {};
              covers.forEach((r) => {
                if (!r || r.id == null) return;
                if (r.image_data) patch[r.id] = { url: r.image_data };
              });
              if (Object.keys(patch).length) {
                onCoverPatch(patch);
              }
            }
          }
        } catch {
          // ignore cover prefetch errors
        }
      }

      nextCursorRef.current = next ? (nextCursor ?? null) : null;
    } catch (err) {
      if (req === reloadReqRef.current) {
        console.error('load listings failed', err);
        if (replace || cursor == null) setAll([]);
        setHasNext(false);
        if (cursor == null && !user) setMine([]);
      }
    } finally {
      if (req === reloadReqRef.current) {
        loadingListingsRef.current = false;
        setIsFetchingListings(false);
      }
    }
  }, [
    api,
    debouncedQuery,
    debouncedLocation,
    sort,
    user?.id,
    setAll,
    setMine,
    setHasNext,
    setIsFetchingListings,
    onCoverPatch
  ]);

  const refreshListings = useCallback(async ({ preserveExisting = false } = {}) => {
    nextCursorRef.current = null;
    if (!preserveExisting) {
      setAll([]);
      setHasNext(false);
    }
    await loadListings({ cursor: null, replace: true });
  }, [loadListings, setAll, setHasNext]);

  const handleViewSeller = useCallback((userId, username) => {
    setViewingSeller({ id: userId, username });
    setSelectedListing(null);
  }, [setViewingSeller, setSelectedListing]);

  const handleBackFromSeller = useCallback(() => {
    setViewingSeller(null);
  }, [setViewingSeller]);

  useEffect(() => {
    refreshAds();
  }, [refreshAds]);

  useEffect(() => {
    nextCursorRef.current = null;
    setAll([]);
    setHasNext(false);
    loadListings({ cursor: null, replace: true });
  }, [user?.id, debouncedQuery, debouncedLocation, sort, loadListings, setAll, setHasNext]);

  useEffect(() => {
    if (tab !== 'browse') return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry || !entry.isIntersecting) return;
      if (!hasNext || loadingListingsRef.current) return;
      if (!nextCursorRef.current) return;
      loadListings({ cursor: nextCursorRef.current, replace: false });
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, sentinelRef, hasNext, loadListings]);

  useEffect(() => {
    if (tab === 'profile') reloadMineOnly();
  }, [tab, reloadMineOnly]);

  return {
    tab,
    setTab,
    tabRef,
    all,
    setAll,
    mine,
    setMine,
    query,
    setQuery,
    locationQuery,
    setLocationQuery,
    sort,
    setSort,
    ads,
    refreshAds,
    viewingSeller,
    setViewingSeller,
    handleViewSeller,
    handleBackFromSeller,
    hasNext,
    isFetchingListings,
    sentinelRef,
    loadingListingsRef,
    nextCursorRef,
    reloadReqRef,
    selectedListing,
    setSelectedListing,
    editing,
    setEditing,
    debouncedQuery,
    debouncedLocation,
    refreshListings,
    loadListings,
    reloadMineOnly
  };
}

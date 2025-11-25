(() => {
  function createListingsFeature({ React, api, helpers, uploads }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Listings feature requires React.');
    }
    if (!api) {
      throw new Error('Listings feature requires an API client.');
    }

    const { useState, useEffect, useMemo, useRef, useCallback } = React;
    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    // Extract helpers
    const normalizeListingsResponse = helpers?.normalizeListingsResponse;
    const asArray = helpers?.asArray;
    const selectPrimaryListingImage = helpers?.selectPrimaryListingImage;
    const createLRUCache = helpers?.createLRUCache;
    const getUserCoordsOnce = helpers?.getUserCoordsOnce;
    const pageSize = Number.isFinite(helpers?.pageSize) ? helpers.pageSize : 75;

    // Validate required helpers
    if (typeof normalizeListingsResponse !== 'function') {
      throw new Error('Listings feature requires normalizeListingsResponse helper.');
    }
    if (typeof asArray !== 'function') {
      throw new Error('Listings feature requires asArray helper.');
    }
    if (typeof selectPrimaryListingImage !== 'function') {
      throw new Error('Listings feature requires selectPrimaryListingImage helper.');
    }

    const prepareListingForModal = uploads?.prepareListingForModal;
    const warmListingImages = uploads?.warmListingImages;
    if (typeof prepareListingForModal !== 'function') {
      throw new Error('Listings feature requires prepareListingForModal helper.');
    }
    if (typeof warmListingImages !== 'function') {
      throw new Error('Listings feature requires warmListingImages helper.');
    }

    // ============================================================
    // HOOK: useDebounce
    // Simple debounce hook for search inputs
    // ============================================================
    function useDebounce(value, delay) {
      const [debouncedValue, setDebouncedValue] = useState(value);

      useEffect(() => {
        const timer = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(timer);
      }, [value, delay]);

      return debouncedValue;
    }

    // ============================================================
    // HOOK: useCoverCache
    // Manages cover image caching with LRU eviction and batched fetching
    // ============================================================
    function useCoverCache() {
      const cacheRef = useRef(null);
      if (!cacheRef.current && typeof createLRUCache === 'function') {
        cacheRef.current = createLRUCache(200);
      }

      const [version, setVersion] = useState(0);
      const bumpVersion = useCallback(() => setVersion(v => v + 1), []);

      const pendingIdsRef = useRef(new Set());
      const batchTimerRef = useRef(null);
      const flushRef = useRef(null);

      // Flush pending requests as batches
      const flush = useCallback(async () => {
        const allIds = Array.from(pendingIdsRef.current);
        pendingIdsRef.current.clear();
        if (!allIds.length) return;

        const maxBatchSize = 12;
        const ids = allIds.slice(0, maxBatchSize);

        // Re-queue remaining for next batch
        if (allIds.length > maxBatchSize) {
          allIds.slice(maxBatchSize).forEach(id => pendingIdsRef.current.add(id));
          batchTimerRef.current = setTimeout(() => {
            batchTimerRef.current = null;
            flushRef.current?.();
          }, 200);
        }

        try {
          const covers = await api.getCoversBatch(ids, { silent: true });
          if (Array.isArray(covers) && covers.length) {
            let hasUpdates = false;
            for (const r of covers) {
              if (r?.id != null && r.image_data) {
                cacheRef.current?.set(r.id, { url: r.image_data });
                hasUpdates = true;
              }
            }
            if (hasUpdates) bumpVersion();
          }
        } catch {
          // Silent fail - images show placeholder
        }
      }, [bumpVersion]);

      // Keep ref updated for recursive calls
      flushRef.current = flush;

      const ensureCover = useCallback((id) => {
        if (id == null) return;
        if (cacheRef.current?.has(id)) return;

        // Mark pending to prevent duplicates
        cacheRef.current?.set(id, null);
        pendingIdsRef.current.add(id);

        // Debounce batch fetch
        if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
        batchTimerRef.current = setTimeout(() => {
          batchTimerRef.current = null;
          flushRef.current?.();
        }, 150);
      }, []);

      const getCover = useCallback((id) => {
        return cacheRef.current?.get(id) ?? null;
      }, []);

      const setCover = useCallback((id, data) => {
        cacheRef.current?.set(id, data);
        bumpVersion();
      }, [bumpVersion]);

      const setCovers = useCallback((entries) => {
        let hasUpdates = false;
        for (const [id, data] of entries) {
          cacheRef.current?.set(id, data);
          hasUpdates = true;
        }
        if (hasUpdates) bumpVersion();
      }, [bumpVersion]);

      const clear = useCallback(() => {
        cacheRef.current?.clear();
        pendingIdsRef.current.clear();
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
          batchTimerRef.current = null;
        }
        bumpVersion();
      }, [bumpVersion]);

      return { getCover, setCover, setCovers, ensureCover, clear, version };
    }

    // ============================================================
    // HOOK: useListingsPagination
    // Handles fetching listings with cursor-based pagination
    // ============================================================
    function useListingsPagination({ query, location, sort, onCoversLoaded }) {
      const [listings, setListings] = useState([]);
      const [hasMore, setHasMore] = useState(false);
      const [isLoading, setIsLoading] = useState(false);

      const cursorRef = useRef(null);
      const requestIdRef = useRef(0);
      const isLoadingRef = useRef(false);

      const fetchPage = useCallback(async (cursor, replace) => {
        const reqId = ++requestIdRef.current;
        isLoadingRef.current = true;
        setIsLoading(true);

        try {
          // Build base params
          const params = {
            q: query?.trim() || '',
            loc: location?.trim() || '',
            cursor,
            limit: pageSize,
            sort: sort || 'new'
          };

          // For 'nearest' sort, get user coordinates
          if (sort === 'nearest' && typeof getUserCoordsOnce === 'function') {
            try {
              const coords = await getUserCoordsOnce();
              if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
                params.lat = coords.lat;
                params.lon = coords.lon;
              }
            } catch (e) {
              console.warn('Could not get user coordinates for nearest sort:', e);
            }
          }

          const res = await api.listAll(params);

          // Stale request check
          if (reqId !== requestIdRef.current) return;

          const { rows, hasNext, nextCursor } = normalizeListingsResponse(res, pageSize);
          const newRows = rows || [];

          setHasMore(!!hasNext);
          cursorRef.current = hasNext ? (nextCursor ?? null) : null;

          setListings(prev => {
            if (replace || cursor == null) return newRows;
            if (!prev?.length) return newRows;

            // Deduplicate
            const existingIds = new Set(prev.map(r => r.id));
            const toAppend = newRows.filter(r => !existingIds.has(r.id));
            return toAppend.length ? [...prev, ...toAppend] : prev;
          });

          // Fetch covers for new listings
          if (newRows.length && typeof onCoversLoaded === 'function') {
            const ids = (cursor == null ? newRows.slice(0, 24) : newRows).map(r => r.id);
            if (ids.length) {
              try {
                const covers = await api.getCoversBatch(ids, { silent: true });
                if (reqId === requestIdRef.current && Array.isArray(covers)) {
                  const entries = covers
                    .filter(r => r?.id != null && r.image_data)
                    .map(r => [r.id, { url: r.image_data }]);
                  if (entries.length) onCoversLoaded(entries);
                }
              } catch { }
            }
          }
        } catch (e) {
          if (reqId === requestIdRef.current) {
            console.error('Failed to load listings:', e);
            if (replace || cursor == null) setListings([]);
            setHasMore(false);
          }
        } finally {
          if (reqId === requestIdRef.current) {
            isLoadingRef.current = false;
            setIsLoading(false);
          }
        }
      }, [query, location, sort, onCoversLoaded]);

      const loadInitial = useCallback(() => {
        cursorRef.current = null;
        setListings([]);
        setHasMore(false);
        fetchPage(null, true);
      }, [fetchPage]);

      const loadMore = useCallback(() => {
        if (isLoadingRef.current || !cursorRef.current) return;
        fetchPage(cursorRef.current, false);
      }, [fetchPage]);

      const refresh = useCallback(async (preserveExisting = false) => {
        cursorRef.current = null;
        if (!preserveExisting) {
          setListings([]);
          setHasMore(false);
        }
        await fetchPage(null, true);
      }, [fetchPage]);

      // Expose loading ref for external checks
      const getIsLoading = useCallback(() => isLoadingRef.current, []);
      const getCursor = useCallback(() => cursorRef.current, []);

      return {
        listings,
        hasMore,
        isLoading,
        loadInitial,
        loadMore,
        refresh,
        setListings,
        getIsLoading,
        getCursor
      };
    }

    // ============================================================
    // HOOK: useMyListings
    // Manages the current user's own listings
    // ============================================================
    function useMyListings(user) {
      const [listings, setListings] = useState([]);

      const refresh = useCallback(async () => {
        if (!user) {
          setListings([]);
          return;
        }
        try {
          const res = await api.listMine();
          setListings(asArray(res) || []);
        } catch {
          setListings([]);
        }
      }, [user]);

      const refreshSilent = useCallback(async () => {
        if (!user) {
          setListings([]);
          return;
        }
        try {
          const res = await api.listMine({ silent: true });
          setListings(asArray(res) || []);
        } catch { }
      }, [user]);

      return { listings, setListings, refresh, refreshSilent };
    }

    // ============================================================
    // HOOK: useCitySearch
    // Handles city autocomplete search
    // ============================================================
    function useCitySearch(locationQuery) {
      const [options, setOptions] = useState([]);

      useEffect(() => {
        const term = (locationQuery || '').split(',')[0].trim();
        if (!term) {
          setOptions([]);
          return;
        }

        let alive = true;
        const timer = setTimeout(async () => {
          try {
            const res = await api.searchCities(term);
            if (alive) setOptions(Array.isArray(res) ? res : []);
          } catch {
            if (alive) setOptions([]);
          }
        }, 500);

        return () => {
          alive = false;
          clearTimeout(timer);
        };
      }, [locationQuery]);

      return options;
    }

    // ============================================================
    // HOOK: useInfiniteScroll
    // Observes sentinel element for infinite scroll with throttling
    // Instagram-style: triggers early but throttles to prevent rapid calls
    // ============================================================
    function useInfiniteScroll({ enabled, onLoadMore, getIsLoading, getCursor }) {
      const sentinelRef = useRef(null);
      const lastLoadTimeRef = useRef(0);
      const throttleMs = 500; // Minimum time between load attempts

      useEffect(() => {
        if (!enabled) return;
        if (typeof IntersectionObserver === 'undefined') return;

        const el = sentinelRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(entries => {
          const entry = entries[0];
          if (!entry?.isIntersecting) return;
          if (getIsLoading()) return;
          if (!getCursor()) return;

          // Throttle rapid scroll triggers
          const now = Date.now();
          if (now - lastLoadTimeRef.current < throttleMs) return;
          lastLoadTimeRef.current = now;

          onLoadMore();
        }, { rootMargin: '400px' }); // Trigger earlier (400px) for smoother experience

        observer.observe(el);
        return () => observer.disconnect();
      }, [enabled, onLoadMore, getIsLoading, getCursor]);

      return sentinelRef;
    }

    // ============================================================
    // HELPER: addCoversToListings
    // Enriches listings with cover image data
    // ============================================================
    function addCoversToListings(listings, getCover) {
      return (listings || []).map(item => {
        const cached = getCover(item.id);
        const inlineUrl = cached?.url || selectPrimaryListingImage(
          item,
          item?.image_data || item?.thumb_url || (Array.isArray(item?.images) ? item.images[0] : null)
        );
        return {
          ...item,
          __cover: inlineUrl || '',
          __ar: (cached?.w && cached?.h) ? (cached.w / cached.h) : 1
        };
      });
    }

    // ============================================================
    // COMPONENT: CityAutocomplete
    // ============================================================
    function CityAutocomplete({ value, onChange, options, onUseMyLocation }) {
      const [open, setOpen] = useState(false);
      const [hover, setHover] = useState(0);
      const boxRef = useRef(null);

      const list = useMemo(() => {
        const v = (value || '').trim().toLowerCase();
        const opts = Array.isArray(options) ? options : [];
        if (!v) return opts.slice(0, 8);
        return opts.filter(c => c.toLowerCase().includes(v)).slice(0, 8);
      }, [value, options]);

      const pick = useCallback((s) => {
        onChange(s);
        setOpen(false);
        setHover(0);
        setTimeout(() => boxRef.current?.querySelector('input')?.focus(), 0);
      }, [onChange]);

      const onKeyDown = useCallback((e) => {
        if (!open && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
          setOpen(true);
          return;
        }
        if (!open) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHover(h => Math.min(h + 1, list.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHover(h => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (list[hover]) pick(list[hover]);
        } else if (e.key === 'Escape') {
          setOpen(false);
        }
      }, [open, list, hover, pick]);

      const onFocus = useCallback(() => {
        if (list.length) setOpen(true);
      }, [list.length]);

      const onBlur = useCallback(() => {
        setTimeout(() => setOpen(false), 100);
      }, []);

      return H('div', { ref: boxRef, style: { position: 'relative', display: 'flex', alignItems: 'center', flex: 1 } },
        H('input', {
          placeholder: 'City...',
          value: value,
          onChange: e => { onChange(e.target.value); setOpen(true); },
          onKeyDown,
          onFocus,
          onBlur,
          style: { width: '100%', paddingRight: 40 }
        }),
        H('button', {
          type: 'button',
          onClick: onUseMyLocation,
          title: 'Use my location',
          style: {
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 4, cursor: 'pointer',
            color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }
        },
          H('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
            H('polygon', { points: '3 11 22 2 13 21 11 13 3 11' })
          )
        ),
        open && list.length > 0 && H('div', {
          style: {
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginTop: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.08)', overflow: 'hidden'
          }
        },
          ...list.map((s, i) => H('div', {
            key: s,
            onMouseEnter: () => setHover(i),
            onMouseDown: (e) => { e.preventDefault(); pick(s); },
            style: {
              padding: '10px 12px',
              background: i === hover ? '#f3f4f6' : 'transparent',
              cursor: 'pointer'
            }
          }, s))
        )
      );
    }

    // ============================================================
    // MAIN HOOK: useListingsFeature
    // Composes all the smaller hooks together
    // ============================================================
    function useListingsFeature({ user, currentTab }) {
      // Search state
      const [query, setQuery] = useState('');
      const [locationQuery, setLocationQuery] = useState('');
      const [sort, setSort] = useState('new');

      // Debounced search values
      const debouncedQuery = useDebounce(query, 250);
      const debouncedLocation = useDebounce(locationQuery, 500);

      // Cover cache
      const coverCache = useCoverCache();

      // Pagination
      const pagination = useListingsPagination({
        query: debouncedQuery,
        location: debouncedLocation,
        sort,
        onCoversLoaded: coverCache.setCovers
      });

      // User's own listings
      const myListings = useMyListings(user);

      // City autocomplete
      const cityOptions = useCitySearch(locationQuery);

      // Infinite scroll
      const sentinelRef = useInfiniteScroll({
        enabled: currentTab === 'browse',
        onLoadMore: pagination.loadMore,
        getIsLoading: pagination.getIsLoading,
        getCursor: pagination.getCursor
      });

      // Load listings when search params change
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => {
        coverCache.clear();
        pagination.loadInitial();
      }, [user?.id, debouncedQuery, debouncedLocation, sort]);

      // Load user's listings when switching to profile tab
      useEffect(() => {
        if (currentTab === 'profile') {
          myListings.refresh();
        }
      }, [currentTab, myListings.refresh]);

      // Also fetch user's listings on initial load
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => {
        if (user) {
          myListings.refreshSilent();
        }
      }, [user?.id]);

      // Enrich listings with covers
      const items = useMemo(() => {
        // Include version to trigger re-computation when covers update
        void coverCache.version;
        return addCoversToListings(pagination.listings, coverCache.getCover);
      }, [pagination.listings, coverCache.version, coverCache.getCover]);

      const mine = useMemo(() => {
        void coverCache.version;
        return addCoversToListings(myListings.listings, coverCache.getCover);
      }, [myListings.listings, coverCache.version, coverCache.getCover]);

      // Actions
      const refreshListings = useCallback(async (options = {}) => {
        if (!options.preserveExisting) {
          coverCache.clear();
        }
        await pagination.refresh(options.preserveExisting);
      }, [pagination.refresh, coverCache.clear]);

      const toggleSold = useCallback(async (listing, makeSold) => {
        try {
          await api.markListingSold(listing.id, makeSold);

          // Optimistic update for "mine"
          myListings.setListings(prev =>
            prev.map(it => it.id === listing.id ? { ...it, sold: makeSold ? 1 : 0 } : it)
          );

          // Remove from "all" if marked sold
          if (makeSold) {
            pagination.setListings(prev =>
              Array.isArray(prev) ? prev.filter(it => it.id !== listing.id) : prev
            );
          }

          // Refresh in background
          myListings.refreshSilent();
        } catch (e) {
          console.error('Failed to toggle sold status:', e);
          // Revert on error
          myListings.refreshSilent();
          throw e;
        }
      }, [myListings, pagination]);

      return {
        // Search
        query,
        setQuery,
        locationQuery,
        setLocationQuery,
        sort,
        setSort,
        cityOptions,

        // Listings data
        items,
        mine,
        hasNext: pagination.hasMore,
        isFetchingListings: pagination.isLoading,

        // Actions
        refreshListings,
        reloadMineOnly: myListings.refresh,
        toggleSold,
        ensureCover: coverCache.ensureCover,

        // Refs
        sentinelRef
      };
    }

    // ============================================================
    // HOOK: useListingModal
    // ============================================================
    function useListingModal({ setSelectedListing }) {
      const openListingModal = useCallback((listing, coverSrc) => {
        if (typeof setSelectedListing !== 'function') return;
        const { payload, images } = prepareListingForModal(listing, coverSrc);
        if (!payload) return;
        setSelectedListing(payload);
        if (listing?.id) {
          warmListingImages(listing.id, images);
        }
      }, [setSelectedListing]);

      const handleListingTileEvent = useCallback((evt, listing, coverSrc) => {
        evt?.preventDefault?.();
        evt?.stopPropagation?.();
        openListingModal(listing, coverSrc);
      }, [openListingModal]);

      return { openListingModal, handleListingTileEvent };
    }

    // ============================================================
    // EXPORTS
    // ============================================================
    return {
      useListingsFeature,
      useListingModal,
      CityAutocomplete,
      // Export individual hooks for flexibility
      useDebounce,
      useCoverCache,
      useListingsPagination,
      useMyListings,
      useCitySearch,
      useInfiniteScroll
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.listings = { createListingsFeature };
})();

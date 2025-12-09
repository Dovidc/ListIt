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
    const fetchCoordsAndReverse = helpers?.fetchCoordsAndReverse;
    const pageSize = Number.isFinite(helpers?.pageSize) ? helpers.pageSize : 48;

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

        // Filter out IDs that already have valid data in cache (not just null placeholder)
        const idsToFetch = allIds.filter(id => {
          const cached = cacheRef.current?.get(id);
          return !cached || !cached.url;
        });

        if (!idsToFetch.length) return;

        const maxBatchSize = 12;
        const ids = idsToFetch.slice(0, maxBatchSize);

        // Re-queue remaining for next batch
        if (idsToFetch.length > maxBatchSize) {
          idsToFetch.slice(maxBatchSize).forEach(id => pendingIdsRef.current.add(id));
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
        const cached = cacheRef.current?.get(id);
        // Skip if already has valid data or is already pending
        if (cached?.url || pendingIdsRef.current.has(id)) return;

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
          // Remove from pending queue to prevent duplicate fetches
          pendingIdsRef.current.delete(id);
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
      const [error, setError] = useState(null);

      const cursorRef = useRef(null);
      const requestIdRef = useRef(0);
      const isLoadingRef = useRef(false);
      const abortRef = useRef(null);

      useEffect(() => {
        return () => {
          isLoadingRef.current = false;
          if (abortRef.current) {
            try { abortRef.current.abort(); } catch { }
          }
        };
      }, []);

      const fetchPage = useCallback(async (cursor, replace, limitOverride) => {
        const reqId = ++requestIdRef.current;
        isLoadingRef.current = true;
        setIsLoading(true);
        setError(null);

        if (abortRef.current) {
          try { abortRef.current.abort(); } catch { }
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        abortRef.current = controller;

        try {
          // Build base params
          const limit = Number.isFinite(limitOverride) ? limitOverride : pageSize;
          const params = {
            q: query?.trim() || '',
            loc: location?.trim() || '',
            cursor,
            limit,
            sort: sort || 'new'
          };

          // Always try to get user coordinates for distance calculation
          // This allows distance badges to show on listings with enable_nearby regardless of sort
          if (typeof getUserCoordsOnce === 'function') {
            try {
              const coords = await getUserCoordsOnce();
              if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
                params.lat = coords.lat;
                params.lon = coords.lon;
              }
            } catch {
              // Silently fail - coordinates are optional
            }
          }

          const res = await api.listAll(params, { signal: controller?.signal, silent: true });

          // Stale request check
          if (reqId !== requestIdRef.current) return;

          const { rows, hasNext, nextCursor } = normalizeListingsResponse(res, limit);
          const newRows = rows || [];

          setHasMore(!!hasNext);
          cursorRef.current = hasNext ? (nextCursor ?? null) : null;

          setListings(prev => {
            if (replace || cursor == null) return newRows;
            if (!prev?.length) return newRows;

            // Deduplicate
            const existingIds = new Set(prev.map(r => r.id));
            const toAppend = newRows.filter(r => !existingIds.has(r.id));
            if (!toAppend.length) return prev;

            const merged = [...prev, ...toAppend];
            // Cap at 500 listings to prevent memory issues on long sessions
            return merged.length > 500 ? merged.slice(-500) : merged;
          });

          // Fetch covers for new listings
          if (newRows.length && typeof onCoversLoaded === 'function') {
            const preloadCount = cursor == null ? Math.min(24, newRows.length) : newRows.length;
            const ids = newRows.slice(0, preloadCount).map(r => r.id);
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
          if (controller?.signal?.aborted || e?.name === 'AbortError') return;
          if (reqId === requestIdRef.current) {
            const message = e?.message === 'auth'
              ? 'Session expired. Please sign back in.'
              : (e?.message || 'Unable to load listings.');
            console.error('Failed to load listings:', e);
            setError(message);
            setHasMore(false);
          }
        } finally {
          if (reqId === requestIdRef.current) {
            isLoadingRef.current = false;
            setIsLoading(false);
            if (abortRef.current === controller) {
              abortRef.current = null;
            }
          }
        }
      }, [query, location, sort, onCoversLoaded]);

      const loadInitial = useCallback(() => {
        cursorRef.current = null;
        setListings([]);
        setHasMore(false);
        setError(null);
        fetchPage(null, true);
      }, [fetchPage]);

      const loadMore = useCallback((options = {}) => {
        if (isLoadingRef.current || !cursorRef.current) return;
        const limitOverride = Number.isFinite(options?.limit) ? options.limit : undefined;
        return fetchPage(cursorRef.current, false, limitOverride);
      }, [fetchPage]);

      const refresh = useCallback(async (preserveExisting = false) => {
        cursorRef.current = null;
        if (!preserveExisting) {
          setListings([]);
          setHasMore(false);
        }
        setError(null);
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
        getCursor,
        error
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
            const res = await api.searchCities(term, { silent: true });
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
    // When user scrolls fast, loads smaller batches to prevent overwhelming
    // ============================================================
    function useInfiniteScroll({ enabled, onLoadMore, onLoadMoreSmallBatch, getIsLoading, getCursor }) {
      const sentinelRef = useRef(null);
      const lastLoadTimeRef = useRef(0);
      const throttleMs = 800; // Minimum time between load attempts
      const [isSupported, setIsSupported] = useState(typeof IntersectionObserver !== 'undefined');
      const [isPaceLimited, setIsPaceLimited] = useState(false);
      const isPaceLimitedRef = useRef(false); // Ref for immediate access in callbacks
      const paceResetRef = useRef(null);
      const loadInFlightRef = useRef(false);

      // Keep ref in sync with state
      useEffect(() => {
        isPaceLimitedRef.current = isPaceLimited;
      }, [isPaceLimited]);

      // Unified load function that respects pace limiting
      const doLoad = useCallback((forceSmallBatch = false) => {
        if (loadInFlightRef.current) return;
        if (getIsLoading() || !getCursor()) return;

        const now = Date.now();
        if (now - lastLoadTimeRef.current < throttleMs) return;
        lastLoadTimeRef.current = now;

        loadInFlightRef.current = true;

        // Use small batch if pace limited or forced
        const useSmall = (forceSmallBatch || isPaceLimitedRef.current) && onLoadMoreSmallBatch;
        const loadFn = useSmall ? onLoadMoreSmallBatch : onLoadMore;

        Promise.resolve(loadFn())
          .catch(() => { /* silent */ })
          .finally(() => {
            loadInFlightRef.current = false;
          });
      }, [onLoadMore, onLoadMoreSmallBatch, getIsLoading, getCursor]);

      // Scroll-based loading - uses main.container on mobile (which has overflow-y: auto)
      useEffect(() => {
        if (!enabled || typeof window === 'undefined') return;

        const findScrollContainer = () => {
          const mainContainer = document.querySelector('main.container');
          if (mainContainer) {
            const style = window.getComputedStyle(mainContainer);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              return mainContainer;
            }
          }
          return null;
        };

        const scrollContainerRef = { current: findScrollContainer() };
        const scrollSpeedThreshold = 1.2;
        const lastYRef = { current: 0 };
        const lastTRef = { current: Date.now() };
        const rafRef = { current: null };

        const checkScrollPosition = () => {
          const container = scrollContainerRef.current || findScrollContainer();
          scrollContainerRef.current = container;

          const scrollHeight = container ? container.scrollHeight : document.documentElement.scrollHeight;
          const scrollTop = container ? container.scrollTop : (window.scrollY || window.pageYOffset || 0);
          const clientHeight = container ? container.clientHeight : window.innerHeight;

          const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

          if (distanceFromBottom < 800) {
            doLoad(isPaceLimitedRef.current);
          }
        };

        const measureScroll = () => {
          rafRef.current = null;
          const container = scrollContainerRef.current || findScrollContainer();
          scrollContainerRef.current = container;

          const now = Date.now();
          const y = container ? container.scrollTop : (window.scrollY || 0);
          const delta = Math.abs(y - lastYRef.current);
          const dt = Math.max(16, now - lastTRef.current);
          const speed = delta / dt;
          lastYRef.current = y;
          lastTRef.current = now;

          if (speed > scrollSpeedThreshold && !isPaceLimitedRef.current) {
            isPaceLimitedRef.current = true;
            setIsPaceLimited(true);
            if (paceResetRef.current) clearTimeout(paceResetRef.current);
            paceResetRef.current = setTimeout(() => {
              isPaceLimitedRef.current = false;
              setIsPaceLimited(false);
            }, 2500);
          }

          checkScrollPosition();
        };

        const scheduleMeasure = () => {
          if (rafRef.current != null) return;
          rafRef.current = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame(measureScroll)
            : setTimeout(measureScroll, 16);
        };

        const scrollTarget = scrollContainerRef.current || window;
        scrollTarget.addEventListener('scroll', scheduleMeasure, { passive: true });
        window.addEventListener('resize', scheduleMeasure, { passive: true });

        // Initial check to capture current position
        scheduleMeasure();

        return () => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.removeEventListener('scroll', scheduleMeasure);
          } else {
            window.removeEventListener('scroll', scheduleMeasure);
          }
          window.removeEventListener('resize', scheduleMeasure);
          if (rafRef.current != null) {
            const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
            cancel(rafRef.current);
          }
          if (paceResetRef.current) clearTimeout(paceResetRef.current);
        };
      }, [enabled, doLoad]);

      // Intersection observer for triggering loads
      useEffect(() => {
        if (!enabled) return;
        const supported = typeof IntersectionObserver !== 'undefined';
        setIsSupported(supported);
        if (!supported) return;

        const el = sentinelRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(entries => {
          const entry = entries[0];
          if (!entry?.isIntersecting) return;
          if (getIsLoading()) return;
          if (!getCursor()) return;

          // Use ref for immediate pace check (avoids stale closure)
          doLoad(isPaceLimitedRef.current);
        }, { rootMargin: '400px' }); // Trigger earlier (400px) for smoother experience

        observer.observe(el);
        return () => observer.disconnect();
      }, [enabled, doLoad, getIsLoading, getCursor]);

      return { sentinelRef, isSupported, isPaceLimited };
    }

    // ============================================================
    // HELPER: addCoversToListings
    // Enriches listings with cover image data
    // Only creates new objects for items whose cover actually changed
    // ============================================================
    function addCoversToListings(listings, getCover) {
      return (listings || []).map(item => {
        const cached = getCover(item.id);
        const inlineUrl = cached?.url || selectPrimaryListingImage(
          item,
          item?.image_data || item?.thumb_url || (Array.isArray(item?.images) ? item.images[0] : null)
        );
        const newCover = inlineUrl || '';
        const newAr = (cached?.w && cached?.h) ? (cached.w / cached.h) : 1;

        // Only create new object if cover data actually changed
        if (item.__cover === newCover && item.__ar === newAr) {
          return item;
        }
        return {
          ...item,
          __cover: newCover,
          __ar: newAr
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

      const handleInputChange = useCallback((e) => {
        onChange(e.target.value);
        setOpen(true);
      }, [onChange]);

      const handleClear = useCallback(() => {
        onChange('');
        setOpen(false);
      }, [onChange]);

      const hasValue = value && value.trim().length > 0;

      return H('div', { ref: boxRef, style: { position: 'relative', display: 'flex', alignItems: 'center', flex: 1 } },
        H('input', {
          placeholder: 'City...',
          value: value,
          onChange: handleInputChange,
          onKeyDown,
          onFocus,
          onBlur,
          style: { width: '100%', paddingRight: hasValue ? 64 : 44 }
        }),
        // Clear button - only show when there's a value
        hasValue && H('button', {
          type: 'button',
          onClick: handleClear,
          title: 'Clear location',
          style: {
            position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 6, cursor: 'pointer',
            color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }
        },
          H('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
            H('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
            H('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
          )
        ),
        // Location arrow button - larger touch target (44x44 minimum)
        H('button', {
          type: 'button',
          onClick: onUseMyLocation,
          title: 'Use my location',
          style: {
            position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 12, cursor: 'pointer',
            color: hasValue ? '#2563eb' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 44, minHeight: 44,
            transition: 'color 0.15s ease'
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
      const [committedQuery, setCommittedQuery] = useState('');
      const [searchVersion, setSearchVersion] = useState(0);
      const [locationQuery, setLocationQuery] = useState('');
      const [sort, setSort] = useState('new');
      const locationInitialized = useRef(false);

      // Auto-detect user's location on initial load
      useEffect(() => {
        if (locationInitialized.current) return;
        if (typeof fetchCoordsAndReverse !== 'function') return;
        locationInitialized.current = true;

        fetchCoordsAndReverse()
          .then(result => {
            // Use just the city for the prepopulated search, not city + state
            const city = result?.display?.split(',')[0]?.trim();
            if (city) {
              setLocationQuery(city);
            }
          })
          .catch(() => {
            // Silently fail - user can manually enter location
          });
      }, []);

      // Debounced location (still live for city autocomplete)
      const debouncedLocation = useDebounce(locationQuery, 500);

      // Submit search function - only searches when called explicitly
      // Can optionally pass a value to search for (used when clearing)
      const submitSearch = useCallback((searchValue) => {
        const valueToSearch = searchValue !== undefined ? searchValue : query;
        setCommittedQuery(valueToSearch.trim());
        setSearchVersion(v => v + 1);
      }, [query]);

      // Cover cache
      const coverCache = useCoverCache();

      // Pagination
      const pagination = useListingsPagination({
        query: committedQuery,
        location: debouncedLocation,
        sort,
        onCoversLoaded: coverCache.setCovers
      });

      // User's own listings
      const myListings = useMyListings(user);

      // City autocomplete
      const cityOptions = useCitySearch(locationQuery);

      const fastScrollLimit = Math.max(12, Math.floor(pageSize / 3));

      // Infinite scroll
      const { sentinelRef, isSupported: isInfiniteScrollSupported, isPaceLimited } = useInfiniteScroll({
        enabled: currentTab === 'browse',
        onLoadMore: pagination.loadMore,
        onLoadMoreSmallBatch: () => pagination.loadMore({ limit: fastScrollLimit }),
        getIsLoading: pagination.getIsLoading,
        getCursor: pagination.getCursor
      });

      // Load listings when search params change
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => {
        coverCache.clear();
        pagination.loadInitial();
      }, [user?.id, committedQuery, searchVersion, debouncedLocation, sort]);

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

      const addListing = useCallback((listing) => {
        if (!listing?.id) return;

        myListings.setListings(prev => {
          const safePrev = Array.isArray(prev) ? prev : [];
          const filtered = safePrev.filter(it => it?.id !== listing.id);
          return [listing, ...filtered];
        });

        pagination.setListings(prev => {
          const safePrev = Array.isArray(prev) ? prev : [];
          const filtered = safePrev.filter(it => it?.id !== listing.id);
          const merged = [listing, ...filtered];
          return merged.length > 500 ? merged.slice(0, 500) : merged;
        });
      }, [myListings.setListings, pagination.setListings]);

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
        submitSearch,
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
        listingError: pagination.error,
        loadMore: pagination.loadMore,
        isScrollPaceLimited: isPaceLimited,

        // Actions
        refreshListings,
        reloadMineOnly: myListings.refresh,
        addListing,
        toggleSold,
        ensureCover: coverCache.ensureCover,

        // Refs
        sentinelRef,
        isInfiniteScrollSupported
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

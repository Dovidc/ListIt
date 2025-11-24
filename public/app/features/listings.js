(() => {
  function createListingsFeature({ React, api, helpers, uploads }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Listings feature requires React.');
    }
    if (!api) {
      throw new Error('Listings feature requires an API client.');
    }
    const {
      useState,
      useEffect,
      useMemo,
      useRef,
      useCallback
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const normalizeListingsResponse = helpers?.normalizeListingsResponse;
    const asArray = helpers?.asArray;
    const selectPrimaryListingImage = helpers?.selectPrimaryListingImage;
    const createLRUCache = helpers?.createLRUCache;
    const pageSize = Number.isFinite(helpers?.pageSize) ? helpers.pageSize : 75;

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

      function pick(s) {
        onChange(s);
        setOpen(false);
        setHover(0);
        setTimeout(() => boxRef.current && boxRef.current.querySelector('input')?.focus(), 0);
      }

      function onKeyDown(e) {
        if (!open && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
          setOpen(true);
          return;
        }
        if (!open) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h + 1, list.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHover(h => Math.max(h - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (list[hover]) pick(list[hover]); }
        else if (e.key === 'Escape') { setOpen(false); }
      }

      function onFocus() { if (list.length) setOpen(true); }
      function onBlur() { setTimeout(() => setOpen(false), 100); }

      return H('div', { ref: boxRef, style: { position: 'relative', display: 'flex', alignItems: 'center', flex: 1 } },
        H('input', {
          placeholder: 'City...',
          value: value,
          onChange: e => { onChange(e.target.value); setOpen(true); },
          onKeyDown, onFocus, onBlur,
          style: { width: '100%', paddingRight: 40 } // Make room for icon
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

    function useListingsFeature({ user, currentTab }) {
      const [all, setAll] = useState([]);
      const [mine, setMine] = useState([]);
      const [query, setQuery] = useState('');
      const [locationQuery, setLocationQuery] = useState('');
      const [sort, setSort] = useState('new');
      const [hasNext, setHasNext] = useState(false);
      const [isFetchingListings, setIsFetchingListings] = useState(false);
      const [selectedListing, setSelectedListing] = useState(null);
      const [editing, setEditing] = useState(null);
      const [showMassList, setShowMassList] = useState(false);
      const [cityOptions, setCityOptions] = useState([]);

      // Use LRU cache for covers to prevent unbounded memory growth
      const coverCacheRef = useRef(null);
      if (!coverCacheRef.current && typeof createLRUCache === 'function') {
        coverCacheRef.current = createLRUCache(200);
      }
      const [coverVersion, setCoverVersion] = useState(0);
      const bumpCoverVersion = useCallback(() => setCoverVersion(v => v + 1), []);

      const sentinelRef = useRef(null);
      const loadingListingsRef = useRef(false);
      const nextCursorRef = useRef(null);
      const reloadReqRef = useRef(0);
      const loadListingsRef = useRef(null);

      // Batching for cover image requests
      const pendingCoverIdsRef = useRef(new Set());
      const coverBatchTimerRef = useRef(null);

      const [debouncedQuery, setDebouncedQuery] = useState('');
      useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 250);
        return () => clearTimeout(timer);
      }, [query]);

      const [debouncedLocation, setDebouncedLocation] = useState('');
      useEffect(() => {
        const timer = setTimeout(() => setDebouncedLocation(locationQuery), 500);
        return () => clearTimeout(timer);
      }, [locationQuery]);

      const reloadMineOnly = useCallback(async () => {
        if (!user) {
          setMine([]);
          return;
        }
        const m = await api.listMine();
        setMine(asArray(m) || []);
      }, [api, user, asArray]);

      const loadListings = useCallback(async ({ cursor = null, replace = false } = {}) => {
        const req = ++reloadReqRef.current;
        loadingListingsRef.current = true;
        setIsFetchingListings(true);
        try {
          const res = await api.listAll({
            q: debouncedQuery.trim() || '',
            loc: debouncedLocation.trim() || '',
            cursor,
            limit: pageSize,
            sort
          });

          if (req !== reloadReqRef.current) return;

          const { rows, hasNext, nextCursor } = normalizeListingsResponse(res, pageSize);
          const newRows = rows || [];
          setHasNext(!!hasNext);

          setAll(prev => {
            if (replace || cursor == null) return newRows;
            if (!prev || !prev.length) return newRows;
            const existing = new Set(prev.map(r => r.id));
            const appended = newRows.filter(r => !existing.has(r.id));

            // Double-check for duplicates in the final array just in case
            const combined = appended.length ? [...prev, ...appended] : prev;
            const seen = new Set();
            const unique = [];
            for (const item of combined) {
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              unique.push(item);
            }
            return unique;
          });

          if (cursor == null) {
            if (user) {
              try {
                const m = await api.listMine({ silent: true });
                setMine(asArray(m));
              } catch { }
            } else {
              setMine([]);
            }
          }

          if (newRows.length) {
            try {
              const ids = (cursor == null ? newRows.slice(0, 24) : newRows).map(r => r.id);
              if (ids.length) {
                const covers = await api.getCoversBatch(ids, { silent: true });
                if (req === reloadReqRef.current && Array.isArray(covers) && covers.length) {
                  let hasNewCovers = false;
                  covers.forEach(r => {
                    if (!r || r.id == null) return;
                    if (r.image_data) {
                      coverCacheRef.current?.set(r.id, { url: r.image_data });
                      hasNewCovers = true;
                    }
                  });
                  if (hasNewCovers) bumpCoverVersion();
                }
              }
            } catch { }
          }

          nextCursorRef.current = hasNext ? (nextCursor ?? null) : null;
        } catch (e) {
          if (req === reloadReqRef.current) {
            console.error('load listings failed', e);
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
      }, [api, debouncedQuery, debouncedLocation, pageSize, sort, user, asArray]);

      // Keep ref updated so effect can call latest version without re-triggering
      loadListingsRef.current = loadListings;

      useEffect(() => {
        nextCursorRef.current = null;
        setAll([]);
        coverCacheRef.current?.clear();
        bumpCoverVersion();
        setHasNext(false);
        loadListingsRef.current?.({ cursor: null, replace: true });
      }, [user?.id, debouncedQuery, debouncedLocation, sort, bumpCoverVersion]);

      const refreshListings = useCallback(async ({ preserveExisting = false } = {}) => {
        nextCursorRef.current = null;
        if (!preserveExisting) {
          setAll([]);
          coverCacheRef.current?.clear();
          bumpCoverVersion();
          setHasNext(false);
        }
        await loadListings({ cursor: null, replace: true });
      }, [loadListings, bumpCoverVersion]);

      useEffect(() => {
        if (currentTab !== 'browse') return;
        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(entries => {
          const entry = entries[0];
          if (!entry || !entry.isIntersecting) return;
          if (loadingListingsRef.current) return;
          if (!nextCursorRef.current) return;
          loadListingsRef.current?.({ cursor: nextCursorRef.current, replace: false });
        }, { rootMargin: '200px' });
        observer.observe(el);
        return () => observer.disconnect();
      }, [currentTab]);

      useEffect(() => {
        if (currentTab === 'profile') reloadMineOnly();
      }, [currentTab, reloadMineOnly]);

      useEffect(() => {
        let alive = true;
        const term = locationQuery.split(',')[0].trim();
        const timer = setTimeout(async () => {
          try {
            const res = await api.searchCities(term);
            if (!alive) return;
            setCityOptions(Array.isArray(res) ? res : []);
          } catch {
            if (alive) setCityOptions([]);
          }
        }, 2000);
        return () => {
          alive = false;
          clearTimeout(timer);
        };
      }, [locationQuery, api]);

      // Flush pending cover requests as a batch
      const flushCoverBatch = useCallback(async () => {
        const ids = Array.from(pendingCoverIdsRef.current);
        pendingCoverIdsRef.current.clear();
        if (!ids.length) return;

        try {
          const covers = await api.getCoversBatch(ids, { silent: true });
          if (Array.isArray(covers) && covers.length) {
            let hasUpdates = false;
            covers.forEach(r => {
              if (!r || r.id == null) return;
              if (r.image_data) {
                coverCacheRef.current?.set(r.id, { url: r.image_data });
                hasUpdates = true;
              }
            });
            if (hasUpdates) bumpCoverVersion();
          }
        } catch {
          // Silently fail - images will show placeholder
        }
      }, [api, bumpCoverVersion]);

      const ensureCover = useCallback((id) => {
        if (id == null) return;
        if (coverCacheRef.current?.has(id)) return;
        // Mark as pending to prevent duplicate fetches
        coverCacheRef.current?.set(id, null);
        pendingCoverIdsRef.current.add(id);

        // Debounce batch fetch - collect requests for 100ms then fetch all at once
        if (coverBatchTimerRef.current) clearTimeout(coverBatchTimerRef.current);
        coverBatchTimerRef.current = setTimeout(() => {
          coverBatchTimerRef.current = null;
          flushCoverBatch();
        }, 100);
      }, [flushCoverBatch]);

      const items = useMemo(() => {
        // coverVersion dependency ensures re-computation when covers update
        void coverVersion;
        return (all || []).map(it => {
          const cached = coverCacheRef.current?.get(it.id);
          const inline = cached?.url || selectPrimaryListingImage(it, it?.image_data || it?.thumb_url || (Array.isArray(it?.images) ? it.images[0] : null));
          const url = inline || '';
          const ar = (cached?.w && cached?.h) ? (cached.w / cached.h) : 1;
          return { ...it, __cover: url, __ar: ar };
        });
      }, [all, coverVersion, selectPrimaryListingImage]);

      const mineWithCovers = useMemo(() => {
        // coverVersion dependency ensures re-computation when covers update
        void coverVersion;
        return (mine || []).map(it => {
          const cached = coverCacheRef.current?.get(it.id);
          const inline = cached?.url || selectPrimaryListingImage(it, it?.image_data || it?.thumb_url || (Array.isArray(it?.images) ? it.images[0] : null));
          const url = inline || '';
          const ar = (cached?.w && cached?.h) ? (cached.w / cached.h) : 1;
          return { ...it, __cover: url, __ar: ar };
        });
      }, [mine, coverVersion, selectPrimaryListingImage]);

      const toggleSold = useCallback(async (listing, makeSold) => {
        try {
          await api.markListingSold(listing.id, makeSold);
          try {
            const mineRes = await api.listMine({ silent: true });
            setMine(asArray(mineRes) || []);
          } catch { }
          setSelectedListing(prev => {
            if (prev && prev.id === listing.id) {
              return { ...prev, sold: makeSold ? 1 : 0 };
            }
            return prev;
          });
          if (makeSold) {
            setAll(prev => Array.isArray(prev) ? prev.filter(it => it.id !== listing.id) : prev);
          }
          await refreshListings();
        } catch (e) {
          console.error('toggle sold failed', e);
          alert('Failed to update sold status. Please try again.');
        }
      }, [api, refreshListings, asArray]);

      return {
        listings: all,
        setListings: setAll,
        mine: mineWithCovers,
        setMine,
        query,
        setQuery,
        locationQuery,
        setLocationQuery,
        sort,
        setSort,
        hasNext,
        isFetchingListings,
        sentinelRef,
        selectedListing,
        setSelectedListing,
        editing,
        setEditing,
        showMassList,
        setShowMassList,
        reloadMineOnly,
        refreshListings,
        toggleSold,
        cityOptions,
        items,
        ensureCover
      };
    }

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
        if (evt && typeof evt.preventDefault === 'function') {
          evt.preventDefault();
        }
        if (evt && typeof evt.stopPropagation === 'function') {
          evt.stopPropagation();
        }
        openListingModal(listing, coverSrc);
      }, [openListingModal]);

      return {
        openListingModal,
        handleListingTileEvent
      };
    }

    return {
      useListingsFeature,
      CityAutocomplete,
      useListingModal
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.listings = {
    createListingsFeature
  };
})();

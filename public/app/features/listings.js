(() => {
  function createListingsFeature({ React, api, helpers }) {
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

    const normalizeListingsResponse = helpers?.normalizeListingsResponse;
    const asArray = helpers?.asArray;
    const selectPrimaryListingImage = helpers?.selectPrimaryListingImage;
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
      const [coverById, setCoverById] = useState(() => (Object.create(null)));

      const sentinelRef = useRef(null);
      const loadingListingsRef = useRef(false);
      const nextCursorRef = useRef(null);
      const reloadReqRef = useRef(0);

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
            return appended.length ? [...prev, ...appended] : prev;
          });

          if (cursor == null) {
            if (user) {
              try {
                const m = await api.listMine({ silent: true });
                setMine(asArray(m));
              } catch {}
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
                  const patch = {};
                  covers.forEach(r => {
                    if (!r || r.id == null) return;
                    if (r.image_data) patch[r.id] = { url: r.image_data };
                  });
                  if (Object.keys(patch).length) {
                    setCoverById(prev => ({ ...prev, ...patch }));
                  }
                }
              }
            } catch {}
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

      useEffect(() => {
        nextCursorRef.current = null;
        setAll([]);
        setHasNext(false);
        loadListings({ cursor: null, replace: true });
      }, [user?.id, debouncedQuery, debouncedLocation, sort, loadListings]);

      const refreshListings = useCallback(async ({ preserveExisting = false } = {}) => {
        nextCursorRef.current = null;
        if (!preserveExisting) {
          setAll([]);
          setHasNext(false);
        }
        await loadListings({ cursor: null, replace: true });
      }, [loadListings]);

      useEffect(() => {
        if (currentTab !== 'browse') return;
        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(entries => {
          const entry = entries[0];
          if (!entry || !entry.isIntersecting) return;
          if (!hasNext || loadingListingsRef.current) return;
          if (!nextCursorRef.current) return;
          loadListings({ cursor: nextCursorRef.current, replace: false });
        }, { rootMargin: '200px' });
        observer.observe(el);
        return () => observer.disconnect();
      }, [currentTab, hasNext, loadListings]);

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

      const ensureCover = useCallback(async (id) => {
        if (id == null) return;
        if (Object.prototype.hasOwnProperty.call(coverById, id)) return;
        try {
          const arr = await api.getListingImages(id, { silent: true });
          let obj = null;
          if (Array.isArray(arr) && arr.length) {
            obj = typeof arr[0] === 'string'
              ? { url: arr[0], w: null, h: null }
              : { url: arr[0]?.url, w: arr[0]?.w ?? null, h: arr[0]?.h ?? null };
          }
          setCoverById((prev) => ({ ...prev, [id]: obj }));
        } catch {
          setCoverById((prev) => ({ ...prev, [id]: null }));
        }
      }, [coverById, api]);

      const items = useMemo(() => {
        return (all || []).map(it => {
          const cached = coverById[it.id];
          const inline = cached?.url || selectPrimaryListingImage(it, it?.image_data || it?.thumb_url || (Array.isArray(it?.images) ? it.images[0] : null));
          const url = inline || '';
          const ar = (cached?.w && cached?.h) ? (cached.w / cached.h) : 1;
          return { ...it, __cover: url, __ar: ar };
        });
      }, [all, coverById, selectPrimaryListingImage]);

      const toggleSold = useCallback(async (listing, makeSold) => {
        try {
          await api.markListingSold(listing.id, makeSold);
          try {
            const mineRes = await api.listMine({ silent: true });
            setMine(asArray(mineRes) || []);
          } catch {}
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
        mine,
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

    return {
      useListingsFeature
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.listings = {
    createListingsFeature
  };
})();

(() => {
  function createNearbyFeature({ React, api, helpers = {}, components = {} } = {}) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Nearby feature requires React.');
    }
    if (!api || typeof api.listNearby !== 'function') {
      throw new Error('Nearby feature requires an API client with listNearby.');
    }

    const {
      asArray,
      selectPrimaryListingImage,
      fetchCoordsAndReverse,
      interleaveByColumns,
      useColumnCount
    } = helpers;

    if (typeof asArray !== 'function') {
      throw new Error('Nearby feature requires asArray helper.');
    }
    if (typeof selectPrimaryListingImage !== 'function') {
      throw new Error('Nearby feature requires selectPrimaryListingImage helper.');
    }
    if (typeof fetchCoordsAndReverse !== 'function') {
      throw new Error('Nearby feature requires fetchCoordsAndReverse helper.');
    }
    if (typeof interleaveByColumns !== 'function') {
      throw new Error('Nearby feature requires interleaveByColumns helper.');
    }
    if (typeof useColumnCount !== 'function') {
      throw new Error('Nearby feature requires useColumnCount helper.');
    }

    const { ListingCard } = components;
    if (typeof ListingCard !== 'function') {
      throw new Error('Nearby feature requires ListingCard component.');
    }

    const {
      useState,
      useMemo,
      useCallback,
      useRef,
      useEffect
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const DEFAULT_NEARBY_RADIUS_M = 400;

    const NearbyPanel = React.memo(function NearbyPanel({
      user,
      mineById,
      onEdit,
      onDelete,
      onMessage,
      onAdminDelete,
      onViewSeller,
      onToggleSold,
      setTab
    }) {
      const COORD_STORAGE_KEY = 'listit_nearby_coords';
      const COORD_TTL_MS = 2 * 60 * 1000;
      const RADIUS_OPTIONS = [
        { value: 150, label: '~500 ft' },
        { value: 402, label: '0.25 mi' },
        { value: 805, label: '0.5 mi' },
        { value: 1609, label: '1 mi' }
      ];

      const storedCoords = useMemo(() => {
        try {
          const raw = localStorage.getItem(COORD_STORAGE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          const lat = Number(parsed?.lat);
          const lon = Number(parsed?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return {
            lat,
            lon,
            ts: Number(parsed?.ts) || 0,
            display: typeof parsed?.display === 'string' ? parsed.display : ''
          };
        } catch {
          return null;
        }
      }, []);

      const [radius, setRadius] = useState(150);
      const [items, setItems] = useState([]);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [selected, setSelected] = useState(null);
      const [lastUpdatedLabel, setLastUpdatedLabel] = useState('');
      const [locationLabel, setLocationLabel] = useState(() => storedCoords?.display || '');
      const [search, setSearch] = useState('');
      const [sort, setSort] = useState('new');

      const coordsRef = useRef(storedCoords ? { lat: storedCoords.lat, lon: storedCoords.lon } : null);
      const coordsTsRef = useRef(storedCoords?.ts || 0);
      const loadTokenRef = useRef(0);
      const masonryRef = useRef(null);

      const normalizeNearbyItems = useCallback((input) => {
        const list = asArray(input);
        return list.map((item) => {
          const cover = selectPrimaryListingImage?.(item) || item?.thumb_url || item?.image_data || '';
          if (cover) {
            return { ...item, __cover: cover };
          }
          return { ...item };
        });
      }, [selectPrimaryListingImage, asArray]);

      const filteredItems = useMemo(() => {
        const list = Array.isArray(items) ? items.slice() : [];
        const query = search.trim().toLowerCase();

        let working = list;
        if (query) {
          working = list.filter((item) => {
            const haystack = [
              item?.title,
              item?.description,
              item?.location,
              item?.owner_username
            ]
              .filter(Boolean)
              .map((value) => String(value).toLowerCase())
              .join(' ');
            return haystack.includes(query);
          });
        }

        const parseDate = (value) => {
          if (!value) return 0;
          const ts = new Date(value).getTime();
          return Number.isFinite(ts) ? ts : 0;
        };

        const parsePrice = (item) => {
          const val = Number(item?.price);
          return Number.isFinite(val) ? val : 0;
        };

        const sorted = [...working];
        sorted.sort((a, b) => {
          if (sort === 'price_asc') {
            const diff = parsePrice(a) - parsePrice(b);
            if (diff !== 0) return diff;
          } else if (sort === 'price_desc') {
            const diff = parsePrice(b) - parsePrice(a);
            if (diff !== 0) return diff;
          } else {
            const diff = parseDate(b?.created_at || b?.updated_at) - parseDate(a?.created_at || a?.updated_at);
            if (diff !== 0) return diff;
          }

          const createdDiff = parseDate(b?.created_at || b?.updated_at) - parseDate(a?.created_at || a?.updated_at);
          if (createdDiff !== 0) return createdDiff;
          return Number(b?.id || 0) - Number(a?.id || 0);
        });

        return sorted;
      }, [items, search, sort]);

      const columnCount = useColumnCount(masonryRef, 3);
      const orderedItems = useMemo(() => interleaveByColumns(filteredItems, columnCount), [filteredItems, columnCount]);
      const hasItems = orderedItems.length > 0;
      const hasBaseItems = Array.isArray(items) && items.length > 0;

      const ensureCoords = useCallback(async (force = false) => {
        const now = Date.now();
        if (!force && coordsRef.current && (now - coordsTsRef.current) < COORD_TTL_MS) {
          return coordsRef.current;
        }

        try {
          const info = await fetchCoordsAndReverse();
          if (!info || !Number.isFinite(info.lat) || !Number.isFinite(info.lon)) {
            throw new Error('location_unavailable');
          }
          const coords = { lat: info.lat, lon: info.lon };
          coordsRef.current = coords;
          coordsTsRef.current = Date.now();
          setLocationLabel(info.display || '');
          try {
            localStorage.setItem(COORD_STORAGE_KEY, JSON.stringify({
              ...coords,
              display: info.display || '',
              ts: coordsTsRef.current
            }));
          } catch {}
          return coords;
        } catch (err) {
          if (!force && coordsRef.current) return coordsRef.current;
          throw err;
        }
      }, []);

      const loadNearby = useCallback(async (forceLocation = false) => {
        const token = ++loadTokenRef.current;
        setBusy(true);
        setError('');

        try {
          const coords = await ensureCoords(forceLocation);
          if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) {
            throw new Error('location_unavailable');
          }

          const response = await api.listNearby(coords.lat, coords.lon, radius, { silent: true });
          if (loadTokenRef.current !== token) return;

          const rows = response?.rows ?? response?.items ?? response;
          const normalized = normalizeNearbyItems(rows);
          setItems(normalized);
          setLastUpdatedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } catch (err) {
          if (loadTokenRef.current !== token) return;
          console.error('Nearby load failed:', err);
          let message = 'Could not load nearby listings.';
          const errMessage = err?.message || '';
          if (errMessage === 'Geolocation not supported' || errMessage === 'geolocation_unsupported') {
            message = 'Geolocation not supported in this browser.';
          } else if (err?.code === 1) {
            message = 'Location permission denied.';
          } else if (err?.code === 2) {
            message = 'Unable to determine your location.';
          } else if (err?.code === 3) {
            message = 'Location lookup timed out.';
          } else if (errMessage === 'location_unavailable' || errMessage === 'Could not determine your location.') {
            message = 'Location unavailable.';
          } else if (typeof errMessage === 'string' && errMessage && errMessage !== 'request_failed') {
            message = errMessage;
          }
          setItems([]);
          setLastUpdatedLabel('');
          setError(message);
        } finally {
          if (loadTokenRef.current === token) {
            setBusy(false);
          }
        }
      }, [api, ensureCoords, normalizeNearbyItems, radius]);

      useEffect(() => {
        loadNearby(false);
        return () => {
          loadTokenRef.current += 1;
        };
      }, [loadNearby]);

      useEffect(() => {
        if (!selected) return;
        const listener = (evt) => {
          if (evt.key === 'Escape') {
            setSelected(null);
          }
        };
        window.addEventListener('keydown', listener);
        return () => window.removeEventListener('keydown', listener);
      }, [selected]);

      useEffect(() => {
        if (!selected) return;
        const key = selected?.id ?? selected?.uuid ?? null;
        if (key == null) return;
        const next = items.find((item) => (item?.id ?? item?.uuid) === key);
        if (!next) {
          setSelected(null);
        } else if (next !== selected) {
          setSelected(next);
        }
      }, [items, selected]);

      const handleReload = useCallback(() => {
        loadNearby(true);
      }, [loadNearby]);

      const handleEdit = useCallback((listing) => {
        setSelected(null);
        setTab('browse');
        onEdit?.(listing);
      }, [onEdit, setTab]);

      return H('div', { id: 'tab-nearby' },
        H('section', { className: 'card', style: { padding: 12, margin: '12px 0 16px' } },
          H('div', { className: 'row nearby-filter', style: { gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
            H('input', {
              type: 'search',
              placeholder: 'Search nearby listings…',
              value: search,
              onChange: (e) => setSearch(e.target.value),
              disabled: busy,
              style: { flex: '1 1 220px', minWidth: 180 }
            }),
            H('select', {
              value: sort,
              onChange: (e) => setSort(e.target.value),
              disabled: busy,
              style: { width: 'auto' }
            },
              H('option', { value: 'new' }, 'Newest'),
              H('option', { value: 'price_asc' }, 'Price: Low → High'),
              H('option', { value: 'price_desc' }, 'Price: High → Low')
            ),
            H('label', { htmlFor: 'nearby-radius' }, 'Filter radius:'),
            H('select', {
              id: 'nearby-radius',
              value: radius,
              onChange: (e) => setRadius(Number(e.target.value)),
              disabled: busy,
              style: { width: 'auto' }
            },
              RADIUS_OPTIONS.map((opt) => H('option', { key: opt.value, value: opt.value }, opt.label))
            ),
            H('button', { className: 'btn', onClick: handleReload, disabled: busy }, busy ? 'Refreshing…' : 'Reload'),
            lastUpdatedLabel && H('span', { className: 'muted', style: { marginLeft: 'auto', fontSize: 11 } }, `Updated ${lastUpdatedLabel}`)
          ),
          locationLabel && H('div', { className: 'muted', style: { fontSize: 12, marginTop: 6 } }, locationLabel)
        ),

        error && H('div', { className: 'muted', style: { color: '#b91c1c', marginTop: 8, fontSize: 12 } }, error),

        H('section', { className: 'masonry', ref: masonryRef },
          orderedItems.map((item, index) => {
            const key = item.id || item.uuid || `nearby-${index}`;
            const cover = item.__cover || item.image_data || item.thumb_url || '';
            return H('div', { key, className: 'masonry-item' },
              H('div', {
                className: 'image-shell',
                style: { cursor: 'pointer' },
                onClick: () => setSelected(item)
              },
                cover
                  ? H('img', {
                      src: cover,
                      loading: 'lazy',
                      decoding: 'async',
                      alt: item.title || 'Nearby listing'
                    })
                  : H('div', {
                      style: {
                        width: '100%',
                        height: '100%',
                        background: '#f3f4f6',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#6b7280',
                        fontWeight: 600,
                        minHeight: 120
                      }
                    }, 'No image')
              )
            );
          })
        ),

        (!hasItems && hasBaseItems && !busy && !error) && H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, 'No nearby listings match your search.'),

        (!hasBaseItems && !busy && !error) && H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, 'No nearby listings found in this radius.'),

        busy && H('p', { className: 'muted', style: { padding: '12px 0' } }, 'Loading nearby listings…'),

        selected && H('div', {
          className: 'modal open',
          onClick: (e) => { if (e.target && e.target.classList && e.target.classList.contains('modal')) setSelected(null); }
        },
          H('div', { className: 'modal-inner listing-modal' },
            H('button', { className: 'close', onClick: () => setSelected(null) }, 'x'),
            H(ListingCard, {
              item: selected,
              user,
              canEdit: !!mineById[selected?.id],
              onEdit: handleEdit,
              onDelete,
              onMessage,
              onAdminDelete,
              onViewSeller,
              onToggleSold,
              showDistance: true,
              viewContext: 'nearby'
            })
          )
        ),

        H('div', { style: { marginTop: 12 } },
          H('button', {
            type: 'button',
            className: 'btn',
            onClick: () => setTab('browse')
          }, 'Back to listings')
        )
      );
    });

    return {
      NearbyPanel,
      DEFAULT_NEARBY_RADIUS_M
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.nearby = {
    createNearbyFeature
  };
})();

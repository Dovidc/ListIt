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
      fetchCoordsAndReverse
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

    const providedListingCard = components?.ListingCard;
    const providedListingsGrid = components?.ListingsGrid;

    const {
      useState,
      useMemo,
      useCallback,
      useRef,
      useEffect
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const formatFallbackPrice = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return '';
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0
        }).format(num);
      } catch {
        return `$${num.toFixed(Math.abs(num) < 1 ? 2 : 0)}`;
      }
    };

    const formatFallbackDistance = (item) => {
      const meters = Number(item?.distance_m);
      if (Number.isFinite(meters) && meters >= 0) {
        if (meters >= 1000) {
          return `${(meters / 1000).toFixed(1)} km away`;
        }
        return `${Math.round(meters)} m away`;
      }
      const feet = Number(item?.distance_ft);
      if (Number.isFinite(feet) && feet >= 0) {
        return `${Math.round(feet)} ft away`;
      }
      return '';
    };

    const normalizeCityStateLabel = (value) => {
      const raw = typeof value === 'string' ? value.trim() : '';
      if (!raw) return '';

      const throwawayPattern = /(^\d|#|\b(?:apt|apartment|suite|unit|floor|building|room)\b)/i;
      const segments = raw.split(',').map((part) => part.trim()).filter(Boolean);
      if (!segments.length) return '';

      const filtered = [];
      for (const segment of segments) {
        if (!segment) continue;
        if (!filtered.length && throwawayPattern.test(segment)) continue;
        filtered.push(segment);
      }

      if (!filtered.length) return '';
      if (filtered.length === 1) return filtered[0];

      const city = filtered[0];
      const stateCandidate = filtered[1];
      const stateParts = stateCandidate.split(/\s+/).filter(Boolean);
      while (stateParts.length > 1 && /[0-9]/.test(stateParts[stateParts.length - 1])) {
        stateParts.pop();
      }
      let state = (stateParts.join(' ') || stateCandidate).trim();
      if (/^[A-Za-z]{2}$/.test(state)) state = state.toUpperCase();

      return [city, state].filter(Boolean).join(', ');
    };

    const formatFallbackLocation = (item) => {
      const parts = [];
      const locationLabel = normalizeCityStateLabel(item?.location);
      if (locationLabel) parts.push(locationLabel);
      if (item?.owner_username) parts.push(`Seller: ${item.owner_username}`);
      return parts.join(' • ');
    };

    const ListingCard = typeof providedListingCard === 'function'
      ? providedListingCard
      : createFallbackListingCard({ React, H, formatFallbackPrice, formatFallbackDistance, formatFallbackLocation });

    if (typeof providedListingCard !== 'function') {
      try {
        console.warn('Nearby feature is using a fallback listing view because ListingCard component was not provided.');
      } catch { }
    }

    const ListingsGrid = typeof providedListingsGrid === 'function'
      ? providedListingsGrid
      : createFallbackListingsGrid({ React, H, formatFallbackPrice, formatFallbackDistance, formatFallbackLocation });

    if (typeof providedListingsGrid !== 'function') {
      try {
        console.warn('Nearby feature is using a fallback grid view because ListingsGrid component was not provided.');
      } catch { }
    }

    function createFallbackListingCard({
      React: ReactRuntime,
      H: createElement,
      formatFallbackPrice: formatPrice,
      formatFallbackDistance: formatDistance,
      formatFallbackLocation: formatLocation
    }) {
      const BaseCard = function NearbyFallbackListingCard({
        item,
        user,
        canEdit,
        onEdit,
        onDelete,
        onMessage,
        onAdminDelete,
        onViewSeller,
        onToggleSold,
        showDistance
      }) {
        if (!item) return null;

        const cover = item.__cover || item.image_data || item.thumb_url || '';
        const priceLabel = formatPrice(item.price);
        const distanceLabel = showDistance ? formatDistance(item) : '';
        const metaLabel = formatLocation(item);
        const isOwner = user && item?.user_id && user.id === item.user_id;
        const isSold = !!item?.sold;

        const actionButtons = [];

        if (!isOwner && typeof onMessage === 'function') {
          actionButtons.push(createElement('button', {
            key: 'msg',
            type: 'button',
            className: 'btn primary',
            onClick: () => onMessage(item)
          }, 'Message seller'));
        }

        if (!isOwner && typeof onViewSeller === 'function' && item?.user_id) {
          actionButtons.push(createElement('button', {
            key: 'view-seller',
            type: 'button',
            className: 'btn',
            onClick: () => onViewSeller(item.user_id, item.owner_username)
          }, item?.owner_username ? `View ${item.owner_username}` : 'View seller'));
        }

        if ((isOwner || canEdit) && typeof onEdit === 'function') {
          actionButtons.push(createElement('button', {
            key: 'edit',
            type: 'button',
            className: 'btn',
            onClick: () => onEdit(item)
          }, 'Edit listing'));
        }

        if ((isOwner || canEdit) && typeof onToggleSold === 'function') {
          actionButtons.push(createElement('button', {
            key: 'sold',
            type: 'button',
            className: 'btn',
            onClick: () => onToggleSold(item, !isSold)
          }, isSold ? 'Mark as unsold' : 'Mark as sold'));
        }

        if ((isOwner || canEdit) && typeof onDelete === 'function') {
          actionButtons.push(createElement('button', {
            key: 'delete',
            type: 'button',
            className: 'btn danger',
            onClick: () => onDelete(item)
          }, 'Remove listing'));
        }

        if (user?.is_admin && typeof onAdminDelete === 'function') {
          actionButtons.push(createElement('button', {
            key: 'admin-delete',
            type: 'button',
            className: 'btn danger',
            onClick: () => onAdminDelete(item?.id)
          }, 'Admin delete'));
        }

        return createElement('article', {
          className: 'nearby-card-fallback',
          style: {
            display: 'grid',
            gap: 16,
            padding: 16
          }
        },
          cover && createElement('img', {
            src: cover,
            alt: item?.title || 'Listing image',
            style: {
              width: '100%',
              borderRadius: 8,
              objectFit: 'cover',
              maxHeight: 360
            }
          }),
          createElement('div', { style: { display: 'grid', gap: 8 } },
            item?.title && createElement('h2', {
              style: { margin: 0, fontSize: 20 }
            }, item.title),
            priceLabel && createElement('p', {
              style: { margin: 0, fontWeight: 600 }
            }, priceLabel),
            distanceLabel && createElement('p', {
              style: { margin: 0, color: '#4b5563' }
            }, distanceLabel),
            metaLabel && createElement('p', {
              style: { margin: 0, color: '#4b5563' }
            }, metaLabel),
            item?.description && createElement('p', {
              style: { margin: '8px 0 0 0', whiteSpace: 'pre-line' }
            }, item.description),
            isSold && createElement('p', {
              style: { margin: 0, color: '#047857', fontWeight: 600 }
            }, 'Marked as sold')
          ),
          actionButtons.length
            ? createElement('div', {
              style: {
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8
              }
            }, actionButtons)
            : null
        );
      };

      return typeof ReactRuntime.memo === 'function'
        ? ReactRuntime.memo(BaseCard)
        : BaseCard;
    }

    function createFallbackListingsGrid({
      React: ReactRuntime,
      H: createElement,
      formatFallbackPrice: formatPrice,
      formatFallbackDistance: formatDistance,
      formatFallbackLocation: formatLocation
    }) {
      const FallbackListingsGrid = function NearbyFallbackListingsGrid({
        items = [],
        className,
        style,
        isMobile,
        onSelect
      }) {
        const resolvedClassName = [className, 'nearby-grid-fallback'].filter(Boolean).join(' ');
        const columnCount = isMobile ? 3 : 4;
        const baseStyle = {
          display: 'grid',
          gap: 12,
          alignItems: 'stretch',
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`
        };
        const resolvedStyle = style ? { ...baseStyle, ...style } : baseStyle;

        const renderItem = (item, index) => {
          if (!item) return null;
          const key = item?.id != null ? `listing-${item.id}` : `listing-${index}`;
          const cover = item.__cover || item.image_data || item.thumb_url || '';

          const handleActivate = typeof onSelect === 'function'
            ? () => onSelect(null, item, cover || null)
            : undefined;

          const handleKeyDown = typeof onSelect === 'function'
            ? (evt) => {
              if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                handleActivate();
              }
            }
            : undefined;

          const content = cover
            ? createElement('img', {
              key: 'img',
              src: cover,
              alt: item?.title || 'Listing image',
              style: {
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              }
            })
            : createElement('div', {
              key: 'img',
              style: {
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: '#e5e7eb',
                color: '#6b7280',
                fontSize: 12,
                fontWeight: 600
              }
            }, 'No image');

          return createElement('article', {
            key,
            className: ['card', 'nearby-grid-fallback-card'].join(' '),
            style: {
              position: 'relative',
              padding: 0,
              borderRadius: 8,
              overflow: 'hidden',
              background: '#f3f4f6',
              cursor: typeof onSelect === 'function' ? 'pointer' : 'default'
            },
            onClick: handleActivate,
            onKeyDown: handleKeyDown,
            role: typeof onSelect === 'function' ? 'button' : undefined,
            tabIndex: typeof onSelect === 'function' ? 0 : undefined
          },
            createElement('div', {
              key: 'aspect-wrapper',
              style: {
                position: 'relative',
                width: '100%',
                aspectRatio: '1 / 1'
              }
            }, content)
          );
        };

        return createElement('div', {
          className: resolvedClassName || null,
          style: resolvedStyle
        },
          (Array.isArray(items) ? items : []).map(renderItem)
        );
      };

      return ReactRuntime.memo ? ReactRuntime.memo(FallbackListingsGrid) : FallbackListingsGrid;
    }

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
      setTab,
      isMobile,
      onSupporterClick
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

      // Load persisted settings from localStorage
      const getPersistedSettings = () => {
        try {
          const saved = localStorage.getItem('listit_nearby_settings');
          if (saved) {
            const parsed = JSON.parse(saved);
            return {
              radius: Number(parsed?.radius) || 150,
              search: typeof parsed?.search === 'string' ? parsed.search : '',
              sort: typeof parsed?.sort === 'string' ? parsed.sort : 'dist'
            };
          }
        } catch { }
        return { radius: 150, search: '', sort: 'dist' };
      };

      const persistedSettings = getPersistedSettings();

      const [radius, setRadius] = useState(persistedSettings.radius);
      const [items, setItems] = useState([]);
      const [nextCursor, setNextCursor] = useState(null);
      const [hasMore, setHasMore] = useState(false);
      const [isLoadingMore, setIsLoadingMore] = useState(false);

      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [selected, setSelected] = useState(null);
      const [lastUpdatedLabel, setLastUpdatedLabel] = useState('');
      const [locationLabel, setLocationLabel] = useState(() => storedCoords?.display || '');
      const [search, setSearch] = useState(persistedSettings.search);
      const [debouncedSearch, setDebouncedSearch] = useState(persistedSettings.search);
      const [sort, setSort] = useState(persistedSettings.sort);

      const coordsRef = useRef(storedCoords ? { lat: storedCoords.lat, lon: storedCoords.lon } : null);
      const coordsTsRef = useRef(storedCoords?.ts || 0);
      const loadTokenRef = useRef(0);
      const sentinelRef = useRef(null);

      // Debounce search
      useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 500);
        return () => clearTimeout(timer);
      }, [search]);

      // Persist settings to localStorage whenever they change
      useEffect(() => {
        try {
          localStorage.setItem('listit_nearby_settings', JSON.stringify({
            radius,
            search,
            sort
          }));
        } catch { }
      }, [radius, search, sort]);

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

      const hasItems = items.length > 0;

      const handleSelectListing = useCallback((evt, item) => {
        if (!item) return;
        setSelected(item);
      }, []);

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
          } catch { }
          return coords;
        } catch (err) {
          if (!force && coordsRef.current) return coordsRef.current;
          throw err;
        }
      }, [fetchCoordsAndReverse]);

      const loadNearby = useCallback(async (forceLocation = false, isLoadMore = false) => {
        if (isLoadMore && !nextCursor) return;
        if (isLoadMore && (busy || isLoadingMore)) return;

        const token = ++loadTokenRef.current;
        if (isLoadMore) setIsLoadingMore(true);
        else setBusy(true);

        if (!isLoadMore) setError('');

        try {
          const coords = await ensureCoords(forceLocation);
          if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) {
            throw new Error('location_unavailable');
          }

          const cursorToUse = isLoadMore ? nextCursor : null;
          const response = await api.listNearby(coords.lat, coords.lon, radius, {
            silent: true,
            limit: 50,
            cursor: cursorToUse,
            q: debouncedSearch,
            sort: sort
          });

          if (loadTokenRef.current !== token) return;

          const rows = response?.items || [];
          const normalized = normalizeNearbyItems(rows);

          if (isLoadMore) {
            setItems(prev => [...prev, ...normalized]);
          } else {
            setItems(normalized);
          }

          setNextCursor(response?.next_cursor || null);
          setHasMore(!!response?.has_more);

          if (!isLoadMore) {
            setLastUpdatedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          }
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

          if (!isLoadMore) {
            setItems([]);
            setLastUpdatedLabel('');
            setError(message);
          }
        } finally {
          if (loadTokenRef.current === token) {
            setBusy(false);
            setIsLoadingMore(false);
          }
        }
      }, [api, ensureCoords, normalizeNearbyItems, radius, debouncedSearch, sort, nextCursor, busy, isLoadingMore]);

      // Infinite scroll observer
      useEffect(() => {
        if (!sentinelRef.current) return;
        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting && hasMore && !busy && !isLoadingMore) {
            loadNearby(false, true);
          }
        }, { rootMargin: '400px' });
        observer.observe(sentinelRef.current);
        return () => observer.disconnect();
      }, [hasMore, busy, isLoadingMore, loadNearby]);

      // Initial load and reload on filter change
      useEffect(() => {
        setItems([]);
        setNextCursor(null);
        setHasMore(false);
        loadNearby(false, false);
        return () => {
          loadTokenRef.current += 1;
        };
      }, [radius, debouncedSearch, sort]);

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
        loadNearby(true, false);
      }, [loadNearby]);

      const handleEdit = useCallback((listing) => {
        setSelected(null);
        setTab('browse');
        onEdit?.(listing);
      }, [onEdit, setTab]);

      return H('div', { id: 'tab-nearby' },
        H('section', { className: 'card', style: { padding: 8, margin: '8px 0 12px' } },
          // Row 1: Search input (full width)
          H('input', {
            type: 'search',
            placeholder: 'Search nearby listings…',
            value: search,
            onChange: (e) => setSearch(e.target.value),
            disabled: busy && !isLoadingMore,
            style: { width: '100%', marginBottom: 8, fontSize: 14, padding: '8px 12px', minHeight: 38 }
          }),
          // Row 2: Compact controls
          H('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
            H('select', {
              value: sort,
              onChange: (e) => setSort(e.target.value),
              disabled: busy && !isLoadingMore,
              style: { flex: '1 1 auto', fontSize: 13, padding: '6px 8px', minHeight: 36 }
            },
              H('option', { value: 'dist' }, 'Distance'),
              H('option', { value: 'new' }, 'Newest'),
              H('option', { value: 'price_asc' }, 'Low→High'),
              H('option', { value: 'price_desc' }, 'High→Low')
            ),
            H('select', {
              id: 'nearby-radius',
              value: radius,
              onChange: (e) => setRadius(Number(e.target.value)),
              disabled: busy && !isLoadingMore,
              style: { flex: '0 0 auto', fontSize: 13, padding: '6px 8px', minHeight: 36 }
            },
              RADIUS_OPTIONS.map((opt) => H('option', { key: opt.value, value: opt.value }, opt.label))
            ),
            H('button', {
              className: 'btn',
              onClick: handleReload,
              disabled: busy && !isLoadingMore,
              style: { flex: '0 0 auto', fontSize: 13, padding: '6px 12px', minHeight: 36 }
            }, (busy && !isLoadingMore) ? '⟳' : '⟳')
          ),
          // Row 3: Location and timestamp (compact)
          H('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: 11, color: '#6b7280' } },
            locationLabel && H('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, locationLabel),
            lastUpdatedLabel && H('span', { style: { flex: '0 0 auto', marginLeft: 8 } }, lastUpdatedLabel)
          )
        ),

        error && H('div', { className: 'muted', style: { color: '#b91c1c', marginTop: 8, fontSize: 12 } }, error),

        H(ListingsGrid, {
          className: 'nearby-grid',
          items: items,
          isMobile: !!isMobile,
          onSelect: handleSelectListing,
          onSupporterClick,
          enableVirtualization: true
        }),

        H('div', { ref: sentinelRef, style: { height: 20, marginBottom: 20 } }),
        isLoadingMore && H('p', { className: 'muted', style: { textAlign: 'center' } }, 'Loading more...'),

        (!hasItems && !busy && !error && debouncedSearch) && H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, 'No nearby listings match your search.'),

        (!hasItems && !busy && !error && !debouncedSearch) && H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, 'No nearby listings found in this radius.'),

        (busy && !isLoadingMore) && H('p', { className: 'muted', style: { padding: '12px 0' } }, 'Loading nearby listings…'),

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
              onSupporterClick,
              viewContext: 'nearby'
            })
          )
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

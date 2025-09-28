(() => {
  function createGridComponents({ React, components = {} } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Grid components require React.');
    }

    const { ImageWithSkeleton } = components;
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Grid components require ImageWithSkeleton component.');
    }

    const AdTile = typeof components.AdTile === 'function' ? components.AdTile : null;

    const { useEffect, useMemo, useRef } = React;
    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const GridTile = React.memo(function GridTile({ item, onEnsureCover, onSelect }) {
      const ref = useRef(null);

      useEffect(() => {
        const el = ref.current;
        if (!el || !item?.id) return;

        const observer = new IntersectionObserver((entries) => {
          if (!Array.isArray(entries)) return;
          const intersecting = entries.some((entry) => entry.isIntersecting);
          if (intersecting) {
            if (!item.__cover && typeof onEnsureCover === 'function') {
              onEnsureCover(item.id);
            }
            observer.disconnect();
          }
        }, { rootMargin: '800px 0px' });

        observer.observe(el);
        return () => observer.disconnect();
      }, [item?.id, item?.__cover, onEnsureCover]);

      const src = item?.__cover;

      return H('div', { ref, className: 'card', style: { padding: 0, overflow: 'hidden', borderRadius: 8 } },
        H('div', { style: { position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#f3f4f6' } },
          src && H(ImageWithSkeleton, {
            src,
            alt: item?.title || 'Item',
            loading: 'lazy',
            decoding: 'async',
            fetchPriority: 'low',
            style: {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              cursor: 'pointer'
            },
            disableSkeleton: true,
            onClick: (evt) => typeof onSelect === 'function' ? onSelect(evt, item, src) : undefined
          })
        )
      );
    });

    const ListingsGrid = React.memo(function ListingsGrid({
      items = [],
      ads = [],
      isMobile = false,
      onEnsureCover,
      onSelect,
      columns,
      gap = 12,
      className,
      style
    }) {
      const normalizedAds = useMemo(() => {
        if (!Array.isArray(ads) || !ads.length) return [];
        return ads.map((ad) => ({
          ...ad,
          position: Number.isFinite(Number(ad?.position)) ? Number(ad.position) : 0
        }));
      }, [ads]);

      const entries = useMemo(() => {
        const base = (items || []).map((it) => ({ type: 'listing', data: it }));
        if (!normalizedAds.length) return base;
        const result = [...base];
        const sortedAds = [...normalizedAds].sort((a, b) => {
          const posDiff = (Number(b.position) || 0) - (Number(a.position) || 0);
          if (posDiff !== 0) return posDiff;
          const timeA = a.updated_at || a.created_at || '';
          const timeB = b.updated_at || b.created_at || '';
          if (timeA !== timeB) return timeB.localeCompare(timeA);
          return Number(b.id || 0) - Number(a.id || 0);
        });
        sortedAds.forEach((ad) => {
          const pos = Number.isFinite(ad.position) ? ad.position : 0;
          const idx = Math.min(Math.max(pos, 0), result.length);
          result.splice(idx, 0, { type: 'ad', data: ad });
        });
        return result;
      }, [items, normalizedAds]);

      const cols = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : (isMobile ? 3 : 4);
      const resolvedGap = Number.isFinite(gap) ? gap : 12;
      const sectionStyle = {
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: resolvedGap,
        ...(style || {})
      };

      const containerProps = {
        className,
        style: sectionStyle
      };

      return H('section', containerProps,
        entries.map((entry, index) => {
          if (entry.type === 'ad') {
            if (!AdTile) return null;
            const id = entry.data?.id;
            const key = id != null ? `ad-${id}` : `ad-${index}`;
            return H(AdTile, { key, ad: entry.data, cols });
          }
          const data = entry.data;
          const id = data?.id;
          const key = id != null ? `listing-${id}` : `listing-${index}`;
          return H(GridTile, {
            key,
            item: data,
            onEnsureCover,
            onSelect
          });
        })
      );
    });

    return {
      GridTile,
      ListingsGrid
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.grid = {
    createGridComponents
  };
})();

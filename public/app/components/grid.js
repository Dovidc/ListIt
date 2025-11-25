(() => {
  function createGridComponents({ React, components = {}, helpers = {} } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Grid components require React.');
    }

    const { ImageWithSkeleton } = components;
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Grid components require ImageWithSkeleton component.');
    }

    const AdTile = typeof components.AdTile === 'function' ? components.AdTile : null;
    const { useVirtualGrid } = helpers;

    const { useMemo, useState, useRef, useLayoutEffect, useEffect } = React;
    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    // Simple grid tile - no observers, no refs, just render
    const GridTile = React.memo(function GridTile({ item, onSelect, isMobile }) {
      const src = item?.__cover;
      const isClickable = typeof onSelect === 'function';

      const handleClick = isClickable
        ? (evt) => onSelect(evt, item, src)
        : undefined;

      const handleKeyDown = isClickable
        ? (evt) => {
          if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            onSelect(evt, item, src);
          }
        }
        : undefined;

      return H('div', {
        className: 'card',
        'data-listing-id': item?.id,
        style: {
          padding: 0,
          overflow: 'hidden',
          borderRadius: 8,
          cursor: isClickable ? 'pointer' : 'default'
        },
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        role: isClickable ? 'button' : undefined,
        tabIndex: isClickable ? 0 : undefined
      },
        H('div', {
          style: {
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            background: '#f3f4f6',
            overflow: 'hidden'
          }
        },
          src
            ? H(ImageWithSkeleton, {
              src,
              alt: item?.title || 'Item',
              loading: 'lazy',
              decoding: 'async',
              fetchPriority: 'low',
              width: 300,
              height: 300,
              style: {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              }
            })
            : H('div', {
              style: {
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                padding: 12,
                textAlign: 'center',
                color: '#6b7280',
                fontWeight: 600,
                fontSize: 12
              }
            }, 'No image')
        )
      );
    }, (prev, next) => {
      if (prev.item === next.item) return true;
      if (!prev.item || !next.item) return false;
      return (
        prev.item.id === next.item.id &&
        prev.item.__cover === next.item.__cover
      );
    });

    // Simple CSS grid - no virtualization, no absolute positioning
    // Let the browser handle scrolling naturally
    // Virtualized Grid
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
      // Merge items and ads
      const entries = useMemo(() => {
        const base = (items || []).map((it) => ({ type: 'listing', data: it }));
        if (!Array.isArray(ads) || !ads.length) {
          return base;
        }

        const result = [...base];
        const normalizedAds = ads.map((ad) => ({
          ...ad,
          position: Number.isFinite(Number(ad?.position)) ? Number(ad.position) : 0
        }));

        // Sort ads by position descending so we insert from end
        const sortedAds = [...normalizedAds].sort((a, b) => {
          const posDiff = (Number(b.position) || 0) - (Number(a.position) || 0);
          if (posDiff !== 0) return posDiff;
          return Number(b.id || 0) - Number(a.id || 0);
        });

        sortedAds.forEach((ad) => {
          const pos = Number.isFinite(ad.position) ? ad.position : 0;
          const idx = Math.min(Math.max(pos, 0), result.length);
          result.splice(idx, 0, { type: 'ad', data: ad });
        });

        return result;
      }, [items, ads]);

      const containerRef = useRef(null);
      const [containerWidth, setContainerWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1000);

      useLayoutEffect(() => {
        if (!containerRef.current) return;
        // Simple ResizeObserver
        const ro = new ResizeObserver(entries => {
          for (const entry of entries) {
            if (entry.contentRect.width > 0) {
              setContainerWidth(entry.contentRect.width);
            }
          }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
      }, []);

      const cols = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : (isMobile ? 3 : 4);
      const resolvedGap = Number.isFinite(gap) ? gap : 12;

      // Calculate item dimensions (1:1 aspect ratio)
      const itemWidth = containerWidth > 0
        ? (containerWidth - (cols - 1) * resolvedGap) / cols
        : 0;

      // Use virtualization hook
      const {
        startIndex,
        endIndex,
        totalHeight
      } = useVirtualGrid({
        totalItems: entries.length,
        columnCount: cols,
        itemHeight: itemWidth,
        gap: resolvedGap,
        buffer: 6 // slightly larger buffer for smoother scrolling
      });

      // Generate visible items
      const visibleItems = [];
      for (let i = startIndex; i < endIndex; i++) {
        const entry = entries[i];
        if (!entry) continue;

        const rowIndex = Math.floor(i / cols);
        const colIndex = i % cols;

        const top = rowIndex * (itemWidth + resolvedGap);
        const left = colIndex * (itemWidth + resolvedGap);

        visibleItems.push({
          ...entry,
          key: entry.type === 'ad' ? `ad-${entry.data?.id || i}` : `listing-${entry.data?.id || i}`,
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${itemWidth}px`,
            height: `${itemWidth}px`,
            transform: `translate3d(${left}px, ${top}px, 0)`
          }
        });
      }

      // Trigger cover loading for visible items
      useEffect(() => {
        if (typeof onEnsureCover !== 'function') return;

        for (let i = startIndex; i < endIndex; i++) {
          const entry = entries[i];
          if (entry && entry.type === 'listing' && entry.data?.id) {
            onEnsureCover(entry.data.id);
          }
        }
      }, [startIndex, endIndex, entries, onEnsureCover]);

      return H('section', {
        ref: containerRef,
        className,
        style: {
          ...(style || {}),
          position: 'relative',
          height: `${totalHeight}px`,
          overflow: 'hidden' // Ensure no overflow issues
        }
      },
        visibleItems.map(({ type, data, key, style }) => {
          if (type === 'ad') {
            if (!AdTile) return null;
            return H('div', { key, style },
              H(AdTile, { ad: data, cols })
            );
          }

          return H('div', { key, style },
            H(GridTile, {
              item: data,
              onSelect,
              isMobile
            })
          );
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

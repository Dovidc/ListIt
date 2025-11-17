(() => {
  function createGridComponents({ React, components = {}, helpers = {} } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Grid components require React.');
    }

    const { ImageWithSkeleton, SupporterBadge } = components;
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Grid components require ImageWithSkeleton component.');
    }
    if (typeof SupporterBadge !== 'function') {
      throw new Error('Grid components require SupporterBadge component.');
    }

    const AdTile = typeof components.AdTile === 'function' ? components.AdTile : null;

    const { useVirtualMasonry } = helpers || {};
    const hasVirtualMasonry = typeof useVirtualMasonry === 'function';

    const { useEffect, useMemo, useRef } = React;
    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const VirtualEntry = React.memo(function VirtualEntry({ id, style, children, onHeightChange }) {
      const ref = useRef(null);
      const lastHeightRef = useRef(null);

      useEffect(() => {
        if (typeof onHeightChange !== 'function') return undefined;
        const el = ref.current;
        if (!el) return undefined;

        let frame = null;
        let resizeObserver = null;

        const emitHeight = () => {
          if (!ref.current) return;
          const rect = ref.current.getBoundingClientRect();
          const height = rect.height;
          if (!Number.isFinite(height) || height <= 0) return;
          if (lastHeightRef.current === height) return;
          lastHeightRef.current = height;
          onHeightChange(id, height);
        };

        emitHeight();

        if (typeof ResizeObserver === 'function') {
          resizeObserver = new ResizeObserver(() => emitHeight());
          resizeObserver.observe(el);
        } else {
          const loop = () => {
            emitHeight();
            frame = window.requestAnimationFrame(loop);
          };
          frame = window.requestAnimationFrame(loop);
        }

        return () => {
          lastHeightRef.current = null;
          if (resizeObserver) resizeObserver.disconnect();
          if (frame != null) window.cancelAnimationFrame(frame);
        };
      }, [id, onHeightChange]);

      return H('div', {
        ref,
        style: {
          position: 'absolute',
          boxSizing: 'border-box',
          ...style
        }
      }, children);
    });

    const GridTile = React.memo(function GridTile({ item, onEnsureCover, onSelect, onSupporterClick }) {
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
      const isClickable = typeof onSelect === 'function';

      const handleSelect = isClickable
        ? (evt) => {
            onSelect(evt, item, src);
          }
        : undefined;

      const handleKeyDown = isClickable
        ? (evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
              evt.preventDefault();
              onSelect(evt, item, src);
            }
          }
        : undefined;

      const supporterData = item?.owner_supporter_badge ? {
        username: item?.owner_username ? item.owner_username : null,
        since: item?.owner_supporter_since || null,
        badge: item?.owner_supporter_badge || null
      } : null;

      return H('div', {
        ref,
        className: 'card',
        style: {
          padding: 0,
          overflow: 'hidden',
          borderRadius: 8,
          cursor: isClickable ? 'pointer' : 'default'
        },
        onClick: handleSelect,
        onKeyDown: handleKeyDown,
        role: isClickable ? 'button' : undefined,
        tabIndex: isClickable ? 0 : undefined
      },
        H('div', { style: { position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#f3f4f6', overflow: 'hidden' } },
          src
            ? H(ImageWithSkeleton, {
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
                  display: 'block'
                },
                disableSkeleton: true
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
    });

    const ListingsGrid = React.memo(function ListingsGrid({
      items = [],
      ads = [],
      isMobile = false,
      onEnsureCover,
      onSelect,
      onSupporterClick,
      columns,
      gap = 12,
      enableVirtualization = false,
      className,
      style
    }) {
      console.log('ListingsGrid received - items:', items?.length, 'ads:', ads, 'ads length:', ads?.length);

      const normalizedAds = useMemo(() => {
        if (!Array.isArray(ads) || !ads.length) {
          console.log('No ads to normalize');
          return [];
        }
        const normalized = ads.map((ad) => ({
          ...ad,
          position: Number.isFinite(Number(ad?.position)) ? Number(ad.position) : 0
        }));
        console.log('Normalized ads:', normalized);
        return normalized;
      }, [ads]);

      const entries = useMemo(() => {
        const base = (items || []).map((it) => ({ type: 'listing', data: it }));
        if (!normalizedAds.length) {
          console.log('Entries: no ads, returning', base.length, 'listings');
          return base;
        }
        const result = [...base];
        const sortedAds = [...normalizedAds].sort((a, b) => {
          const posDiff = (Number(b.position) || 0) - (Number(a.position) || 0);
          if (posDiff !== 0) return posDiff;
          const timeA = a.updated_at || a.created_at || '';
          const timeB = b.updated_at || b.created_at || '';
          if (timeA !== timeB) return timeB.localeCompare(timeA);
          return Number(b.id || 0) - Number(a.id || 0);
        });
        console.log('Sorted ads:', sortedAds);
        sortedAds.forEach((ad) => {
          const pos = Number.isFinite(ad.position) ? ad.position : 0;
          const idx = Math.min(Math.max(pos, 0), result.length);
          console.log('Inserting ad at position:', pos, 'index:', idx, 'ad:', ad);
          result.splice(idx, 0, { type: 'ad', data: ad });
        });
        console.log('Final entries:', result.length, 'total (listings + ads)');
        console.log('Entries breakdown:', result.filter(e => e.type === 'listing').length, 'listings,', result.filter(e => e.type === 'ad').length, 'ads');
        return result;
      }, [items, normalizedAds]);

      const cols = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : (isMobile ? 3 : 4);
      const resolvedGap = Number.isFinite(gap) ? gap : 12;

      const containerRef = useRef(null);
      const virtualizationAvailable = enableVirtualization && hasVirtualMasonry;

      const virtualItems = useMemo(() => {
        if (!virtualizationAvailable) return [];
        return entries.map((entry, index) => {
          const dataId = entry?.data?.id;
          const baseId = dataId != null ? String(dataId) : String(index);
          const prefix = entry.type === 'ad' ? 'ad' : 'listing';
          return {
            id: `${prefix}-${baseId}`,
            entry,
            index
          };
        });
      }, [entries, virtualizationAvailable]);

      const shouldVirtualize = virtualizationAvailable && entries.length >= 120;
      const virtualizationEstimate = isMobile ? 210 : 240;
      const virtualizationState = virtualizationAvailable
        ? useVirtualMasonry({
            containerRef,
            items: virtualItems,
            columnCount: cols,
            columnGap: resolvedGap,
            estimateHeight: virtualizationEstimate,
            overscanVH: 2,
            active: shouldVirtualize
          })
        : null;
      const fallbackHeight = entries.length && cols > 0
        ? Math.max(0, (Math.ceil(entries.length / cols) * (virtualizationEstimate + resolvedGap)) - resolvedGap)
        : 0;

      const baseStyle = { ...(style || {}) };
      const gridStyle = {
        ...baseStyle,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: resolvedGap
      };

      if (shouldVirtualize && virtualizationState) {
        const {
          visible = [],
          positions = [],
          containerHeight = 0,
          registerHeight,
          colWidth
        } = virtualizationState;

        const itemsToRender = visible.length
          ? visible
          : virtualItems.map((item, idx) => ({ item, pos: positions[idx] }));

        const estimatedHeight = containerHeight > 0 ? containerHeight : fallbackHeight;
        const minHeight = containerHeight > 0 ? containerHeight : fallbackHeight;
        const virtualStyle = { ...baseStyle, position: 'relative' };
        if (baseStyle.height == null) {
          virtualStyle.height = estimatedHeight;
        }
        if (baseStyle.minHeight == null) {
          virtualStyle.minHeight = minHeight;
        }

        return H('section', { ref: containerRef, className, style: virtualStyle },
          itemsToRender.map(({ item, pos }) => {
            const entry = item?.entry;
            if (!entry) return null;
            const position = pos || {};
            const width = position.width ?? colWidth ?? '100%';
            const commonProps = {
              key: item.id,
              id: item.id,
              style: {
                top: position.top ?? 0,
                left: position.left ?? 0,
                width
              },
              onHeightChange: registerHeight
            };

            if (entry.type === 'ad') {
              if (!AdTile) return null;
              return H(VirtualEntry, commonProps,
                H(AdTile, { ad: entry.data, cols })
              );
            }

            return H(VirtualEntry, commonProps,
              H(GridTile, {
                item: entry.data,
                onEnsureCover,
                onSelect,
                onSupporterClick
              })
            );
          })
        );
      }

      return H('section', { className, style: gridStyle },
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
            onSelect,
            onSupporterClick
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

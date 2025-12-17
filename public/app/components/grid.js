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

    // Format distance for display
    const formatDistanceBadge = (meters) => {
      if (!Number.isFinite(meters) || meters < 0) return null;
      const feet = meters * 3.28084;
      // Don't show distance badge if > 1000 feet away
      if (feet > 1000) return null;
      if (feet < 1000) return `${Math.round(feet)} ft`;
      const miles = feet / 5280;
      return `${miles.toFixed(1)} mi`;
    };

    // Simple grid tile - no observers, no refs, just render
    const GridTile = React.memo(function GridTile({ item, onSelect, isMobile }) {
      const src = item?.__cover;
      const isClickable = typeof onSelect === 'function';
      const hasDistance = Number.isFinite(item?.distance_m);
      const distanceLabel = hasDistance ? formatDistanceBadge(item.distance_m) : null;

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
            }, 'No image'),
          // Distance badge - green indicator for nearby listings
          distanceLabel && H('div', {
            style: {
              position: 'absolute',
              bottom: 6,
              left: 6,
              background: '#059669',
              color: '#fff',
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }
          }, distanceLabel)
        )
      );
    }, (prev, next) => {
      if (prev.item === next.item) return true;
      if (!prev.item || !next.item) return false;
      return (
        prev.item.id === next.item.id &&
        prev.item.__cover === next.item.__cover &&
        prev.item.distance_m === next.item.distance_m
      );
    });

    // Simple CSS grid - no virtualization, no absolute positioning
    // Let the browser handle scrolling naturally
    // Virtualized Grid with Instagram-style loading
    const ListingsGrid = React.memo(function ListingsGrid({
      items = [],
      ads = [],
      isMobile = false,
      onEnsureCover,
      onSelect,
      columns,
      gap = 12,
      className,
      style,
      isLoading = false,
      hasMore = false,
      sentinelRef,
      disableVirtualization = false
    }) {
      // Ad dimensions: 2 columns wide, 1 row tall
      const AD_COLS = 2;
      const AD_ROWS = 1;

      const containerRef = useRef(null);
      const [containerWidth, setContainerWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1000);

      useLayoutEffect(() => {
        if (!containerRef.current) return;
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

      // On desktop, use 6 columns if container is wide enough (1400px+), otherwise 4
      const desktopCols = containerWidth >= 1400 ? 6 : 4;
      const cols = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : (isMobile ? 3 : desktopCols);
      const resolvedGap = Number.isFinite(gap) ? gap : 12;

      const itemWidth = containerWidth > 0
        ? (containerWidth - (cols - 1) * resolvedGap) / cols
        : 0;

      // Build layout with proper ad placement - ads occupy multiple cells, items flow around
      const layoutData = useMemo(() => {
        const listings = (items || []).map((it) => ({ type: 'listing', data: it }));
        const normalizedAds = (ads || []).map((ad) => ({
          type: 'ad',
          data: ad,
          position: Number.isFinite(Number(ad?.position)) ? Number(ad.position) : 0,
          spanCols: AD_COLS,
          spanRows: AD_ROWS
        }));

        // Grid of occupied cells: occupied[row][col] = true if occupied
        const occupied = {};
        const isOccupied = (r, c) => occupied[r]?.[c];
        const markOccupied = (r, c) => {
          if (!occupied[r]) occupied[r] = {};
          occupied[r][c] = true;
        };

        const placedItems = [];
        let listingIndex = 0;
        let cellIndex = 0; // Virtual cell index for positioning

        // Sort ads by position
        const sortedAds = [...normalizedAds].sort((a, b) => (a.position || 0) - (b.position || 0));
        let adIndex = 0;

        // Place items cell by cell, inserting ads at their positions
        while (listingIndex < listings.length || adIndex < sortedAds.length) {
          const row = Math.floor(cellIndex / cols);
          const col = cellIndex % cols;

          // Skip if this cell is already occupied (by a multi-row ad from above)
          if (isOccupied(row, col)) {
            cellIndex++;
            continue;
          }

          // Check if an ad should be placed at this position
          const nextAd = sortedAds[adIndex];
          if (nextAd && placedItems.filter(p => p.type === 'listing').length >= nextAd.position) {
            // Place the ad
            const adSpanCols = Math.min(nextAd.spanCols, cols - col); // Don't overflow grid
            const adSpanRows = nextAd.spanRows;

            // Mark all cells the ad occupies
            for (let dr = 0; dr < adSpanRows; dr++) {
              for (let dc = 0; dc < adSpanCols; dc++) {
                markOccupied(row + dr, col + dc);
              }
            }

            placedItems.push({
              ...nextAd,
              row,
              col,
              spanCols: adSpanCols,
              spanRows: adSpanRows,
              key: `ad-${nextAd.data?.id || adIndex}`
            });
            adIndex++;
            cellIndex++;
            continue;
          }

          // Place a listing
          if (listingIndex < listings.length) {
            markOccupied(row, col);
            placedItems.push({
              ...listings[listingIndex],
              row,
              col,
              spanCols: 1,
              spanRows: 1,
              key: `listing-${listings[listingIndex].data?.id || listingIndex}`
            });
            listingIndex++;
          }
          cellIndex++;

          // Safety: prevent infinite loop
          if (cellIndex > (listings.length + sortedAds.length * AD_ROWS * AD_COLS) * 2) break;
        }

        // Calculate total rows needed
        let maxRow = 0;
        placedItems.forEach(item => {
          const bottomRow = item.row + (item.spanRows || 1) - 1;
          if (bottomRow > maxRow) maxRow = bottomRow;
        });

        return { placedItems, totalRows: maxRow + 1 };
      }, [items, ads, cols]);

      const { placedItems, totalRows } = layoutData;
      const totalHeight = totalRows * itemWidth + (totalRows > 0 ? (totalRows - 1) * resolvedGap : 0);

      // Use virtualization hook
      const {
        startIndex: virtualStartIndex,
        endIndex: virtualEndIndex
      } = useVirtualGrid({
        totalItems: placedItems.length,
        columnCount: cols,
        itemHeight: itemWidth,
        gap: resolvedGap,
        buffer: 6
      });

      const startIndex = disableVirtualization ? 0 : virtualStartIndex;
      const endIndex = disableVirtualization ? placedItems.length : virtualEndIndex;

      // Generate visible items with proper positioning
      const visibleItems = [];
      for (let i = startIndex; i < endIndex; i++) {
        const item = placedItems[i];
        if (!item) continue;

        const top = item.row * (itemWidth + resolvedGap);
        const left = item.col * (itemWidth + resolvedGap);
        const width = item.spanCols * itemWidth + (item.spanCols - 1) * resolvedGap;
        const height = item.spanRows * itemWidth + (item.spanRows - 1) * resolvedGap;

        visibleItems.push({
          ...item,
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate3d(${left}px, ${top}px, 0)`
          }
        });
      }

      // Trigger cover loading for visible items
      useEffect(() => {
        if (typeof onEnsureCover !== 'function') return;

        for (let i = startIndex; i < endIndex; i++) {
          const item = placedItems[i];
          if (item && item.type === 'listing' && item.data?.id) {
            onEnsureCover(item.data.id);
          }
        }
      }, [startIndex, endIndex, placedItems, onEnsureCover]);

      // Calculate loading indicator height - always show footer area when there are items
      const loaderHeight = 60;
      const hasItems = placedItems.length > 0;
      const extraHeight = hasItems ? loaderHeight : 0;

      return H('section', {
        ref: containerRef,
        className,
        style: {
          ...(style || {}),
          position: 'relative',
          height: `${totalHeight + extraHeight}px`,
          overflow: 'hidden' // Ensure no overflow issues
        }
      },
        visibleItems.map(({ type, data, key, style }) => {
          if (type === 'ad') {
            if (!AdTile) return null;
            return H('div', { key, style: { ...style, zIndex: 1 } },
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
        }),
        // Footer at bottom of grid - shows spinner when loading, "No more listings" when done
        hasItems && H('div', {
          style: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${loaderHeight}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }
        },
          isLoading
            ? H('div', { className: 'spinner' })
            : (!hasMore && H('span', {
                style: {
                  color: '#6b7280',
                  fontSize: 14,
                  fontWeight: 500
                }
              }, 'No more listings'))
        ),
        // Sentinel for infinite scroll - placed at very bottom
        sentinelRef && H('div', {
          ref: sentinelRef,
          style: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: 1,
            pointerEvents: 'none'
          }
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

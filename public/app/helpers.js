(() => {
  function createHelpers({ React }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Helpers require React.');
    }

    const {
      useCallback,
      useEffect,
      useRef,
      useState
    } = React;

    function H(tag, props, ...children) {
      return React.createElement(tag, props || null, ...children);
    }

    function isMobileDevice() {
      const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase();

      if (/(iphone|ipod|ipad|android|windows phone|iemobile|mobile)/.test(ua)) {
        return true;
      }

      if (/macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
        return true;
      }

      return false;
    }

    // ============================================================
    // HOOK: useVirtualGrid
    // Virtualizes a grid of items based on window scroll
    // Optimized with throttling to prevent crashes during rapid scroll
    // ============================================================
    function useVirtualGrid({
      totalItems,
      columnCount,
      itemHeight,
      gap = 0,
      buffer = 4,
      headerHeight = 0
    }) {
      const [scrollTop, setScrollTop] = useState(0);
      const [viewportHeight, setViewportHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);
      const lastValueRef = useRef(0);

      useEffect(() => {
        if (typeof window === 'undefined') return;

        const getScrollTop = () => {
          // Try multiple ways to get scroll position for Capacitor iOS compatibility
          return window.scrollY ||
                 window.pageYOffset ||
                 document.documentElement.scrollTop ||
                 document.body.scrollTop ||
                 0;
        };

        const updateScroll = () => {
          const value = getScrollTop();
          // Only update state if value changed (prevents unnecessary re-renders)
          if (value !== lastValueRef.current) {
            lastValueRef.current = value;
            setScrollTop(value);
          }
        };

        const onResize = () => {
          setViewportHeight(window.innerHeight || document.documentElement.clientHeight);
        };

        // Listen to scroll events
        window.addEventListener('scroll', updateScroll, { passive: true });
        document.addEventListener('scroll', updateScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });

        // Polling fallback for Capacitor iOS where scroll events don't fire
        const pollInterval = setInterval(updateScroll, 100);

        // Initial check
        updateScroll();

        return () => {
          window.removeEventListener('scroll', updateScroll);
          document.removeEventListener('scroll', updateScroll);
          window.removeEventListener('resize', onResize);
          clearInterval(pollInterval);
        };
      }, []);

      // Calculate grid dimensions
      const safeCols = Math.max(1, Math.floor(columnCount));
      const rowCount = Math.ceil(totalItems / safeCols);
      const totalHeight = rowCount * itemHeight + (rowCount > 0 ? (rowCount - 1) * gap : 0);

      // Calculate visible range
      // We assume the grid starts at some offset, but for simplicity in this app
      // (where the grid is the main content), we can just use scrollY relative to the document.
      // Ideally we'd subtract the grid's offsetTop, but that requires a ref and measurement.
      // For now, we'll assume the grid is roughly at the top or we just render extra buffer.
      // To be safer, we can accept a 'headerHeight' or just over-buffer.

      // Let's try to be robust: render from (scrollTop - buffer) to (scrollTop + viewport + buffer)
      // We map this to rows.

      // Effective top relative to grid:
      // If the grid is further down, scrollTop might be less than gridTop.
      // But usually we care when scrollTop > gridTop.
      // Let's assume the grid starts after 'headerHeight'.
      const relativeScrollTop = Math.max(0, scrollTop - headerHeight);

      const rowStart = Math.floor(relativeScrollTop / (itemHeight + gap));
      const rowEnd = Math.ceil((relativeScrollTop + viewportHeight) / (itemHeight + gap));

      const visibleRowStart = Math.max(0, rowStart - buffer);
      const visibleRowEnd = Math.min(rowCount, rowEnd + buffer);

      const startIndex = visibleRowStart * safeCols;
      const endIndex = Math.min(totalItems, visibleRowEnd * safeCols);

      return {
        startIndex,
        endIndex,
        totalHeight,
        visibleRowStart,
        visibleRowEnd
      };
    }

    // Simple LRU cache implementation for cover images
    function createLRUCache(maxSize = 200) {
      const cache = new Map();
      return {
        get(key) {
          if (!cache.has(key)) return undefined;
          const value = cache.get(key);
          // Move to end (most recently used)
          cache.delete(key);
          cache.set(key, value);
          return value;
        },
        set(key, value) {
          if (cache.has(key)) {
            cache.delete(key);
          } else if (cache.size >= maxSize) {
            // Delete oldest (first) entry
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
          }
          cache.set(key, value);
        },
        has(key) {
          return cache.has(key);
        },
        delete(key) {
          return cache.delete(key);
        },
        clear() {
          cache.clear();
        },
        size() {
          return cache.size;
        },
        toObject() {
          const obj = Object.create(null);
          for (const [k, v] of cache) obj[k] = v;
          return obj;
        }
      };
    }

    function seenKey(userId) {
      return `listit_seen_${userId || 'anon'}`;
    }

    function loadSeen(userId) {
      try {
        return JSON.parse(localStorage.getItem(seenKey(userId)) || '{}');
      } catch {
        return {};
      }
    }

    function saveSeen(userId, map) {
      try {
        localStorage.setItem(seenKey(userId), JSON.stringify(map || {}));
      } catch {
        // ignore storage errors
      }
    }

    async function urlToDataUrl(url) {
      if (!url || !url.startsWith('http')) return null;
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error('Failed to fetch');
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        console.error('Failed to convert URL to data URL:', error);
        return null;
      }
    }

    function base64UrlToUint8Array(base64String) {
      if (!base64String || typeof base64String !== 'string') return null;
      try {
        const padded = base64String + '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
        return output;
      } catch (err) {
        console.warn('Failed to decode VAPID key:', err);
        return null;
      }
    }

    function arrayBufferToBase64Url(buf) {
      if (!buf) return '';
      try {
        const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || []);
        let binary = '';
        bytes.forEach((b) => {
          binary += String.fromCharCode(b);
        });
        return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      } catch {
        return '';
      }
    }

    function serializePushSubscription(sub) {
      if (!sub) return null;
      try {
        const json = typeof sub.toJSON === 'function' ? sub.toJSON() : null;
        if (json) return json;
      } catch {
        // ignore serialization errors
      }

      const payload = {
        endpoint: sub.endpoint,
        expirationTime: sub.expirationTime ?? null,
        keys: {}
      };

      if (typeof sub.getKey === 'function') {
        const auth = sub.getKey('auth');
        const p256dh = sub.getKey('p256dh');
        if (auth) payload.keys.auth = arrayBufferToBase64Url(auth);
        if (p256dh) payload.keys.p256dh = arrayBufferToBase64Url(p256dh);
      }

      if (!payload.keys.auth || !payload.keys.p256dh) {
        if (sub.keys && typeof sub.keys === 'object') {
          if (!payload.keys.auth && typeof sub.keys.auth === 'string') payload.keys.auth = sub.keys.auth;
          if (!payload.keys.p256dh && typeof sub.keys.p256dh === 'string') payload.keys.p256dh = sub.keys.p256dh;
        }
      }

      if (!payload.endpoint || !payload.keys.auth || !payload.keys.p256dh) return null;
      return payload;
    }

    function createConcurrencyLimiter(maxConcurrent = 3) {
      const limit = Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? Math.floor(maxConcurrent) : 1;
      let active = 0;
      const queue = [];

      const runNext = () => {
        if (active >= limit) return;
        const nextJob = queue.shift();
        if (!nextJob) return;

        const { fn, resolve, reject } = nextJob;
        active += 1;
        let finished = false;

        const finalize = () => {
          if (finished) return;
          finished = true;
          active -= 1;
          runNext();
        };

        let result;
        try {
          result = fn();
        } catch (err) {
          finalize();
          reject(err);
          return;
        }

        Promise.resolve(result).then(
          (value) => {
            finalize();
            resolve(value);
          },
          (err) => {
            finalize();
            reject(err);
          }
        );
      };

      return (fn) => new Promise((resolve, reject) => {
        if (typeof fn !== 'function') {
          reject(new TypeError('Limiter expects a function'));
          return;
        }
        queue.push({ fn, resolve, reject });
        runNext();
      });
    }

    let coordsPromise = null;
    let coordsFetchedAt = null;
    const COORDS_COOLDOWN_MS = 4 * 60 * 1000; // 4 minutes - prevents triangulation of item positions

    function getUserCoordsOnce() {
      if (coordsPromise) return coordsPromise;
      if (!('geolocation' in navigator)) return Promise.resolve(null);
      coordsPromise = new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            coordsFetchedAt = Date.now();
            resolve({ lat: p.coords.latitude, lon: p.coords.longitude });
          },
          () => {
            // Reset promise on failure so it can retry next time
            coordsPromise = null;
            coordsFetchedAt = null;
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        );
      });
      return coordsPromise;
    }

    // Clear cached coordinates so next call fetches fresh GPS position
    // Only clears if cooldown period (4 min) has passed to prevent triangulation
    function clearCoordsCache() {
      if (!coordsFetchedAt) {
        coordsPromise = null;
        return;
      }
      const elapsed = Date.now() - coordsFetchedAt;
      if (elapsed >= COORDS_COOLDOWN_MS) {
        coordsPromise = null;
        coordsFetchedAt = null;
      }
      // If cooldown hasn't passed, keep the cached coordinates
    }

    function useBodyScrollLock(active) {
      useEffect(() => {
        if (!active) return undefined;
        const { style } = document.body;
        const previousOverflow = style.overflow;
        const previousPaddingRight = style.paddingRight;
        const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
        style.overflow = 'hidden';
        if (scrollBarWidth > 0) {
          const computed = window.getComputedStyle(document.body);
          const currentPadding = parseFloat(computed.paddingRight || '0') || 0;
          style.paddingRight = `${currentPadding + scrollBarWidth}px`;
        }
        return () => {
          style.overflow = previousOverflow || '';
          style.paddingRight = previousPaddingRight || '';
        };
      }, [active]);
    }

    function normalizeListingsResponse(res, limit = 75) {
      let rows = [];
      if (Array.isArray(res)) rows = res;
      else if (res && typeof res === 'object') {
        if (Array.isArray(res.rows)) rows = res.rows;
        else if (Array.isArray(res.items)) rows = res.items;
        else if (Array.isArray(res.listings)) rows = res.listings;
        else if (Array.isArray(res.data)) rows = res.data;
      }
      let hasNext = false;
      let nextCursor = null;
      if (res && typeof res === 'object') {
        if (typeof res.has_more === 'boolean') hasNext = res.has_more;
        else if (typeof res.hasNext === 'boolean') hasNext = res.hasNext;
        else if (typeof res.next === 'boolean') hasNext = res.next;
        else if (Number.isFinite(res.total) && Number.isFinite(res.page)) {
          const shown = (res.page - 1) * limit + rows.length;
          hasNext = shown < res.total;
        } else {
          hasNext = rows.length === limit;
        }
        if (res.next_cursor != null) nextCursor = res.next_cursor;
        else if (res.cursor != null) nextCursor = res.cursor;
      } else {
        hasNext = rows.length === limit;
      }
      return { rows, hasNext, nextCursor };
    }

    const asArray = (x) => (
      Array.isArray(x)
        ? x
        : (x && typeof x === 'object' && (Array.isArray(x.rows) || Array.isArray(x.items) || Array.isArray(x.listings) || Array.isArray(x.data)))
          ? normalizeListingsResponse(x).rows
          : []
    );

    const pageSize = 35;

    function selectPrimaryListingImage(listing, fallback) {
      if (!listing) return fallback || null;
      if (listing.thumb_url) return listing.thumb_url;
      if (listing.image_data) return listing.image_data;
      if (Array.isArray(listing.images) && listing.images.length > 0) {
        const first = listing.images[0];
        return (typeof first === 'string' ? first : first?.url) || fallback;
      }
      return fallback || null;
    }

    return {
      H,
      isMobileDevice,
      seenKey,
      loadSeen,
      saveSeen,
      urlToDataUrl,
      base64UrlToUint8Array,
      arrayBufferToBase64Url,
      serializePushSubscription,
      createConcurrencyLimiter,
      getUserCoordsOnce,
      clearCoordsCache,
      useBodyScrollLock,
      normalizeListingsResponse,
      asArray,
      pageSize,
      selectPrimaryListingImage,
      createLRUCache,
      useVirtualGrid
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.helpers = window.ListItApp.helpers || {};
  window.ListItApp.helpers.createHelpers = createHelpers;
})();

(() => {
  function createHelpers({ React }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Helpers require React.');
    }

    const {
      useCallback,
      useEffect,
      useMemo,
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
    function getUserCoordsOnce() {
      if (coordsPromise) return coordsPromise;
      if (!('geolocation' in navigator)) return Promise.resolve(null);
      coordsPromise = new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        );
      });
      return coordsPromise;
    }

    function interleaveByColumns(arr, cols) {
      if (!Array.isArray(arr) || arr.length === 0 || !cols || cols <= 1) return arr || [];
      const out = [];
      for (let c = 0; c < cols; c++) {
        for (let i = c; i < arr.length; i += cols) out.push(arr[i]);
      }
      return out;
    }

    function useColumnCount(ref, fallbackCols = 3) {
      const [cols, setCols] = useState(fallbackCols);
      useEffect(() => {
        if (!ref.current) return;
        const el = ref.current;
        const read = () => {
          const cs = getComputedStyle(el);
          const n = parseInt(cs.columnCount, 10);
          setCols(Number.isFinite(n) && n > 0 ? n : fallbackCols);
        };
        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        window.addEventListener('resize', read);
        return () => {
          ro.disconnect();
          window.removeEventListener('resize', read);
        };
      }, [ref, fallbackCols]);
      return cols;
    }

    function useElementWidth(ref, active = true) {
      const [w, setW] = useState(0);
      useEffect(() => {
        if (!active) {
          setW(0);
          return undefined;
        }
        if (!ref || typeof ref !== 'object') return undefined;

        let el = ref.current || null;
        let frame = null;
        let ro = null;

        const readWidth = () => {
          if (!el) return;
          const next = el.clientWidth || 0;
          setW((prev) => (prev === next ? prev : next));
        };

        const cleanup = () => {
          if (ro) {
            ro.disconnect();
            ro = null;
          }
          if (el) {
            window.removeEventListener('resize', readWidth);
            el = null;
          }
        };

        const attach = () => {
          cleanup();
          el = ref.current || null;
          if (!el) {
            frame = window.requestAnimationFrame(attach);
            return;
          }

          readWidth();
          if (typeof ResizeObserver === 'function') {
            ro = new ResizeObserver(readWidth);
            ro.observe(el);
          }
          window.addEventListener('resize', readWidth);
        };

        attach();

        return () => {
          if (frame != null) window.cancelAnimationFrame(frame);
          cleanup();
        };
      }, [ref, active]);
      return w;
    }

    const readWindowScrollY = () => {
      if (typeof window === 'undefined') return 0;
      if (Number.isFinite(window.scrollY)) return window.scrollY;
      if (Number.isFinite(window.pageYOffset)) return window.pageYOffset;
      if (typeof document !== 'undefined') {
        const doc = document;
        const el = doc.scrollingElement || doc.documentElement || doc.body;
        if (el && Number.isFinite(el.scrollTop)) return el.scrollTop;
      }
      return 0;
    };

    function useWindowScrollY() {
      const [y, setY] = useState(readWindowScrollY());
      useEffect(() => {
        let ticking = false;
        const onScroll = () => {
          if (!ticking) {
            window.requestAnimationFrame(() => {
              setY(readWindowScrollY());
              ticking = false;
            });
            ticking = true;
          }
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
      }, []);
      return y;
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

    function pageTop(el) {
      const r = el.getBoundingClientRect();
      return r.top + (window.scrollY || 0);
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
        if (typeof res.hasNext === 'boolean') hasNext = res.hasNext;
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

    const pageSize = 75;

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

    function useVirtualMasonry({ containerRef, items, columnCount, columnGap = 12, estimateHeight = 260, overscanVH = 1.5, active = true }) {
      const scrollY = useWindowScrollY();
      const containerW = useElementWidth(containerRef, active);

      const [heightMap, setHeightMap] = useState(() => Object.create(null));
      const registerHeight = useCallback((id, h) => {
        if (!id || !Number.isFinite(h) || h <= 0) return;
        setHeightMap((m) => (m[id] === h ? m : { ...m, [id]: h }));
      }, []);

      const layout = useMemo(() => {
        const cols = Math.max(1, columnCount || 1);
        const gap = columnGap;
        const w = Math.max(1, containerW);
        const colW = (w - gap * (cols - 1)) / cols;

        const colHeights = new Array(cols).fill(0);
        const pos = new Array(items.length);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const h = heightMap[it.id] || estimateHeight;
          let targetCol = 0;
          for (let c = 1; c < cols; c++) if (colHeights[c] < colHeights[targetCol]) targetCol = c;
          const top = colHeights[targetCol];
          const left = (colW + gap) * targetCol;
          colHeights[targetCol] = top + h + gap;
          pos[i] = { top, left, width: colW, height: h };
        }
        const containerHeight = Math.max(...colHeights, 0);
        return { positions: pos, containerHeight, colWidth: colW, gap };
      }, [items, heightMap, containerW, columnCount, columnGap, estimateHeight]);

      const viewport = useMemo(() => {
        const el = containerRef.current;
        if (!el) return { top: 0, bottom: 0 };
        const cTop = pageTop(el);
        const over = (window.innerHeight || 0) * overscanVH;
        const top = (scrollY - cTop) - over;
        const bottom = (scrollY - cTop) + (window.innerHeight || 0) + over;
        return { top, bottom };
      }, [containerRef, scrollY, overscanVH, containerW]);

      const visible = useMemo(() => {
        const out = [];
        const { positions } = layout;
        if (!positions || positions.length === 0) return out;
        for (let i = 0; i < positions.length; i++) {
          const p = positions[i];
          if (!p) continue;
          const pBottom = p.top + p.height;
          if (pBottom >= viewport.top && p.top <= viewport.bottom) {
            out.push({ index: i, item: items[i], pos: p });
          }
        }
        return out;
      }, [items, layout, viewport]);

      return { ...layout, visible, registerHeight };
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
      interleaveByColumns,
      useColumnCount,
      useElementWidth,
      useWindowScrollY,
      useBodyScrollLock,
      pageTop,
      normalizeListingsResponse,
      asArray,
      pageSize,
      selectPrimaryListingImage,
      useVirtualMasonry
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.helpers = window.ListItApp.helpers || {};
  window.ListItApp.helpers.createHelpers = createHelpers;
})();

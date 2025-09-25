const ReactGlobal = typeof React !== 'undefined' ? React : null;
const ReactHooks = ReactGlobal ? {
  useState: ReactGlobal.useState.bind(ReactGlobal),
  useEffect: ReactGlobal.useEffect.bind(ReactGlobal),
  useMemo: ReactGlobal.useMemo.bind(ReactGlobal),
  useRef: ReactGlobal.useRef.bind(ReactGlobal),
  useCallback: ReactGlobal.useCallback.bind(ReactGlobal),
  createElement: ReactGlobal.createElement.bind(ReactGlobal)
} : {};

function requireHook(name) {
  const hook = ReactHooks[name];
  if (!hook) {
    throw new Error(`React ${name} is not available globally.`);
  }
  return hook;
}

export function requireReact() {
  if (!ReactGlobal) {
    throw new Error('React must be loaded globally before using shared app helpers.');
  }
  return ReactGlobal;
}

export function H(tag, props, ...children) {
  const createElement = requireHook('createElement');
  return createElement(tag, props || null, ...children);
}

export function isMobileDevice() {
  const navigatorInfo = typeof navigator !== 'undefined' ? navigator : null;
  const ua = (navigatorInfo?.userAgent || navigatorInfo?.vendor || '').toLowerCase();

  if (/(iphone|ipod|ipad|android|windows phone|iemobile|mobile)/.test(ua)) {
    return true;
  }

  if (/macintosh/.test(ua) && navigatorInfo?.maxTouchPoints && navigatorInfo.maxTouchPoints > 1) {
    return true;
  }

  return false;
}

export function seenKey(userId) {
  return `listit_seen_${userId || 'anon'}`;
}

export function loadSeen(userId) {
  try {
    const key = seenKey(userId);
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveSeen(userId, map) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(seenKey(userId), JSON.stringify(map || {}));
  } catch {}
}

export async function urlToDataUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response?.ok) throw new Error('Failed to fetch image for data URL conversion.');
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
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

export function base64UrlToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') return null;
  try {
    const padded = base64String + '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      output[i] = raw.charCodeAt(i);
    }
    return output;
  } catch (err) {
    console.warn('Failed to decode VAPID key:', err);
    return null;
  }
}

export function arrayBufferToBase64Url(buf) {
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

export function serializePushSubscription(sub) {
  if (!sub) return null;
  try {
    const json = typeof sub.toJSON === 'function' ? sub.toJSON() : null;
    if (json) return json;
  } catch {}

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
    const keys = sub.keys && typeof sub.keys === 'object' ? sub.keys : null;
    if (keys) {
      if (!payload.keys.auth && typeof keys.auth === 'string') payload.keys.auth = keys.auth;
      if (!payload.keys.p256dh && typeof keys.p256dh === 'string') payload.keys.p256dh = keys.p256dh;
    }
  }

  if (!payload.endpoint || !payload.keys.auth || !payload.keys.p256dh) return null;
  return payload;
}

let coordsPromise = null;
export function getUserCoordsOnce() {
  if (coordsPromise) return coordsPromise;
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  coordsPromise = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
  return coordsPromise;
}

export function interleaveByColumns(arr, cols) {
  if (!Array.isArray(arr) || arr.length === 0 || !cols || cols <= 1) return arr || [];
  const out = [];
  for (let c = 0; c < cols; c += 1) {
    for (let i = c; i < arr.length; i += cols) {
      out.push(arr[i]);
    }
  }
  return out;
}

export function useColumnCount(ref, fallbackCols = 3) {
  const useState = requireHook('useState');
  const useEffect = requireHook('useEffect');
  const [cols, setCols] = useState(fallbackCols);
  useEffect(() => {
    if (!ref?.current) return undefined;
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

export function useElementWidth(ref) {
  const useState = requireHook('useState');
  const useEffect = requireHook('useEffect');
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref?.current) return undefined;
    const el = ref.current;
    const update = () => setW(el.clientWidth || 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref]);
  return w;
}

export function useWindowScrollY() {
  const useState = requireHook('useState');
  const useEffect = requireHook('useEffect');
  const [y, setY] = useState(typeof window !== 'undefined' ? window.scrollY || 0 : 0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setY(window.scrollY || 0);
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

export function useBodyScrollLock(active) {
  const useEffect = requireHook('useEffect');
  useEffect(() => {
    if (!active) return undefined;
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
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

export function pageTop(el) {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return r.top + ((typeof window !== 'undefined' ? window.scrollY : 0) || 0);
}

export function normalizeListingsResponse(res, limit = 75) {
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

export function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    if (Array.isArray(x.rows) || Array.isArray(x.items) || Array.isArray(x.listings) || Array.isArray(x.data)) {
      return normalizeListingsResponse(x).rows;
    }
  }
  return [];
}

export function useVirtualMasonry({ containerRef, items, columnCount, columnGap = 12, estimateHeight = 260, overscanVH = 1.5 }) {
  const useMemo = requireHook('useMemo');
  const useState = requireHook('useState');
  const useCallback = requireHook('useCallback');
  const scrollY = useWindowScrollY();
  const containerW = useElementWidth(containerRef);

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
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const h = heightMap[it.id] || estimateHeight;
      let targetCol = 0;
      for (let c = 1; c < cols; c += 1) if (colHeights[c] < colHeights[targetCol]) targetCol = c;
      const top = colHeights[targetCol];
      const left = (colW + gap) * targetCol;
      colHeights[targetCol] = top + h + gap;
      pos[i] = { top, left, width: colW, height: h };
    }
    const containerHeight = Math.max(...colHeights, 0);
    return { positions: pos, containerHeight, colWidth: colW, gap };
  }, [items, heightMap, containerW, columnCount, columnGap, estimateHeight]);

  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight || 0 : 0;
  const overscan = Math.max(0, viewportHeight * overscanVH);
  const startY = Math.max(0, scrollY - overscan);
  const endY = scrollY + viewportHeight + overscan;

  const visible = [];
  layout.positions.forEach((pos, idx) => {
    if (!pos) return;
    if (pos.top + pos.height < startY) return;
    if (pos.top > endY) return;
    visible.push({ item: items[idx], layout: pos });
  });

  return {
    registerHeight,
    layout,
    visible
  };
}

// public/app.js
//
// S3-first uploads (presign -> PUT -> finalize) + AI helper via local dataURLs
// Messages: paste/drag/attach images -> S3 URLs (kept!)
// Conversations list: red "x" delete button (kept!)
// CHANGE: All listing fields optional EXCEPT at least one image.
//         If price field empty/invalid, default to $0.00 and render the price in green.
// NEW: MassList -- pick multiple photos -> AI per image -> create multiple listings with uploads.
// NEW: Auto-list setting (Profile): when ON, attaching photos in the New listing form
//      will AI-analyze and immediately create the listing + upload photos automatically.
//      Includes "?" help modal with high-contrast text.
// NEW: Auto-list sub-toggle: "Also post to Nearby." When Auto-list is ON and this is enabled,
//      auto-created (and MassListed) items are created with enable_nearby=1 and lat/lon set.
//
// NEW (this file):
// - Thin-fetch + pagination for the Listings tab (75 per page, default sort=Newest)
//   * /api/listings uses ?noimg=1 (metadata only) with ?page=1&limit=75
//   * Batch prewarm first covers via /api/listings/covers
//   * Client guards against array OR {rows, hasNext, total, page} responses.

(() => {
  const { useCallback, useEffect, useMemo, useRef, useState } = React;

  // Device detection
  // Strict mobile check (keeps Nearby off PCs but ON for phones/tablets)
  // - Matches iPhone/Android/Windows Phone
  // - Also handles iPadOS 13+ which reports a desktop (Mac) UA but has touch
  function isMobileDevice() {
    const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase();

    if (/(iphone|ipod|ipad|android|windows phone|iemobile|mobile)/.test(ua)) {
      return true;
    }

    // iPadOS desktop UA workaround
    if (/macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
      return true;
    }

    return false;
  }

  // small bridge so api can redirect UI on 401s + track global loading
  const AppNav = { setUser: () => {}, setTab: () => {}, incLoad: () => {}, decLoad: () => {}, notifyLocked: () => {} };

  // --- Helpers ---
  function H(tag, props, ...children) { return React.createElement(tag, props || null, ...children); }
  function price(n) { return Number(n ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' }); }
  function seenKey(userId){ return `listit_seen_${userId||'anon'}`; }
  function loadSeen(userId){ try{ return JSON.parse(localStorage.getItem(seenKey(userId))||'{}'); }catch{ return {}; } }
  function saveSeen(userId, map){ try{ localStorage.setItem(seenKey(userId), JSON.stringify(map||{})); }catch{} }
  function fmtDistance(m){
    if (!Number.isFinite(m)) return '';
    if (m < 1609.344 * 0.3) {
      const ft = m * 3.28084;
      if (ft < 1000) return `${Math.round(ft)} ft`;
      return `${Math.round(ft/100)/10}k ft`;
    }
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  const _toRad = d => d * Math.PI / 180;
  function haversineMeters(aLat, aLon, bLat, bLon) {
    const R = 6371000;
    const dLat = _toRad(bLat - aLat);
    const dLon = _toRad(bLon - aLon);
    const s1 = Math.sin(dLat/2), s2 = Math.sin(dLon/2);
    return 2 * R * Math.asin(Math.sqrt(s1*s1 + Math.cos(_toRad(aLat))*Math.cos(_toRad(bLat)) * s2*s2));
  }
  
  // NEW: Convert S3 URL to data URL for AI analysis
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
  
  let _coordsPromise = null;
  function getUserCoordsOnce() {
    if (_coordsPromise) return _coordsPromise;
    if (!('geolocation' in navigator)) return Promise.resolve(null);
    _coordsPromise = new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude } ),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
    return _coordsPromise;
  }

  // Arrange items so rows read left->right in a CSS multi-column layout
  function interleaveByColumns(arr, cols) {
    if (!Array.isArray(arr) || arr.length === 0 || !cols || cols <= 1) return arr || [];
    const out = [];
    for (let c = 0; c < cols; c++) {
      for (let i = c; i < arr.length; i += cols) out.push(arr[i]);
    }
    return out;
  }

  // Read actual column-count from the masonry container (responds to CSS + inline styles)
  function useColumnCount(ref, fallbackCols = 3) {
    const [cols, setCols] = React.useState(fallbackCols);
    React.useEffect(() => {
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
      return () => { ro.disconnect(); window.removeEventListener('resize', read); };
    }, [ref, fallbackCols]);
    return cols;
  }

  // --- NEW: tiny helpers for virtualization (kept; used by Nearby) ---
  function useElementWidth(ref) {
    const [w, setW] = useState(0);
    useEffect(() => {
      if (!ref.current) return;
      const el = ref.current;
      const update = () => setW(el.clientWidth || 0);
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      window.addEventListener('resize', update);
      return () => { ro.disconnect(); window.removeEventListener('resize', update); };
    }, [ref]);
    return w;
  }

  function useWindowScrollY() {
    const [y, setY] = useState(window.scrollY || 0);
    useEffect(() => {
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

  // Compute absolute pageY of an element
  function pageTop(el) {
    const r = el.getBoundingClientRect();
    return r.top + (window.scrollY || 0);
  }

  // --- NEW: robust response guards for listings / pagination ---
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
  const asArray = (x) =>
    Array.isArray(x) ? x
    : (x && typeof x === 'object' && (Array.isArray(x.rows) || Array.isArray(x.items) || Array.isArray(x.listings) || Array.isArray(x.data)))
      ? normalizeListingsResponse(x).rows
      : [];

  // --- NEW: zero-dependency virtualized masonry (kept; used by Nearby) ---
  function useVirtualMasonry({ containerRef, items, columnCount, columnGap = 12, estimateHeight = 260, overscanVH = 1.5 }) {
    const scrollY = useWindowScrollY();
    const containerW = useElementWidth(containerRef);

    const [heightMap, setHeightMap] = useState(() => Object.create(null)); // id->height
    const registerHeight = React.useCallback((id, h) => {
      if (!id || !Number.isFinite(h) || h <= 0) return;
      setHeightMap(m => (m[id] === h ? m : { ...m, [id]: h }));
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
        // pick shortest column
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
    }, [containerRef, scrollY, overscanVH]);

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

  // --- Helper: fetch coords and reverse-geocode into a display string
  async function fetchCoordsAndReverse() {
    if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
    const { coords } = await new Promise((res, rej)=>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true, timeout:8000, maximumAge:60000 })
    );
    const r = await api.reverseGeocode(coords.latitude, coords.longitude);
    return {
      lat: r?.lat ?? coords.latitude,
      lon: r?.lon ?? coords.longitude,
      display: r?.display || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
    };
  }

  // --- Global Loader ---
  function GlobalLoader({ active }) {
    if (!active) return null;
    return H('div', { className: 'global-loader' },
      H('div', { className: 'spinner' }),
      H('div', { className: 'loader-text' }, 'Loading...')
    );
  }

  function AdTile({ ad, cols = 4, className, preview = false }) {
    if (!ad) return null;
    const spanCols = Math.max(1, Math.min(3, Number(cols) || 1));
    const hasImage = !!ad.image_url;
    const href = ad.target_url || '#';
    const ctaLabel = (ad.cta_label || 'Visit site').slice(0, 40);
    const style = { gridColumn: `span ${spanCols}` };
    if (ad.background) style.background = ad.background;
    if (preview) style.cursor = 'default';
    const cardClass = `card ad-card${hasImage ? '' : ' no-art'}${className ? ` ${className}` : ''}`;
    const anchorProps = {
      className: cardClass,
      href,
      target: '_blank',
      rel: 'noopener noreferrer',
      style
    };
    if (preview) {
      anchorProps.onClick = (e) => e.preventDefault();
      anchorProps.target = '_self';
      anchorProps.rel = 'noopener';
      anchorProps.tabIndex = -1;
    }
    return H('a', anchorProps,
      H('div', { className: 'ad-card__content' },
        H('span', { className: 'ad-card__tag' }, 'Sponsored'),
        H('div', { className: 'ad-card__title' }, ad.title || 'Advertisement'),
        ad.subtitle && H('div', { className: 'ad-card__subtitle' }, ad.subtitle),
        H('div', { className: 'ad-card__ctaRow' },
          H('span', { className: 'ad-card__cta' }, ctaLabel),
          H('span', { className: 'ad-card__arrow' }, '>')
        )
      ),
      hasImage && H('div', { className: 'ad-card__art' },
        H('img', {
          src: ad.image_url,
          alt: ad.title ? `${ad.title} artwork` : 'Advertisement art',
          loading: 'lazy',
          decoding: 'async'
        })
      )
    );
  }

  // --- API ---
const api = {
  async _fetch(url, opts = {}, meta = {}) {
    const silent = !!meta.silent;
    if (!silent) AppNav.incLoad();
    try {
      const res = await fetch(url, { credentials: 'include', ...opts });
      if (res.status === 401) {
        AppNav.setUser(null);
        AppNav.setTab('browse');
        throw new Error('auth');
      }
      if (res.status === 423) {
        try { await res.json(); } catch {}
        AppNav.notifyLocked();
        throw new Error('account_locked');
      }
      if (!res.ok) {
        let payload = null;
        try { payload = await res.json(); } catch {}
        const msg = (payload?.error) || 'request_failed';
        if (msg === 'account_locked') AppNav.notifyLocked();
        throw new Error(msg);
      }
      try { return await res.json(); } catch { return null; }
    } finally {
      if (!silent) AppNav.decLoad();
    }
  },

  me(meta) { return this._fetch('/api/me', { method:'GET' }, meta); },
  
  // In your api object, update login and register methods:
login(email, password, meta) {
  return this._fetch('/api/login', { 
    method:'POST', 
    headers:{'Content-Type':'application/json'}, 
    body:JSON.stringify({ email, password }) 
  }, meta);
},

register(payload, meta) { 
  return this._fetch('/api/register', { 
    method:'POST', 
    headers:{'Content-Type':'application/json'}, 
    body:JSON.stringify(payload) 
  }, meta);
},
  
  async logout(meta) {
    try { 
      await this._fetch('/api/logout', { method:'POST' }, meta); 
    } catch {}
  },

    updatePaypalEmail(paypal_email, meta) {
      return this._fetch('/api/me/paypal', {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ paypal_email })
      }, meta);
    },

    // NEW: listAll supports legacy (q, loc) or params object { q, loc, page, limit, sort }
    listAll(a, b, meta) {
      let q, loc, page, limit, sort, cursor;
      if (typeof a === 'object' && a !== null) {
        q = a.q || '';
        loc = a.loc || '';
        page = a.page || 1;
        limit = a.limit || 75;
        sort = a.sort || 'new';
        cursor = a.cursor || null;
        meta = b || {};
      } else {
        q = a || '';
        loc = b || '';
        page = 1;
        limit = 75;
        sort = 'new';
      }
      const params = new URLSearchParams();
      if (q)   params.set('q', q);
      if (loc) params.set('loc', loc);
      params.set('noimg', '1'); // thin-fetch
      if (cursor != null) params.set('cursor', String(cursor));
      else params.set('page', String(page));
      params.set('limit', String(limit));
      params.set('sort', sort);
      const url = '/api/listings' + (params.toString() ? `?${params.toString()}` : '');
      return this._fetch(url, { method: 'GET' }, meta);
    },

        // NEW: Get listings by a specific user
    listByUser(userId, meta) {
      return this._fetch(`/api/users/${userId}/listings`, { method:'GET' }, meta);
    },

    listMine(meta)      { return this._fetch('/api/listings?mine=1', { method:'GET' }, meta); },
    createListing(payload, meta) {
      return this._fetch('/api/listings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }, meta);
    },
    updateListing(id, payload, meta) {
      return this._fetch(`/api/listings/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }, meta);
    },
    markListingSold(id, sold, meta) {
      return this.updateListing(id, { sold: !!sold }, meta);
    },
    deleteListing(id, meta) { return this._fetch(`/api/listings/${id}`, { method:'DELETE' }, meta); },

    adminDeleteListing(id, meta) { return this._fetch(`/api/admin/listings/${id}`, { method:'DELETE' }, meta); },
    adminDeleteAll(meta)       { return this._fetch('/api/admin/listings', { method:'DELETE' }, meta); },

    listAds(meta) { return this._fetch('/api/ads', { method:'GET' }, meta); },
    adminListAds(meta) { return this._fetch('/api/admin/ads', { method:'GET' }, meta); },
    adminCreateAd(payload, meta) {
      return this._fetch('/api/admin/ads', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      }, meta);
    },
    adminUpdateAd(id, payload, meta) {
      return this._fetch(`/api/admin/ads/${id}`, {
        method:'PUT',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      }, meta);
    },
    adminDeleteAd(id, meta) {
      return this._fetch(`/api/admin/ads/${id}`, { method:'DELETE' }, meta);
    },

    searchCities(q, meta) {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const url = '/api/cities' + (params.toString() ? `?${params.toString()}` : '');
      return this._fetch(url, { method:'GET' }, { ...(meta || {}), silent: true });
    },

    ensureConversation({ with_user_id, listing_id }, meta) {
      return this._fetch('/api/conversations', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ with_user_id, listing_id }) }, meta);
    },
    listConversations(meta) { return this._fetch('/api/conversations', { method:'GET' }, meta); },
    getMessages(id, meta)     { return this._fetch(`/api/conversations/${id}/messages`, { method:'GET' }, meta); },
    sendMessage(id, body, images, meta){
      return this._fetch(`/api/conversations/${id}/messages`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ body, images })
      }, meta);
    },
    // delete a conversation
    deleteConversation(id, meta) {
      return this._fetch(`/api/conversations/${id}`, { method:'DELETE' }, meta);
    },

    getListingImages(id, meta){ return this._fetch(`/api/listings/${id}/images`, { method:'GET' }, meta); },

    // NEW: batch cover prewarm
    getCoversBatch(ids = [], meta) {
      const idsStr = Array.from(new Set(ids.filter(Number.isFinite))).slice(0, 200).join(',');
      if (!idsStr) return Promise.resolve([]);
      return this._fetch(`/api/listings/covers?ids=${encodeURIComponent(idsStr)}`, { method:'GET' }, meta);
    },

    aiAnalyze({ images, hint }, meta) {
      return this._fetch('/api/ai/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ images, hint }) }, meta);
    },

    reverseGeocode(lat, lon, meta) {
      return this._fetch(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { method: 'GET' }, meta);
    },

    // Nearby
    listNearby(lat, lon, radius_m = 150, meta) {
      const url = `/api/listings/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius_m=${encodeURIComponent(radius_m)}`;
      return this._fetch(url, { method:'GET' }, meta);
    },

    reportSeller(payload, meta) {
      return this._fetch('/api/reports', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload || {})
      }, meta);
    },

    adminSearchUsers(params = {}, meta) {
      const q = params.q ?? params.query ?? '';
      const limit = params.limit;
      const searchParams = new URLSearchParams();
      if (q) searchParams.set('q', q);
      if (limit) searchParams.set('limit', String(limit));
      const url = '/api/admin/users/search' + (searchParams.toString() ? `?${searchParams.toString()}` : '');
      return this._fetch(url, { method:'GET' }, meta);
    },

    adminGetUser(id, meta) {
      if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
      return this._fetch(`/api/admin/users/${id}`, { method:'GET' }, meta);
    },

    adminGetUserReports(id, params = {}, meta) {
      if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
      const searchParams = new URLSearchParams();
      if (params.limit) searchParams.set('limit', String(params.limit));
      const url = `/api/admin/users/${id}/reports` + (searchParams.toString() ? `?${searchParams.toString()}` : '');
      return this._fetch(url, { method:'GET' }, meta);
    },

    adminUpdateUserStatus(id, payload = {}, meta) {
      if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
      return this._fetch(`/api/admin/users/${id}/status`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload || {})
      }, meta);
    },

    adminTopReports(params = {}, meta) {
      const searchParams = new URLSearchParams();
      if (Number.isFinite(Number(params.limit))) searchParams.set('limit', String(params.limit));
      if (Number.isFinite(Number(params.days))) searchParams.set('days', String(params.days));
      if (Number.isFinite(Number(params.min))) searchParams.set('min', String(params.min));
      const url = '/api/admin/reports/top' + (searchParams.toString() ? `?${searchParams.toString()}` : '');
      return this._fetch(url, { method:'GET' }, meta);
    },

    adminClearUserReports(id, payload = {}, meta) {
      if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
      return this._fetch(`/api/admin/users/${id}/reports/clear`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload || {})
      }, meta);
    },

    // --- S3 upload helpers ---
    signUpload({ filename, contentType, bytes }, meta) {
      return this._fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ filename, contentType, bytes })
      }, meta);
    },
    finalizeUpload({ listingId, key, url, width, height, bytes }, meta) {
      const payload = {};
      if (listingId != null) payload.listingId = listingId;
      if (key != null) payload.key = key;
      if (url != null) payload.url = url;
      if (width != null) payload.width = width;
      if (height != null) payload.height = height;
      if (bytes != null) payload.bytes = bytes;
      return this._fetch('/api/uploads/finalize', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      }, meta);
    }
  };

  function createConcurrencyLimiter(maxConcurrent = 3) {
    let active = 0;
    const queue = [];

    const next = () => {
      if (active >= maxConcurrent || queue.length === 0) return;
      const { fn, resolve, reject } = queue.shift();
      active += 1;

      let finished = false;
      const finalize = () => {
        if (!finished) {
          finished = true;
          active -= 1;
          next();
        }
      };

      try {
        Promise.resolve(fn()).then(
          (value) => {
            finalize();
            resolve(value);
          },
          (err) => {
            finalize();
            reject(err);
          }
        );
      } catch (err) {
        finalize();
        reject(err);
      }
    };

    return function schedule(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    };
  }

  const uploadDraftCache = new WeakMap();
  const s3UploadLimiter = createConcurrencyLimiter(3);
  const listingImageCache = new Map();
  const listingImageInFlight = new Map();

  function dedupeImageUrls(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of input) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  async function measureImageFile(file) {
    if (!(file instanceof File)) {
      return { width: null, height: null };
    }
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const dims = { width: img.naturalWidth || null, height: img.naturalHeight || null };
        URL.revokeObjectURL(objectUrl);
        resolve(dims);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: null, height: null });
      };
      img.src = objectUrl;
    });
  }

  function clearDraftCacheForFile(file) {
    if (uploadDraftCache.has(file)) uploadDraftCache.delete(file);
  }

  async function uploadFileDraft(file) {
    if (!file) throw new Error('file_required');

    if (!uploadDraftCache.has(file)) {
      const uploadPromise = s3UploadLimiter(async () => {
        const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
        if (sig?.error) throw new Error(sig.error);
        if (!sig?.uploadUrl || !sig?.publicUrl || !sig?.Key) throw new Error('invalid_presign');

        const putRes = await fetch(sig.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        if (!putRes.ok) throw new Error('s3_put_failed');

        const dims = await measureImageFile(file);

        const finalizeRes = await api.finalizeUpload({
          key: sig.Key,
          url: sig.publicUrl,
          width: dims.width,
          height: dims.height,
          bytes: file.size
        }, { silent: true });

        if (finalizeRes?.error) throw new Error(finalizeRes.error);
        if (!finalizeRes?.uploadToken) throw new Error('missing_upload_token');

        return {
          uploadToken: finalizeRes.uploadToken,
          publicUrl: finalizeRes.url || sig.publicUrl,
          width: finalizeRes.width ?? dims.width ?? null,
          height: finalizeRes.height ?? dims.height ?? null,
          bytes: finalizeRes.bytes ?? file.size
        };
      }).catch((err) => {
        clearDraftCacheForFile(file);
        throw err;
      });

      uploadDraftCache.set(file, uploadPromise);
    }

    return uploadDraftCache.get(file);
  }

  async function fetchListingImagesCached(listingId) {
    if (!Number.isFinite(Number(listingId))) return [];
    if (listingImageInFlight.has(listingId)) {
      return listingImageInFlight.get(listingId);
    }
    if (listingImageCache.has(listingId)) {
      return listingImageCache.get(listingId);
    }
    const promise = (async () => {
      try {
        const arr = await api.getListingImages(listingId);
        const safe = Array.isArray(arr) ? arr.filter(Boolean) : [];
        const deduped = dedupeImageUrls(safe);
        if (deduped.length) {
          listingImageCache.set(listingId, deduped);
        } else {
          listingImageCache.delete(listingId);
        }
        return deduped;
      } catch {
        listingImageCache.delete(listingId);
        return [];
      } finally {
        listingImageInFlight.delete(listingId);
      }
    })();
    listingImageInFlight.set(listingId, promise);
    return promise;
  }

  // Upload a single file to S3 then finalize in DB (for listings)
  async function uploadOneImage(listingId, file) {
    const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
    if (sig?.error) throw new Error(sig.error);
    const putRes = await fetch(sig.uploadUrl, { method:'PUT', body:file, headers:{ 'Content-Type': file.type } });
    if (!putRes.ok) throw new Error('s3_put_failed');

    const dims = await measureImageFile(file);

    await api.finalizeUpload({
      listingId,
      key: sig.Key,
      url: sig.publicUrl,
      width: dims.width,
      height: dims.height,
      bytes: file.size
    });

    return sig.publicUrl;
  }

  async function uploadFilesForListing(listingId, files = []) {
    const out = [];
    for (const f of files) {
      const url = await uploadOneImage(listingId, f);
      out.push(url);
    }
    return out;
  }

  // Upload a single file to S3 (for messages; no finalize, just return public URL)
  async function uploadOneMessageImage(file) {
    const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
    if (sig.error) throw new Error(sig.error);

    const putRes = await fetch(sig.uploadUrl, { method:'PUT', body:file, headers:{ 'Content-Type': file.type } });
    if (!putRes.ok) throw new Error('s3_put_failed');

    return sig.publicUrl;
  }

  // --- Attach icon button (Messages) ---
  function AttachButton({ onClick, title = 'Attach images' }) {
    return H('button', {
      className: 'icon-btn',
      type: 'button',
      onClick,
      title,
      'aria-label': title,
      'data-testid': 'dm-attach',
      style: {
        width: 40, height: 40, borderRadius: 12,
        border: '1px solid #e5e7eb',
        background: '#fff',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer'
      }
    },
      H('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
        H('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2, stroke: '#9ca3af', 'stroke-width': 2 }),
        H('circle', { cx: 9, cy: 10, r: 2, fill: '#9ca3af' }),
        H('path', { d: 'M7 18l4-4 3 3 4-5 3 4', stroke: '#9ca3af', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
      )
    );
  }

  // --- City Autocomplete (unchanged) ---
  function CityAutocomplete({ value, onChange, options, onUseMyLocation }) {
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState(0);
    const boxRef = useRef(null);

    const list = useMemo(() => {
      const v = (value || '').trim().toLowerCase();
      const opts = Array.isArray(options) ? options : [];
      if (!v) return opts.slice(0, 8);
      return opts.filter(c => c.toLowerCase().includes(v)).slice(0, 8);
    }, [value, options]);

    function pick(s) {
      onChange(s);
      setOpen(false);
      setHover(0);
      setTimeout(() => boxRef.current && boxRef.current.querySelector('input')?.focus(), 0);
    }

    function onKeyDown(e) {
      if (!open && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
        setOpen(true);
        return;
      }
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h + 1, list.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHover(h => Math.max(h - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (list[hover]) pick(list[hover]); }
      else if (e.key === 'Escape') { setOpen(false); }
    }

    function onFocus() { if (list.length) setOpen(true); }
    function onBlur() { setTimeout(() => setOpen(false), 100); }

    return H('div', { ref: boxRef, style: { position:'relative', display:'flex', gap:8 } },
      H('input', {
        placeholder:'City...',
        value: value,
        onChange: e => { onChange(e.target.value); setOpen(true); },
        onKeyDown, onFocus, onBlur,
        style:{ maxWidth:220 }
      }),
      H('button', { type:'button', className:'btn', onClick:onUseMyLocation }, 'Use my location'),
      open && list.length > 0 && H('div', {
        style: {
          position:'absolute', top:'100%', left:0, right:0, zIndex: 50,
          background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, marginTop:6,
          boxShadow:'0 6px 20px rgba(0,0,0,0.08)', overflow:'hidden'
        }
      },
        ...list.map((s, i) => H('div', {
          key:s,
          onMouseEnter:()=>setHover(i),
          onMouseDown:(e)=>{ e.preventDefault(); pick(s); },
          style:{
            padding:'10px 12px',
            background: i===hover ? '#f3f4f6' : 'transparent',
            cursor:'pointer'
          }
        }, s))
      )
    );
  }

  // --- Header (profile tab shows @username) ---
  // --- Header (simplified for modal auth) ---
function Header({ user, setUser, onNav, active, unreadCount, onAdminDeleteAll, isMobile, onAuthClick, hasAdminUnread }) {
  // If user not logged in, show Register/Login buttons
  if (!user) {
    return H('header', null,
      H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
        H('div', { className: 'row', style: { gap: 18, alignItems: 'center' } },
          H('div', { className: 'brand-badge' },
            H('div', { className: 'brand-ring' }),
            H('div', { className: 'brand-initials' }, 'CL')
          ),
          H('div', { className: 'brand-copy' },
            H('div', { className: 'brand-title' }, 'Creegslist'),
            H('div', { className: 'brand-tagline' }, 'Sell on the spot')
          )
        ),
        H('div', { className: 'row', style: { gap: 8 } },
          H('button', { className: 'btn', onClick: () => onAuthClick('register') }, 'Register'),
          H('button', { className: 'btn primary', onClick: () => onAuthClick('login') }, 'Log In')
        )
      )
    );
  }

  // Original header for logged in users
  const profileLabel = user ? (user.username ? `@${user.username}` : user.email) : 'Profile';

  const authArea = user
    ? H('div', { className: 'row', style: { gap: 8 } },
        !!user.is_admin && H('button', {
          className: 'btn danger',
          onClick: async () => {
            if (confirm('Delete ALL listings? This cannot be undone.')) {
              await onAdminDeleteAll?.();
            }
          }
        }, 'Admin: Delete ALL')
      )
    : null;

  const unreadDotColor = hasAdminUnread ? '#111' : '#ef4444';

  const messagesBtn = H('button', {
    className: `btn ${active==='messages'?'primary':''}`,
    style: { position: 'relative' },
    onClick: () => {
      if (!user) { alert('Log in to view messages.'); return; }
      onNav('messages');
    }
  }, 'Messages',
    (unreadCount > 0) &&
      H('span', { style: { position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 10, background: unreadDotColor } })
  );

  return H('header', null,
    H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
        H('div', { className: 'row', style: { gap: 18, alignItems: 'center' } },
          H('div', { className: 'brand-badge' },
            H('div', { className: 'brand-ring' }),
            H('div', { className: 'brand-initials' }, 'CL')
          ),
          H('div', { className: 'brand-copy' },
            H('div', { className: 'brand-title' }, 'Creegslist'),
            H('div', { className: 'brand-tagline' }, 'Sell on the spot')
          )
        ),
      H('nav', { className: 'row' },
        H('button', { className: `btn ${active==='browse'?'primary':''}`, onClick: () => onNav('browse') }, 'Listings'),
        isMobile && H('button', { className: `btn ${active==='nearby'?'primary':''}`, onClick: () => onNav('nearby') }, 'Nearby'),
        messagesBtn,
        H('button', { className: `btn ${active==='profile'?'primary':''}`, onClick: () => onNav('profile'), title: 'Profile & settings' }, profileLabel),
        user?.is_admin && H('button', { className: `btn ${active==='admin'?'primary':''}`, onClick: () => onNav('admin') }, 'Admin')
      ),
      authArea
    )
  );
}

  // --- Auth Modal Component (NEW) ---
function AuthModal({ isOpen, onClose, initialMode = 'login', onSuccess }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError('');
      setUsername('');
      setEmail('');
      setPassword('');
    }
  }, [isOpen, initialMode]);
  
  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      let user;
      if (mode === 'login') {
        user = await api.login(email, password);
      } else {
        user = await api.register({ username, email, password });
      }
      onSuccess(user);
      onClose();
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }
  
  if (!isOpen) return null;
  
  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      let user;
      if (mode === 'login') {
        user = await api.login(email, password);
      } else {
        user = await api.register({ username, email, password });
      }
      onSuccess(user);
      onClose();
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }
  
  if (!isOpen) return null;
  
  return ReactDOM.createPortal(
    H('div', { 
      className: 'modal open',
      onClick: (e) => { if (e.target.classList.contains('modal')) onClose(); }
    },
      H('div', { className: 'modal-inner', style: { maxWidth: '420px', padding: '32px', background: '#fff', color: '#111' } },
        H('button', { className: 'close', onClick: onClose }, 'x'),
        H('h2', { style: { margin: '0 0 24px', fontSize: '28px', color: '#111' } }, 
          mode === 'login' ? 'Welcome Back' : 'Create Account'),
        
        H('form', { onSubmit: handleSubmit },
          mode === 'register' && H('div', { style: { marginBottom: '16px' } },
            H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Username'),
            H('input', {
              type: 'text',
              value: username,
              onChange: e => setUsername(e.target.value),
              placeholder: 'johndoe',
              required: true,
              disabled: loading
            })
          ),
          
          H('div', { style: { marginBottom: '16px' } },
            H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600', color:'#111' } }, 'Email'),
            H('input', {
              type: 'email',
              value: email,
              onChange: e => setEmail(e.target.value),
              placeholder: 'john@example.com',
              required: true,
              disabled: loading
            })
          ),
          
          H('div', { style: { marginBottom: '16px' } },
            H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Password'),
            H('input', {
              type: 'password',
              value: password,
              onChange: e => setPassword(e.target.value),
              placeholder: '--------',
              required: true,
              disabled: loading
            })
          ),
          
          error && H('div', { style: { color: '#be123c', margin: '12px 0' } }, error),
          
          H('button', {
            type: 'submit',
            className: 'btn primary',
            style: { width: '100%', marginTop: '16px' },
            disabled: loading
          }, loading ? 'Loading...' : (mode === 'login' ? 'Log In' : 'Create Account')),
          
          H('div', { style: { textAlign: 'center', marginTop: '20px', color: '#6b7280' } },
            mode === 'login' 
              ? H(React.Fragment, null,
                  "Don't have an account? ",
                  H('button', {
                    type: 'button',
                    onClick: () => setMode('register'),
                    style: { color: '#111', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontWeight: '600' }
                  }, 'Register')
                )
              : H(React.Fragment, null,
                  "Already have an account? ",
                  H('button', {
                    type: 'button',
                    onClick: () => setMode('login'),
                    style: { color: '#111', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontWeight: '600' }
                  }, 'Log In')
                )
          )
        )
      )
    ),
    document.body
  );
}


  // --- MultiFilePicker (for S3 uploads) ---
  function MultiFilePicker({ files, onChange }) {
    const ref = useRef();
    const MAX_MB = 20;
    const previews = useFilePreviews(files);

    function pick(e) {
      const selected = Array.from(e.target.files || []);
      const next = [...files];
      for (const f of selected) {
        if (f.size > MAX_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_MB}MB`); continue; }
        if (!f.type.startsWith('image/')) { alert('Only images are allowed'); continue; }
        next.push(f);
      }
      onChange(next);
      if (ref.current) ref.current.value = '';
    }
    function removeAt(i) {
      const next = [...files];
      const [removed] = next.splice(i,1);
      if (removed) clearDraftCacheForFile(removed);
      onChange(next);
    }

    return H('div', null,
      H('div', { className:'row' },
      H('input', { type:'file', accept:'image/*', multiple:true, ref, onChange: pick }),
      H('span', { className:'muted' }, `${(files||[]).length} file(s)`)
    ),
    H('div', { className:'row', style:{ flexWrap:'wrap', gap:8, marginTop:8 } },
      ...previews.map(({ url }, i)=> H('div', { key:i, style:{ position:'relative' } },
        H('img', {
          src: url,
          style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #ddd' }
        }),
        H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, onClick:()=>removeAt(i) }, 'x')
      ))
    )
    );
  }

  // Helper: convert File[] to dataURLs for AI analysis only
  const AI_IMAGE_LIMIT = 8;

  async function filesToDataUrls(files = []) {
    async function toB64(file) {
      return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    }
    const out = [];
    for (const f of files.slice(0, AI_IMAGE_LIMIT)) out.push(await toB64(f));
    return out;
  }
  async function fileToDataUrl(file) {
    const arr = await filesToDataUrls([file]);
    return arr && arr[0];
  }

  function useFilePreviews(files = []) {
    const [previews, setPreviews] = useState([]);

    useEffect(() => {
      if (!files || files.length === 0) {
        setPreviews([]);
        return;
      }

      const entries = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
      setPreviews(entries);

      return () => {
        for (const entry of entries) {
          try { URL.revokeObjectURL(entry.url); } catch (_) {}
        }
      };
    }, [files]);

    return previews;
  }

  // --- Auto-list help modal (clean single-column layout) ---
  function AutoListHelpModal({ onClose }) {
    return ReactDOM.createPortal(
      H('div', {
        className: 'modal open',
        onClick: (e) => { if (e.target.classList.contains('modal')) onClose(); },
        style: { background: 'rgba(0,0,0,0.5)' }  // darker overlay
      },
        H('div', {
          // force single column and good contrast regardless of global CSS
          className: 'modal-inner',
          style: {
            display: 'block',
            width: 'min(520px, 92vw)',
            background: '#111',
            color: '#fff',
            borderRadius: 16,
            padding: 16,
            boxShadow: '0 16px 48px rgba(0,0,0,.45)',
            lineHeight: 1.55
          }
        },
          // header row with title + close
          H('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8
            }
          },
            H('div', { style: { fontWeight: 800, fontSize: 16 } }, 'About Auto-list'),
            H('button', {
              type: 'button',
              onClick: onClose,
              'aria-label': 'Close',
              // avoid relying on .close class so we don't inherit odd positioning
              style: {
                width: 28, height: 28, borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff', cursor: 'pointer',
                display: 'grid', placeItems: 'center',
                fontSize: 16, lineHeight: '26px'
              }
            }, 'x')
          ),

          // intro
          H('p', { style: { margin: '6px 0 10px', opacity: 0.9 } },
            'When enabled, Auto-List will:'
          ),

          // bullets
          H('ul', {
            style: {
              paddingLeft: 18,
              margin: '0 0 12px',
              listStyle: 'disc'
            }
          },
            H('li', null, 'Allow AI to suggest title, tags and price .'),
            H('li', null, 'Immediately create the listing for you.'),
            H('li', null, 'Upload all selected photos to that listing.')
          ),

          // footnote
          H('div', {
            style: {
              fontSize: 13,
              opacity: 0.9,
              borderTop: '1px solid rgba(255,255,255,0.12)',
              paddingTop: 10
            }
          }, 'You can still edit or delete the listing afterwards.')
        )
      ),
      document.body
    );
  }

  // --- Listing Form (S3-first) ---
  function ListingForm({ draft, onCancel, onSaved, autoListEnabled, autoPostNearbyEnabled }) {
    const [files, setFiles] = useState([]); // Files to upload to S3
    const [existingUrls, setExistingUrls] = useState([]); // Show current images (editable)

    const [title, setTitle] = useState(draft?.title || '');
    const [description, setDescription] = useState(draft?.description || '');
    const [location, setLocation] = useState(draft?.location || '');
    const [priceVal, setPriceVal] = useState(draft?.price?.toString?.() || '');
    const [tags, setTags] = useState(() => {
      if (!draft?.tags) return '';
      if (Array.isArray(draft.tags)) return draft.tags.join(', ');
      return String(draft.tags);
    });
    const [aiBusy, setAiBusy] = useState(false);
    const [aiErr, setAiErr] = useState('');

    // auto-list guard
    const autoRunning = useRef(false);
    const [autoBusy, setAutoBusy] = useState(false);

    const hasFixedGps = !!draft?.lat;
    const [enableNearby, setEnableNearby] = useState(!!draft?.enable_nearby);
    const [geoBusy, setGeoBusy] = useState(false);
    const [geoErr, setGeoErr] = useState('');

    const [lat, setLat] = useState(draft?.lat ?? null);
    const [lon, setLon] = useState(draft?.lon ?? null);

    const isMobile = isMobileDevice();

    // Load current images (URLs/base64; new uploads use files[])
    useEffect(() => {
      (async () => {
        if (draft?.id) {
          try { const arr = await api.getListingImages(draft.id); setExistingUrls(arr || []); }
          catch { setExistingUrls([]); }
        } else {
          setExistingUrls([]);
        }
      })();
    }, [draft?.id]);

    // UPDATED: AI analysis that works with both new files and S3 URLs
    async function runAI(){
      setAiErr('');
      setAiBusy(true);
      try {
        const sources = [];

        if (files.length) {
          for (const file of files) {
            if (sources.length >= AI_IMAGE_LIMIT) break;
            try {
              const upload = await uploadFileDraft(file);
              if (upload?.publicUrl) sources.push(upload.publicUrl);
            } catch (err) {
              console.error('AI draft upload failed:', err);
            }
          }
        }

        if (sources.length < AI_IMAGE_LIMIT && existingUrls.length) {
         for (const url of existingUrls) {
            if (sources.length >= AI_IMAGE_LIMIT) break;
            if (typeof url === 'string' && url.trim()) {
              sources.push(url);
            }
          }
        }

        if (!sources.length) {
          alert('No images available for AI analysis. Please add new images or ensure existing images are accessible.');
          return;
        }

        const res = await api.aiAnalyze({
          images: sources.slice(0, AI_IMAGE_LIMIT),
          hint: `${title} ${description}`.trim()
        });

        if (res.title) setTitle(res.title);
        if (Array.isArray(res.tags)) setTags(res.tags.join(', '));
        if (typeof res.suggested_price === 'number' && !Number.isNaN(res.suggested_price)) {
          setPriceVal(String(res.suggested_price));
        }
        if (typeof res.description === 'string' && res.description.trim()) {
          setDescription(res.description.trim().slice(0, 400));
        }
      } catch (e) {
        setAiErr(e.message || 'AI failed');
      } finally {
        setAiBusy(false);
      }
    }

    async function useMyLocation() {
      setGeoErr('');
      if (!('geolocation' in navigator)) { setGeoErr('Geolocation not supported'); return; }
      setGeoBusy(true);
      try {
        const coords = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(
            p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
            err => rej(err),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
          )
        );
        const r = await api.reverseGeocode(coords.lat, coords.lon);
        setLocation(r?.display || `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
        setLat(r?.lat ?? coords.lat);
        setLon(r?.lon ?? coords.lon);
      } catch { setGeoErr('Could not get your location'); }
      finally { setGeoBusy(false); }
    }


    // Add this state after the other useState declarations in ListingForm:
const [originalUrls, setOriginalUrls] = useState([]);

// Update the useEffect that loads images:
useEffect(() => {
  (async () => {
    if (draft?.id) {
      try { 
        const arr = await api.getListingImages(draft.id); 
        setExistingUrls(arr || []);
        setOriginalUrls(arr || []); // Track original state
      }
      catch { 
        setExistingUrls([]); 
        setOriginalUrls([]);
      }
    } else {
      setExistingUrls([]);
      setOriginalUrls([]);
    }
  })();
}, [draft?.id]);

// Update the submit function:
async function submit(e){
  e.preventDefault();
  try {
    // ... existing validation code ...

    if (draft) {
      // Determine which images were deleted
      const deletedImages = originalUrls.filter(url => !existingUrls.includes(url));
      
      // Include deleted images in the payload
      if (deletedImages.length > 0) {
        payload.deletedImages = deletedImages;
      }
      
      await api.updateListing(draft.id, payload);
      if (files.length) await uploadFilesForListing(draft.id, files);
    } else {
      // ... existing create logic ...
    }
    onSaved?.();
  } catch (err) {
    console.error('Create/save failed:', err);
    alert(`Create/save failed: ${err?.message || err}`);
  }
}

    // Auto-list: when ON, creating a brand-new listing & user added photos -> AI + create + upload
    useEffect(() => {
      if (!autoListEnabled) return;
      if (draft) return;            // only for new listings
      if (!files || files.length === 0) return;
      if (autoRunning.current) return;

      (async () => {
        autoRunning.current = true;
        setAutoBusy(true);
        try {
          const uploads = await Promise.all(files.map(uploadFileDraft));
          if (!uploads.length) throw new Error('No images to upload');

          let ai = {};
          let aiDescription = '';
          try {
            const aiSources = uploads.map((u) => u.publicUrl).filter(Boolean).slice(0, AI_IMAGE_LIMIT);
            if (aiSources.length) {
              ai = await api.aiAnalyze({ images: aiSources, hint: '' }, { silent:true }) || {};
            }
          } catch (_) {}

          const parsedPrice = Number(ai.suggested_price);
          const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

          if (typeof ai.description === 'string' && ai.description.trim()) {
            aiDescription = ai.description.trim().slice(0, 400);
          }

          // Nearby preference (sub-toggle)
          let enableNearbyAuto = 0, latAuto = null, lonAuto = null, locAuto = '';
          if (autoPostNearbyEnabled) {
            try {
              const c = await fetchCoordsAndReverse();
              enableNearbyAuto = 1;
              latAuto = c.lat; lonAuto = c.lon; locAuto = c.display;
            } catch (_) {
              enableNearbyAuto = 0;
            }
          }

          const payload = {
            title: (ai.title || 'Item for sale').toString().slice(0, 80),
            description: aiDescription || 'No description',
            location: locAuto || '',
            price: safePrice,
            tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
            enable_nearby: enableNearbyAuto,
            upload_tokens: uploads.map((u) => u.uploadToken)
          };
          if (enableNearbyAuto) { payload.lat = latAuto; payload.lon = lonAuto; }

          const created = await api.createListing(payload);
          if (!created?.id) throw new Error('Create failed');

          onSaved?.();
        } catch (err) {
          console.error('Auto-list failed:', err);
          alert(`Auto-list failed: ${err?.message || err}`);
        } finally {
          setAutoBusy(false);
        }
      })();
    }, [autoListEnabled, autoPostNearbyEnabled, draft, files]); // eslint-disable-line react-hooks/exhaustive-deps

    // UPDATED: Submit function that handles image changes properly
    // Update the submit function (remove the duplicate and fix it):
async function submit(e){
  e.preventDefault();
  try {
    const totalImages = existingUrls.length + files.length;
    if (totalImages === 0) {
      alert('Please add at least one image.');
      return;
    }

    const parsedPrice = Number(priceVal);
    const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

    const payload = {
      title: String(title || '').trim(),
      description: String(description || 'No description').trim(),
      location: String(location || '').trim(),
      price: safePrice,
      tags: String(tags || '').trim(),
      enable_nearby: enableNearby ? 1 : 0
    };

    if (enableNearby && !hasFixedGps) {
      payload.lat = lat;
      payload.lon = lon;
    }

    if (payload.enable_nearby && !hasFixedGps && (payload.lat == null || payload.lon == null)) {
      alert('Enable Nearby requires using your location.');
      return;
    }

    if (draft) {
      const deletedImages = originalUrls.filter(url => !existingUrls.includes(url));
      if (deletedImages.length > 0) {
        payload.deletedImages = deletedImages;
      }

      await api.updateListing(draft.id, payload);
      if (files.length) await uploadFilesForListing(draft.id, files);
    } else {
      let uploads = [];
      if (files.length) {
        uploads = await Promise.all(files.map(uploadFileDraft));
        const tokens = uploads.map((u) => u.uploadToken).filter(Boolean);
        if (!tokens.length) {
          throw new Error('Image upload failed');
        }
        payload.upload_tokens = tokens;
      }

      const created = await api.createListing(payload);
      if (!created?.id) { throw new Error('Create failed'); }
    }
    onSaved?.();
  } catch (err) {
    console.error('Create/save failed:', err);
    alert(`Create/save failed: ${err?.message || err}`);
  }
}

    const isFree = !priceVal || !Number.isFinite(Number(priceVal)) || Number(priceVal) === 0;

    return H('form', { onSubmit: submit, className:'row', style:{flexDirection:'column', gap:12, position:'relative'}},

      // Auto-list overlay while it works
      autoBusy && H('div', {
        style:{
          position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
          display:'grid', placeItems:'center', zIndex:5, borderRadius:12
        }
      }, H('div', null, H('div', {className:'spinner'}), H('div', {style:{marginTop:6, fontWeight:700}}, 'Auto-listing...'))),

      // New uploads (go to S3)
      H(MultiFilePicker, { files, onChange:setFiles }),

      // UPDATED: Existing images with delete capability
      (existingUrls.length > 0) && H('div', null,
        H('div', { className:'muted', style:{ marginBottom:8 } }, 'Existing images:'),
        H('div', { className:'row', style:{ gap:8, flexWrap:'wrap' } },
          ...existingUrls.map((src, i) =>
            H('div', { key:i, style:{ position:'relative' } },
              H('img', { src, style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #ddd' } }),
              H('button', { 
                className:'btn danger', 
                type:'button', 
                style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, 
                onClick:() => {
                  const next = [...existingUrls];
                  next.splice(i, 1);
                  setExistingUrls(next);
                }
              }, 'x')
            )
          )
        )
      ),

      H('div', { className:'row', style:{ gap:8 } },
        H('button', { type:'button', className:`btn ${aiBusy?'':'primary'}`, disabled:aiBusy, onClick:runAI }, aiBusy ? 'Analyzing...' : 'Run AI analysis'),
        aiErr && H('span', { className:'muted', style:{ color:'#b91c1c' } }, aiErr),
        H('span', { className:'muted' }, 'Only images are required. AI can suggest title/tags/price.')
      ),

      H('label', null, 'Title (optional)'),
      H('input', { value:title, maxLength:80, onChange:e=>setTitle(e.target.value), placeholder:'Optional' }),

      H('label', null, 'Description (optional)'),
      H('textarea', { value:description, maxLength:400, onChange:e=>setDescription(e.target.value), placeholder:'Optional' }),

      H('label', null, 'Location (optional)'),
      H('div', { className:'row', style:{ gap:8 } },
        H('input', { value:location, maxLength:80, onChange:e=>setLocation(e.target.value), placeholder:'Optional (City, State)' }),
        H('button', { type:'button', className:'btn', onClick:useMyLocation, disabled:geoBusy }, geoBusy ? 'Locating...' : 'Use my location'),
        geoErr && H('span', { className:'muted', style:{ color:'#b91c1c' } }, geoErr)
      ),

      isMobile && H('div', { className:'row', style:{ alignItems:'center', gap:6, marginTop:4 } },
        H('input', { type:'checkbox', checked:enableNearby, onChange:e=>{
          const checked = e.target.checked;
          setEnableNearby(checked);
          if (checked && !hasFixedGps) useMyLocation();
        }}),
        H('span', null, 'Enable Nearby searches (shows distance in feet/miles to buyers)')
      ),
      (enableNearby && hasFixedGps) && H('span', { className:'muted', style:{ marginTop:4 } }, 'Nearby GPS fixed at creation; cannot change.'),

      H('label', null, 'Price (optional)'),
      H('div', { className:'row', style:{ alignItems:'center', gap:8 } },
        H('input', {
          value:priceVal,
          inputMode:'decimal',
          onChange:e=>setPriceVal(e.target.value.replace(/[^0-9.]/g,'')),
          placeholder:'Leave empty for $0.00'
        }),
        H('span', {
          className:'muted',
          style:{ fontWeight:700, color: isFree ? '#16a34a' : '#6b7280' }
        }, isFree ? price(0) : price(Number(priceVal)))
      ),

      H('div', { className:'card', style:{ padding:12, background:'#fafafa' } },
        H('div', { style:{ fontWeight:600, marginBottom:6 } }, 'Search tags (private, optional)'),
        H('div', { className:'muted', style:{ marginBottom:6 } }, 'Not shown publicly; help others find your item. Example: "car, suv, 4x4".'),
        H('input', { placeholder:'e.g. car, suv, 4x4', value:tags, onChange:e=>setTags(e.target.value) })
      ),

      H('div', { className:'row' },
        H('button', { className:'btn primary', type:'submit', disabled:autoBusy }, draft ? 'Save changes' : 'Create listing'),
        H('button', { className:'btn', type:'button', onClick:onCancel, disabled:autoBusy }, 'Cancel')
      )
    );
  }

  // --- Lightbox ---
  function Lightbox({ open, images, fallback, index, onClose, onIndex, loading = false }) {
    const esc = (e)=> { if(e.key==='Escape') onClose(); };
    React.useEffect(()=>{ if(open){ window.addEventListener('keydown', esc); return ()=> window.removeEventListener('keydown', esc); }}, [open, onClose]);
    if(!open) return null;

    const display = Array.isArray(images) && images.length ? images : (Array.isArray(fallback) ? fallback : []);
    const len = display.length;
    const safeIndex = len ? Math.min(Math.max(index, 0), len - 1) : 0;
    const canNavigate = len > 1 && typeof onIndex === 'function';

    React.useEffect(() => {
      if (!open || !len) return;
      if (index < 0 || index >= len) onIndex?.(0);
    }, [open, len, index, onIndex]);

    const mainContent = len
      ? H(ResponsiveImage, {
          src: display[safeIndex] || display[0],
          alt: 'Image ' + (safeIndex + 1),
          widths: [480, 720, 1080, 1440],
          sizes: '90vw',
          loading: 'eager',
          fetchPriority: 'high',
          style: { maxHeight: '80vh', width: 'auto', objectFit: 'contain' }
        })
      : H('div', {
          style: {
            minHeight: 200,
            minWidth: 220,
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            color: '#4b5563',
            fontSize: 15,
            textAlign: 'center'
          }
        }, loading ? 'Loading images...' : 'No images available');

    const thumbs = len && typeof onIndex === 'function'
      ? H('div', { className:'thumbs' },
          ...display.map((img, i) => H('img', {
            key:i,
            src:img,
            className: i===safeIndex?'active':'',
            onClick:()=>onIndex(i)
          }))
        )
      : null;

    const modal = H('div', {
      className:'modal open lightbox',
      onClick:(e)=>{ if(e.target.classList.contains('modal')) onClose(); }
    },
      H('div', { className:'modal-inner' },
        H('button', { className:'close', onClick:onClose }, 'x'),
        canNavigate ? H('button', { className:'arrow left', onClick:()=>onIndex((safeIndex-1+len)%len) }, '<') : null,
        mainContent,
        canNavigate ? H('button', { className:'arrow right', onClick:()=>onIndex((safeIndex+1)%len) }, '>') : null,
        thumbs,
        loading && len ? H('div', { style: { marginTop: 12, textAlign: 'center', fontSize: 12, color: '#6b7280' } }, 'Loading...') : null
      )
    );

    return ReactDOM.createPortal(modal, document.body);
  }

  // SmartImage v2.1 (kept; not used in main grid now)
  function SmartImage({
    src,
    alt = '',
    br = 8,
    onClick,
    dropFar = true,
    initialAR = 4 / 3,
    lockAR = true,
    fetchPriority = 'auto'
  }) {
    const wrapRef = React.useRef(null);
    const imgRef  = React.useRef(null);

    const [activeSrc, setActiveSrc] = React.useState('');
    const [ratio, setRatio]         = React.useState(initialAR);
    const [loaded, setLoaded]       = React.useState(false);

    React.useEffect(() => {
      const el = wrapRef.current; if (!el) return;
      let clearTo = null;

      const io = new IntersectionObserver((entries) => {
        const e = entries[0]; if (!e) return;

        if (e.isIntersecting) {
          setActiveSrc(src);
        } else if (dropFar) {
          const top = e.boundingClientRect.top;
          const bottom = e.boundingClientRect.bottom;
          const dist = top > 0 ? top : -bottom; // positive px from viewport
          if (dist > window.innerHeight * 3.5) {
            clearTimeout(clearTo);
            clearTo = setTimeout(() => setActiveSrc(''), 120);
          }
        }
      }, { root: null, rootMargin: '600px 0px' });

      io.observe(el);
      return () => { clearTimeout(clearTo); io.disconnect(); };
    }, [src, dropFar]);

    React.useEffect(() => {
      setLoaded(false);
    }, [activeSrc]);

    function onLoad(e) {
      setLoaded(true);
      if (lockAR) return;
      const w = e.currentTarget.naturalWidth || 0;
      const h = e.currentTarget.naturalHeight || 0;
      if (w && h) setRatio(w / h);
    }

    return H('div', {
      ref: wrapRef,
      style: {
        position: 'relative',
        width: '100%',
        aspectRatio: `${ratio} / 1`,
        borderRadius: br,
        overflow: 'hidden',
        background: '#f3f4f6'
      }
    },
      !loaded && activeSrc && H('div', {
        style: {
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(120deg, #f3f4f6 15%, #e5e7eb 35%, #f3f4f6 55%)',
          backgroundSize: '200% 200%',
          animation: 'img-shimmer 1s ease-in-out infinite'
        }
      }),
      activeSrc && H('img', {
        ref: imgRef,
        src: activeSrc,
        alt,
        loading: 'lazy',
        decoding: 'async',
        fetchpriority: fetchPriority,
        onLoad,
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          cursor: onClick ? 'pointer' : 'default',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 180ms ease'
        },
        onClick
      })
    );
  }

  const RESPONSIVE_WIDTHS = [320, 480, 640, 960, 1280];

  function buildSizedUrl(src, width) {
    if (!src || typeof src !== 'string') return src;
    if (src.startsWith('data:') || src.startsWith('blob:')) return src;
    try {
      const url = new URL(src);
      if (width && Number.isFinite(width)) url.searchParams.set('w', String(width));
      if (!url.searchParams.has('auto')) url.searchParams.set('auto', 'compress');
      return url.toString();
    } catch (_) {
      return src;
    }
  }

  function ResponsiveImage({
    src,
    alt = '',
    widths = RESPONSIVE_WIDTHS,
    sizes = '(min-width: 1024px) 280px, (min-width: 640px) 50vw, 90vw',
    loading = 'lazy',
    decoding = 'async',
    fetchPriority = 'auto',
    style,
    className,
    onClick
  }) {
    const hasResponsive = Array.isArray(widths) && widths.length > 0 && typeof src === 'string' && !src.startsWith('data:') && !src.startsWith('blob:');
    const srcSet = hasResponsive
      ? widths.map((w) => `${buildSizedUrl(src, w)} ${w}w`).join(', ')
      : undefined;
    const defaultSrc = hasResponsive ? buildSizedUrl(src, widths[widths.length - 1]) : src;

    return H('img', {
      src: defaultSrc || src,
      srcSet,
      sizes: srcSet ? sizes : undefined,
      alt,
      loading,
      decoding,
      fetchpriority: fetchPriority,
      style,
      className,
      onClick
    });
  }

  const REPORT_REASON_OPTIONS = [
    { value: 'fraud', label: 'Fraud or scam' },
    { value: 'spam', label: 'Spam or advertising' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'harassment', label: 'Harassment or abusive behavior' },
    { value: 'other', label: 'Other' }
  ];

  function makeReportCaptcha() {
    return {
      a: 2 + Math.floor(Math.random() * 7),
      b: 2 + Math.floor(Math.random() * 7)
    };
  }

  function ReportSellerModal({ open, listing, onClose, onReported }) {
    const [selected, setSelected] = useState(() => new Set());
    const [details, setDetails] = useState('');
    const [captcha, setCaptcha] = useState(() => makeReportCaptcha());
    const [answer, setAnswer] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
      if (!open) return;
      setSelected(new Set());
      setDetails('');
      setCaptcha(makeReportCaptcha());
      setAnswer('');
      setError('');
      setSubmitted(false);
    }, [open, listing?.id]);

    useEffect(() => {
      if (!open) return;
      const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const toggleReason = (value) => {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (submitting || submitted) return;
      setError('');
      const reasons = Array.from(selected);
      if (!reasons.length) {
        setError('Select at least one reason.');
        return;
      }
      if (reasons.includes('other') && !details.trim()) {
        setError('Please include details for "Other".');
        return;
      }
      const expected = captcha.a + captcha.b;
      if (Number(answer) !== expected) {
        setError('Captcha answer is incorrect.');
        setCaptcha(makeReportCaptcha());
        setAnswer('');
        return;
      }
      setSubmitting(true);
      try {
        await api.reportSeller({
          reported_user_id: listing?.user_id,
          listing_id: listing?.id,
          reasons,
          details: details.trim() || undefined,
          captcha: { a: captcha.a, b: captcha.b, answer: Number(answer) }
        });
        setSubmitted(true);
        onReported?.();
      } catch (err) {
        setError(err.message || 'Unable to submit report.');
        setCaptcha(makeReportCaptcha());
        setAnswer('');
      } finally {
        setSubmitting(false);
      }
    };

    if (!open) return null;

    const sellerName = listing?.owner_username ? `@${listing.owner_username}` : 'this seller';

    const modal = H('div', {
      className: 'modal open',
      onClick: (e) => { if (e.target.classList.contains('modal')) onClose?.(); }
    },
      H('div', { className: 'modal-inner', style: { maxWidth: '520px', padding: '24px', background: '#fff', color: '#111' } },
        H('button', { className: 'close', onClick: onClose, disabled: submitting && !submitted }, 'X'),
        H('h2', { style: { margin: '0 0 16px', fontSize: 24, fontWeight: 700 } }, `Report ${sellerName}`),
        submitted ?
          H('div', { className: 'muted', style: { marginBottom: 16 } }, 'Thank you. We will review this report shortly.') :
          H('form', { onSubmit: handleSubmit, style: { display: 'grid', gap: 12 } },
            H('div', { style: { fontWeight: 600 } }, 'Why are you reporting this seller?'),
            REPORT_REASON_OPTIONS.map(opt => H('label', {
              key: opt.value,
              style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }
            },
              H('input', {
                type: 'checkbox',
                checked: selected.has(opt.value),
                disabled: submitting,
                onChange: () => toggleReason(opt.value)
              }),
              opt.label
            )),
            H('textarea', {
              placeholder: 'Additional details (optional)',
              value: details,
              onChange: (e) => setDetails(e.target.value),
              disabled: submitting,
              rows: 3,
              style: { width: '100%', fontSize: 13, padding: 8 }
            }),
            H('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              H('span', null, `What is ${captcha.a} + ${captcha.b}?`),
              H('input', {
                type: 'number',
                value: answer,
                onChange: (e) => setAnswer(e.target.value),
                disabled: submitting,
                style: { width: 80 }
              })
            ),
            error && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, error),
            H('div', { className: 'row', style: { gap: 8, marginTop: 4 } },
              H('button', { className: 'btn primary', type: 'submit', disabled: submitting, style: { flex: 1 } }, submitting ? 'Submitting...' : 'Submit report'),
              H('button', { className: 'btn', type: 'button', onClick: onClose, disabled: submitting, style: { flex: 1 } }, 'Cancel')
            )
          ),
        submitted && H('div', { style: { marginTop: 16 } },
          H('button', { className: 'btn primary', onClick: onClose }, 'Close')
        )
      )
    );

    return ReactDOM.createPortal(modal, document.body);
  }

  // --- Listing Card ---
  function ListingCard({ 
  item, 
  canEdit, 
  onEdit, 
  onDelete, 
  user, 
  onMessage, 
  onAdminDelete, 
  onViewSeller,  // Add this prop
  onToggleSold,
  showDistance = false 
}) {

  const [open, setOpen] = useState(false);
  const [images, setImages] = useState(() => {
    const cached = item?.id ? listingImageCache.get(item.id) : null;
    if (Array.isArray(cached) && cached.length) return cached;
    return item?.image_data ? [item.image_data] : null;
  });
  const [loadingImages, setLoadingImages] = useState(false);
  const [idx, setIdx] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [derivedMeters, setDerivedMeters] = React.useState(null);

  const prefetchImages = useCallback(() => {
    if (!item?.id) return;
    if (listingImageCache.has(item.id) || listingImageInFlight.has(item.id)) return;
    fetchListingImagesCached(item.id);
  }, [item?.id]);

  React.useEffect(() => {
    if (!item?.id) {
      setImages(item?.image_data ? [item.image_data] : null);
      return;
    }
    const cached = listingImageCache.get(item.id);
    if (Array.isArray(cached) && cached.length) {
      setImages(prev => (prev === cached ? prev : cached));
      return;
    }
    if (item.image_data) {
      setImages(prev => {
        if (Array.isArray(prev) && prev.length === 1 && prev[0] === item.image_data) {
          return prev;
        }
        return [item.image_data];
      });
    } else {
      setImages(null);
    }
  }, [item?.id, item?.image_data]);

  React.useEffect(() => {
    if (!showDistance) { 
      setDerivedMeters(null); 
      return; 
    }
    let fromServer = null;
    if (Number.isFinite(item?.distance_m)) fromServer = item.distance_m;
    if (Number.isFinite(item?.distance_ft)) fromServer = item.distance_ft / 3.28084;
    if (fromServer != null) { 
      setDerivedMeters(fromServer); 
      return; 
    }

    if (Number.isFinite(item?.lat) && Number.isFinite(item?.lon)) {
      getUserCoordsOnce().then(coords => {
        if (!coords) return;
        const m = haversineMeters(coords.lat, coords.lon, item.lat, item.lon);
        setDerivedMeters(m);
      });
    } else {
      setDerivedMeters(null);
    }
  }, [showDistance, item?.id, item?.lat, item?.lon]);

  React.useEffect(() => {
    if (!open || !Array.isArray(images)) return;
    if (idx < 0 || idx >= images.length) setIdx(0);
  }, [open, images, idx]);

  async function openModal(start = 0) {
    setIdx(start);
    setOpen(true);

    if (!item?.id) return;

    const cached = listingImageCache.get(item.id);
    if (Array.isArray(cached) && cached.length) {
      setImages(prev => (prev === cached ? prev : cached));
      return;
    }

    const hasGallery = Array.isArray(images) && images.length > 0 && !(images.length === 1 && images[0] === item.image_data);

    if (hasGallery || loadingImages) {
      return;
    }

    setLoadingImages(true);
    try {
      const fetched = await fetchListingImagesCached(item.id);
      if (Array.isArray(fetched) && fetched.length) {
        setImages(fetched);
      } else {
        setImages(prev => {
          if (Array.isArray(prev) && prev.length) return prev;
          return item.image_data ? [item.image_data] : null;
        });
      }
    } finally {
      setLoadingImages(false);
    }
  }

  const closeModal = useCallback(() => {
    setOpen(false);
    if (item?.id) {
      const cached = listingImageCache.get(item.id);
      if (Array.isArray(cached) && cached.length) {
        setImages(cached);
      } else if (item.image_data) {
        setImages([item.image_data]);
      } else {
        setImages(null);
      }
    } else {
      setImages(item?.image_data ? [item.image_data] : null);
    }
    setIdx(0);
  }, [item?.id, item?.image_data]);

  useEffect(() => {
    if (!item?.id) return;
    if (!Array.isArray(images) || !images.length) return;
    const fallbackOnly = images.length === 1 && images[0] === item.image_data;
    if (fallbackOnly) return;
    listingImageCache.set(item.id, images);
  }, [images, item?.id, item?.image_data]);

  const isFree = Number(item?.price ?? 0) === 0;
  const [soldBusy, setSoldBusy] = useState(false);
  const fallbackImages = useMemo(() => item?.image_data ? [item.image_data] : [], [item?.image_data]);

  const controls = [];
  if (!user || user.id !== item.user_id) {
    controls.push(H('button', { 
      key: 'm', 
      className: 'btn primary', 
      onClick: () => onMessage?.(item) 
    }, 'Message seller'));
  }
  if (user && user.id !== item.user_id) {
    controls.push(H('button', {
      key: 'report',
      className: 'btn',
      onClick: () => setShowReport(true)
    }, 'Report seller'));
  }
  if (canEdit) {
    controls.push(H('button', { 
      key: 'e', 
      className: 'btn', 
      onClick: () => onEdit?.(item) 
    }, 'Edit'));
    if (onToggleSold) {
      const isSold = !!item?.sold;
      controls.push(H('button', {
        key: 'sold-toggle',
        className: 'btn',
        onClick: async () => {
          if (soldBusy) return;
          try {
            setSoldBusy(true);
            await onToggleSold(item, !isSold);
          } finally {
            setSoldBusy(false);
          }
        },
        disabled: soldBusy,
        style: {
          background: isSold ? '#D1FAE5' : '#059669',
          color: isSold ? '#047857' : '#fff',
          borderColor: '#059669'
        }
      }, isSold ? 'Mark as unsold' : 'Mark as sold'));
    }
    controls.push(H('button', { 
      key: 'd', 
      className: 'btn danger', 
      onClick: () => onDelete?.(item) 
    }, 'Remove Listing'));
  }
  if (user?.is_admin) {
    controls.push(H('button', {
      key: 'admin-del',
      className: 'btn danger',
      onClick: async () => {
        if (!confirm('Admin: Delete this listing?')) return;
        await api.adminDeleteListing(item.id);
        onAdminDelete?.(item.id);
      }
    }, 'Admin Delete'));
  }

  // Render seller info - either as clickable button or plain text
  const renderSellerInfo = () => {
    if (!item.owner_username) {
      return '--';
    }
    
    if (onViewSeller) {
      return H('button', {
        onClick: () => onViewSeller(item.user_id, item.owner_username),
        style: {
          background: 'none',
          border: 'none',
          color: '#111',
          fontWeight: 600,
          textDecoration: 'underline',
          cursor: 'pointer',
          padding: 0,
          font: 'inherit'
        }
      }, `@${item.owner_username}`);
    }
    
    return H('span', null, `@${item.owner_username}`);
  };

  const coverSrc = item.image_data || (images && images[0]) || '';

  return H('div', { className: 'card', onMouseEnter: prefetchImages, onFocus: prefetchImages, onPointerDown: prefetchImages, onTouchStart: prefetchImages, tabIndex: -1 },
    H('div', {
      className: 'aspect',
      onClick: (e) => {
        e.stopPropagation();
        openModal(0);
      },
      style: {
        cursor: 'zoom-in',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 8
      }
    },
      coverSrc
        ? H(ResponsiveImage, {
            src: coverSrc,
            alt: item.title || 'Listing image',
            style: { width: '100%', height: '100%', objectFit: 'cover' },
            sizes: '(min-width: 1024px) 280px, (min-width: 640px) 45vw, 90vw'
          })
        : H('div', {
            style: {
              width: '100%',
              height: '100%',
              background: '#f3f4f6',
              display: 'grid',
              placeItems: 'center',
              color: '#6b7280',
              fontWeight: 600
            }
          }, 'No image'),
      item.sold ? H('div', {
        style: {
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }
      },
        H('div', {
          style: {
            transform: 'rotate(-18deg)',
            padding: '6px 18px',
            textTransform: 'uppercase',
            letterSpacing: '6px',
            fontWeight: 800,
            fontSize: 26,
            color: 'rgba(4, 120, 87, 0.85)',
            border: '3px solid rgba(16, 185, 129, 0.55)',
            background: 'rgba(229, 255, 244, 0.82)',
            borderRadius: 999
          }
        }, 'Sold')
      ) : null
    ),
    
    H('div', { style: { padding: 16 } },
      H('div', { 
        className: 'row', 
        style: { justifyContent: 'space-between', alignItems: 'start' } 
      },
        H('div', null,
          H('div', { style: { fontWeight: 800 } }, item.title || 'Item for sale'),
          H('div', { className: 'muted' }, item.description)
        ),
        H('div', { 
          style: { 
            fontWeight: 800, 
            textAlign: 'right', 
            color: isFree ? '#16a34a' : '#111' 
          } 
        }, price(item.price))
      ),
      
      H('div', { className: 'muted' }, item.location || 'No location'),
      
      (showDistance && derivedMeters != null) && 
        H('div', { className: 'distance' }, fmtDistance(derivedMeters) + ' away'),
      
      H('div', { className: 'muted' }, 
        'Seller: ',
        renderSellerInfo()
      ),
      
      H('div', { 
        className: 'row', 
        style: { marginTop: 8, justifyContent: 'flex-start', gap: 8 } 
      }, ...controls)
    ),
    
    showReport && H(ReportSellerModal, {
      open: showReport,
      listing: item,
      onClose: () => setShowReport(false)
    }),

    H(Lightbox, { 
      open, 
      images, 
      fallback: fallbackImages, 
      loading: loadingImages, 
      index: idx, 
      onClose: closeModal, 
      onIndex: setIdx 
    })
  );
}

function createEmptyAdForm() {
  return {
    title: '',
    subtitle: '',
    target_url: '',
    image_url: '',
    cta_label: '',
    background: '',
    position: 0,
    is_active: true
  };
}

function AdminDashboard({ onViewSeller, onMessageUser, onAdsUpdated }) {
  const [tab, setTab] = useState('users');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState('');
  const [userReports, setUserReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [topReports, setTopReports] = useState([]);
  const [clearingUserId, setClearingUserId] = useState(null);
  const [topLoading, setTopLoading] = useState(false);
  const [topError, setTopError] = useState('');
  const [topDays, setTopDays] = useState(7);
  const [topMin, setTopMin] = useState(1);

  const [adsList, setAdsList] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState('');
  const [adSaving, setAdSaving] = useState(false);
  const [editingAdId, setEditingAdId] = useState(null);
  const [adForm, setAdForm] = useState(() => createEmptyAdForm());

  const searchTimer = useRef(null);

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);
  useEffect(() => { loadTopReports(topDays, topMin); }, [topDays, topMin]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = searchTerm.trim();
    if (!term) {
      setSearchResults([]);
      setSearchError('');
      return;
    }
    searchTimer.current = setTimeout(() => { fetchSearch(term); }, 300);
  }, [searchTerm]);

  const loadAds = useCallback(async () => {
    setAdsLoading(true);
    setAdsError('');
    try {
      const rows = await api.adminListAds({ silent: true });
      setAdsList(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setAdsError(err?.message || 'Failed to load ads');
      setAdsList([]);
    } finally {
      setAdsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'ads') {
      loadAds();
    }
  }, [tab, loadAds]);

  function formatDate(value) {
    if (!value) return '--';
    const dt = new Date(value);
    return Number.isFinite(dt.getTime()) ? dt.toLocaleDateString() : value;
  }

  function formatDateTime(value) {
    if (!value) return '--';
    const dt = new Date(value);
    return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : value;
  }

  function statusBadge(status) {
    const color = status === 'banned' ? '#fee2e2' : status === 'locked' ? '#fef3c7' : '#d1fae5';
    const textColor = status === 'banned' ? '#b91c1c' : status === 'locked' ? '#92400e' : '#047857';
    return H('span', {
      style: {
        padding: '3px 10px',
        borderRadius: 999,
        background: color,
        color: textColor,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase'
      }
    }, status || 'active');
  }

  async function fetchSearch(term) {
    setSearchLoading(true);
    setSearchError('');
    try {
      const results = await api.adminSearchUsers({ q: term, limit: 25 });
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (err) {
      setSearchError(err.message || 'Search failed');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadUser(userId) {
    setSelectedUserId(userId);
    setUserLoading(true);
    setUserError('');
    try {
      const data = await api.adminGetUser(userId);
      setSelectedUser(data || null);
      await loadUserReports(userId);
    } catch (err) {
      setUserError(err.message || 'Failed to load user');
      setSelectedUser(null);
      setUserReports([]);
    } finally {
      setUserLoading(false);
    }
  }

  async function loadUserReports(userId, limit = 50) {
    setReportsLoading(true);
    setReportsError('');
    try {
      const items = await api.adminGetUserReports(userId, { limit });
      setUserReports(Array.isArray(items) ? items : []);
    } catch (err) {
      setReportsError(err.message || 'Failed to load reports');
      setUserReports([]);
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadTopReports(daysValue = topDays, minValue = topMin) {
    setTopLoading(true);
    setTopError('');
    try {
      const payload = await api.adminTopReports({ limit: 20, days: daysValue, min: minValue });
      const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
      setTopReports(items);
    } catch (err) {
      setTopError(err.message || 'Failed to load report summary');
      setTopReports([]);
    } finally {
      setTopLoading(false);
    }
  }

  async function handleStatusChange(status) {
    if (!selectedUser) return;
    if (status === selectedUser.account_status) return;
    const confirmMsg = status === 'active' ? 'Restore account access?' : status === 'locked' ? 'Lock this account?' : 'Ban this account?';
    if (!window.confirm(confirmMsg)) return;
    let note = '';
    if (status !== 'active') {
      note = window.prompt('Add an optional note for this action:', selectedUser.status_note || '') || '';
    } else if (selectedUser.status_note) {
      note = window.prompt('Update note (leave blank to clear):', selectedUser.status_note || '') || '';
    }
    try {
      await api.adminUpdateUserStatus(selectedUser.id, { status, note: note.trim() });
      await loadUser(selectedUser.id);
      await loadTopReports(topDays, topMin);
      if (searchTerm.trim()) await fetchSearch(searchTerm.trim());
    } catch (err) {
      alert(err.message || 'Failed to update status');
    }
  }

  function handleViewUserFromTop(userId) {
    setTab('users');
    loadUser(userId);
  }

  async function handleClearReportsForUser(user) {
    if (!user || !Number.isFinite(Number(user.user_id))) return;
    const name = user.username || 'this user';
    if (!window.confirm(`Clear reports for ${name}?`)) return;
    const noteInput = window.prompt('Optional note for this action:', '') || '';
    try {
      setClearingUserId(Number(user.user_id));
      const payload = noteInput.trim() ? { note: noteInput.trim() } : {};
      await api.adminClearUserReports(Number(user.user_id), payload);
      if (selectedUser?.id === Number(user.user_id)) {
        await loadUser(Number(user.user_id));
      }
      await loadTopReports(topDays, topMin);
      if (searchTerm.trim()) await fetchSearch(searchTerm.trim());
    } catch (err) {
      alert(err.message || 'Failed to clear reports');
    } finally {
      setClearingUserId(null);
    }
  }

  function buildAdPayload(source) {
    const payload = {
      title: String(source.title || '').trim(),
      subtitle: String(source.subtitle || '').trim(),
      target_url: String(source.target_url || '').trim(),
      image_url: String(source.image_url || '').trim(),
      cta_label: String(source.cta_label || '').trim(),
      background: String(source.background || '').trim(),
      position: Number.isFinite(Number(source.position)) ? Math.round(Number(source.position)) : 0,
      is_active: source.is_active ? 1 : 0
    };
    if (payload.position > 9999) payload.position = 9999;
    if (payload.position < -9999) payload.position = -9999;
    return payload;
  }

  function resetAdForm() {
    setEditingAdId(null);
    setAdForm(createEmptyAdForm());
    setAdsError('');
  }

  function handleEditAd(ad) {
    if (!ad) return;
    setAdsError('');
    setEditingAdId(ad.id);
    setAdForm({
      title: ad.title || '',
      subtitle: ad.subtitle || '',
      target_url: ad.target_url || '',
      image_url: ad.image_url || '',
      cta_label: ad.cta_label || '',
      background: ad.background || '',
      position: Number.isFinite(Number(ad.position)) ? Number(ad.position) : 0,
      is_active: !!ad.is_active
    });
  }

  async function handleAdSubmit(e) {
    e.preventDefault();
    setAdSaving(true);
    setAdsError('');
    try {
      const payload = buildAdPayload(adForm);
      if (!payload.title || !payload.target_url) {
        setAdsError('Title and target URL are required.');
        setAdSaving(false);
        return;
      }
      if (editingAdId) {
        await api.adminUpdateAd(editingAdId, payload);
      } else {
        await api.adminCreateAd(payload);
      }
      await loadAds();
      resetAdForm();
      onAdsUpdated?.();
    } catch (err) {
      setAdsError(err?.message || 'Failed to save ad');
    } finally {
      setAdSaving(false);
    }
  }

  async function handleDeleteAd(id) {
    if (!Number.isFinite(Number(id))) return;
    if (!window.confirm('Delete this ad?')) return;
    try {
      await api.adminDeleteAd(id);
      if (editingAdId === id) resetAdForm();
      await loadAds();
      onAdsUpdated?.();
    } catch (err) {
      alert(err?.message || 'Failed to delete ad');
    }
  }

  async function handleToggleAdActive(ad) {
    if (!ad) return;
    try {
      const payload = buildAdPayload({ ...ad, is_active: ad.is_active ? 0 : 1 });
      await api.adminUpdateAd(ad.id, payload);
      await loadAds();
      onAdsUpdated?.();
    } catch (err) {
      alert(err?.message || 'Failed to update ad');
    }
  }

  const lockToggleLabel = selectedUser?.account_status === 'locked' ? 'Unlock account' : 'Lock account';
  const lockToggleTarget = selectedUser?.account_status === 'locked' ? 'active' : 'locked';
  const showRestore = selectedUser?.account_status === 'banned';

  const userSummary = selectedUser ? H('div', { style: { display: 'grid', gap: 8 } },
    H('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      H('div', { style: { fontSize: 20, fontWeight: 700 } }, selectedUser.username || '(no username)'),
      statusBadge(selectedUser.account_status || 'active')
    ),
    H('div', { className: 'muted' }, selectedUser.email || 'No email on file'),
    H('div', { className: 'muted', style: { fontSize: 13 } }, `Joined: ${formatDate(selectedUser.created_at)}`),
    H('div', { className: 'muted', style: { fontSize: 13 } }, `Last login: ${formatDateTime(selectedUser.last_login_at)}`),
    H('div', { className: 'muted', style: { fontSize: 13 } }, `Listings: ${Number(selectedUser.listing_count || 0)} | Reports: ${Number(selectedUser.report_count || 0)} | Open reports: ${Number(selectedUser.open_report_count || 0)}`),
    selectedUser.status_note && H('div', { style: { fontSize: 13, background: '#fef3c7', padding: 8, borderRadius: 8, color: '#92400e' } }, `Note: ${selectedUser.status_note}`),
    H('div', { className: 'row', style: { gap: 8, marginTop: 8, flexWrap: 'wrap' } },
      onViewSeller && H('button', { className: 'btn', onClick: handleViewProfile }, 'View profile'),
      onMessageUser && H('button', { className: 'btn', onClick: handleMessageUser }, 'Message user'),
      H('button', { className: 'btn', onClick: () => handleStatusChange(lockToggleTarget) }, lockToggleLabel),
      H('button', { className: 'btn danger', onClick: () => handleStatusChange('banned') }, 'Ban account'),
      showRestore && H('button', { className: 'btn', onClick: () => handleStatusChange('active') }, 'Restore account'),
      H('button', { className: 'btn', onClick: () => loadUser(selectedUser.id) }, 'Refresh')
    )
  ) : H('div', { className: 'muted' }, userError || 'Select a user to view details.');


  function handleViewProfile() {
    if (!selectedUser || !onViewSeller) return;
    const label = selectedUser.username || selectedUser.email || `User #${selectedUser.id}`;
    onViewSeller(selectedUser.id, label);
  }

  async function handleMessageUser() {
    if (!selectedUser || !onMessageUser) return;
    try {
      await onMessageUser(selectedUser.id);
    } catch (err) {
      alert(err?.message || 'Failed to open conversation.');
    }
  }

  const reportsList = userReports.length
    ? H('div', { style: { display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto', marginTop: 12 } },
        userReports.map(r => H('div', {
          key: r.id,
          className: 'card',
          style: { padding: 12, border: '1px solid #e5e7eb' }
        },
          H('div', { style: { fontSize: 13, fontWeight: 600 } }, `Report #${r.id}`),
          H('div', { className: 'muted', style: { fontSize: 12 } }, `Filed: ${formatDateTime(r.created_at)}`),
          H('div', { className: 'muted', style: { fontSize: 12 } }, `Reporter: ${r.reporter?.username || 'anonymous'} (${r.reporter?.email || 'no email'})`),
          Array.isArray(r.reasons) && r.reasons.length
            ? H('div', { style: { fontSize: 12, marginTop: 4 } }, `Reasons: ${r.reasons.join(', ')}`)
            : null,
          r.details && H('div', { style: { fontSize: 12, marginTop: 4 } }, r.details)
        ))
      )
    : H('div', { className: 'muted', style: { marginTop: 12 } }, reportsError || (reportsLoading ? 'Loading reports...' : 'No reports for this user.'));

  const topList = topReports.length
    ? H('div', { style: { display: 'grid', gap: 8, marginTop: 12 } },
        topReports.map(item => H('div', {
          key: item.user_id,
          className: 'card',
          style: { padding: 12, border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }
        },
          H('div', { style: { display: 'grid', gap: 4 } },
            H('div', { style: { fontWeight: 600 } }, item.username || '(no username)'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, item.email || 'No email'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, `Reports: ${Number(item.total_reports || 0)} | Open: ${Number(item.open_reports || 0)} | Recent: ${Number(item.recent_reports || 0)}`),
            H('div', { className: 'muted', style: { fontSize: 12 } }, `Last report: ${formatDateTime(item.last_report_at)}`)
          ),
          H('div', { className: 'row', style: { gap: 8, alignItems: 'center' } },
            statusBadge(item.account_status || 'active'),
            H('button', {
              className: 'btn danger',
              onClick: () => handleClearReportsForUser(item),
              disabled: clearingUserId === Number(item.user_id)
            }, clearingUserId === Number(item.user_id) ? 'Clearing...' : 'Clear'),
            H('button', { className: 'btn', onClick: () => handleViewUserFromTop(item.user_id) }, 'View')
          )
        ))
      )
    : H('div', { className: 'muted', style: { marginTop: 12 } }, topError || (topLoading ? 'Loading...' : 'No reported accounts yet.'));

  return H('div', { className: 'admin-dashboard', style: { display: 'grid', gap: 16 } },
    H('div', { className: 'row', style: { gap: 8 } },
      H('button', { className: `btn ${tab === 'users' ? 'primary' : ''}`, onClick: () => setTab('users') }, 'Users'),
      H('button', { className: `btn ${tab === 'reports' ? 'primary' : ''}`, onClick: () => setTab('reports') }, 'Reports'),
      H('button', { className: `btn ${tab === 'ads' ? 'primary' : ''}`, onClick: () => setTab('ads') }, 'Ads')
    ),

    tab === 'users' && H('div', { style: { display: 'grid', gap: 16 } },
      H('section', { className: 'card', style: { padding: 16 } },
        H('h3', { style: { margin: '0 0 12px', fontSize: 18 } }, 'Search users'),
        H('div', { className: 'row', style: { gap: 8, marginBottom: 8 } },
          H('input', {
            value: searchTerm,
            onChange: (e) => setSearchTerm(e.target.value),
            placeholder: 'Search by email or username',
            style: { flex: 1, padding: 8, fontSize: 14 },
            disabled: searchLoading
          }),
          searchTerm && H('button', {
            className: 'btn',
            type: 'button',
            onClick: () => setSearchTerm(''),
            disabled: searchLoading
          }, 'Clear')
        ),
        searchError && H('div', { style: { color: '#b91c1c', fontSize: 13, marginBottom: 8 } }, searchError),
        searchLoading && !searchTerm.trim() ? H('div', { className: 'muted', style: { fontSize: 13 } }, 'Loading...') : null,
        H('div', { style: { maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 } },
          searchResults.map(item => H('button', {
            key: item.id,
            className: 'card',
            onClick: () => loadUser(item.id),
            style: {
              padding: 12,
              textAlign: 'left',
              border: selectedUserId === item.id ? '2px solid #2563eb' : '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer'
            }
          },
            H('div', { style: { fontWeight: 600 } }, item.username || '(no username)'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, item.email || 'No email'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, `Status: ${item.account_status || 'active'} | Reports: ${Number(item.report_count || 0)}`)
          ))
        )
      ),

      H('section', { className: 'card', style: { padding: 16 } },
        userLoading ? H('div', { className: 'muted' }, 'Loading user...') : userSummary,
        (reportsLoading && !userReports.length) ? H('div', { className: 'muted', style: { marginTop: 12 } }, 'Loading reports...') : reportsList
      )
    ),

    tab === 'reports' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },
      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
        H('h3', { style: { margin: 0, fontSize: 18 } }, 'Most reported accounts'),
        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          H('label', { style: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 } },
            'Window:',
            H('select', {
              value: topDays,
              onChange: (e) => setTopDays(Number(e.target.value)),
              style: { padding: 6 }
            },
              H('option', { value: 7 }, '7 days'),
              H('option', { value: 30 }, '30 days'),
              H('option', { value: 90 }, '90 days')
            )
          ),
          H('label', { style: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 } },
            'Min reports:',
            H('input', {
              type: 'number',
              min: 1,
              value: String(topMin),
              onChange: (e) => setTopMin(Math.max(1, Number(e.target.value) || 1)),
              style: { width: 72, padding: 6 }
            })
          ),
          H('button', { className: 'btn', onClick: () => loadTopReports(topDays, topMin) }, 'Refresh')
        )
      ),
      topLoading && !topReports.length ? H('div', { className: 'muted' }, 'Loading...') : null,
      topList
    ),



    tab === 'ads' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 16 } },

      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },

        H('h3', { style: { margin: 0, fontSize: 18 } }, editingAdId ? 'Edit advertisement' : 'Create advertisement'),

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('button', { className: 'btn', type: 'button', onClick: loadAds, disabled: adsLoading }, 'Refresh'),

          editingAdId && H('button', { className: 'btn', type: 'button', onClick: resetAdForm, disabled: adSaving }, 'New ad')

        )

      ),

      adsError && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, adsError),

      H('form', { onSubmit: handleAdSubmit, style: { display: 'grid', gap: 12 } },

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 260px' } },

            'Title',

            H('input', {

              value: adForm.title,

              onChange: (e) => setAdForm(f => ({ ...f, title: e.target.value })),

              placeholder: 'Headline',

              disabled: adSaving,

              required: true

            })

          ),

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 260px' } },

            'Target URL',

            H('input', {

              value: adForm.target_url,

              onChange: (e) => setAdForm(f => ({ ...f, target_url: e.target.value })),

              placeholder: 'https://example.com',

              disabled: adSaving,

              required: true

            })

          )

        ),

        H('label', { style: { display: 'grid', gap: 4 } },

          'Subtitle',

          H('input', {

            value: adForm.subtitle,

            onChange: (e) => setAdForm(f => ({ ...f, subtitle: e.target.value })),

            placeholder: 'Short supporting copy',

            disabled: adSaving

          })

        ),

        H('label', { style: { display: 'grid', gap: 4 } },

          'Image URL',

          H('input', {

            value: adForm.image_url,

            onChange: (e) => setAdForm(f => ({ ...f, image_url: e.target.value })),

            placeholder: 'https://cdn.example.com/banner.jpg',

            disabled: adSaving

          })

        ),

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 200px' } },

            'CTA label',

            H('input', {

              value: adForm.cta_label,

              onChange: (e) => setAdForm(f => ({ ...f, cta_label: e.target.value })),

              placeholder: 'Learn more',

              disabled: adSaving

            })

          ),

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 240px' } },

            'Background',

            H('input', {

              value: adForm.background,

              onChange: (e) => setAdForm(f => ({ ...f, background: e.target.value })),

              placeholder: 'e.g. linear-gradient(...)',

              disabled: adSaving

            })

          ),

          H('label', { style: { display: 'grid', gap: 4, width: 140 } },

            'Position',

            H('input', {

              type: 'number',

              value: adForm.position,

              onChange: (e) => setAdForm(f => ({ ...f, position: e.target.value })),

              disabled: adSaving

            })

          ),

          H('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },

            H('input', {

              type: 'checkbox',

              checked: !!adForm.is_active,

              onChange: (e) => setAdForm(f => ({ ...f, is_active: e.target.checked })),

              disabled: adSaving

            }),

            'Active'

          )

        ),

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('button', { className: 'btn primary', type: 'submit', disabled: adSaving }, editingAdId ? 'Update ad' : 'Create ad'),

          H('button', { className: 'btn', type: 'button', onClick: resetAdForm, disabled: adSaving }, 'Reset')

        ),

        H('div', { style: { display: 'grid', gap: 8 } },

          H('div', { className: 'muted', style: { fontSize: 12 } }, 'Preview'),

          H('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 } },

            H(AdTile, { ad: { ...adForm }, cols: 3, preview: true, className: 'ad-preview' })

          )

        )

      ),

      adsLoading ? H('div', { className: 'muted' }, 'Loading ads...') :

        (adsList.length

          ? H('div', { style: { display: 'grid', gap: 12 } }, adsList.map(ad =>

              H('div', { key: ad.id, className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },

                H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },

                  H('div', { style: { display: 'grid', gap: 4 } },

                    H('div', { style: { fontWeight: 600 } }, ad.title || '(no title)'),

                    H('div', { className: 'muted', style: { fontSize: 12 } }, ad.target_url),

                    H('div', { className: 'muted', style: { fontSize: 12 } }, `Position: ${Number(ad.position || 0)} | ${ad.is_active ? 'Active' : 'Inactive'}`)

                  ),

                  H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

                    H('button', { className: 'btn', onClick: () => handleEditAd(ad) }, 'Edit'),

                    H('button', { className: 'btn', onClick: () => handleToggleAdActive(ad) }, ad.is_active ? 'Deactivate' : 'Activate'),

                    H('button', { className: 'btn danger', onClick: () => handleDeleteAd(ad.id) }, 'Delete')

                  )

                ),

                H('div', { style: { display: 'grid', gap: 8 } },

                  H(AdTile, { ad, cols: 3, preview: true })

                )

              )

            ))

          : H('div', { className: 'muted' }, 'No ads yet.')

        )

    )
  );
}

// NEW: Seller Profile Component
function SellerProfile({ sellerId, sellerUsername, onBack, user, onMessage, onAdminDelete }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('active');
  useEffect(() => {
  let mounted = true;
  
  async function fetchSellerListings() {
    try {
      setLoading(true);
      const items = await api.listByUser(sellerId);
      if (mounted) {
        setListings(asArray(items));
      }
    } catch (e) {
  if (mounted) {
    console.error('Failed to fetch seller listings:', e);
    
    // Check if it's a 404 (user not found)
    if (e.message === 'User not found' || e.message === 'Not found') {
      setError('User not found');
    } else {
      setError('Failed to load listings');
    }
    setListings([]);
  }
} finally {
      if (mounted) {
        setLoading(false);
      }
    }
  }
  if (error) {
  return H('div', { style: { padding: '24px', textAlign: 'center' } },
    H('div', { className: 'muted' }, error),
    H('button', { className: 'btn', onClick: onBack }, '<- Back')
  );
}
  
  if (sellerId) {
    fetchSellerListings();
  }
  
  return () => { mounted = false; };
}, [sellerId]);

  useEffect(() => {
    if (!selectedListing) return;
    const esc = (e) => { if (e.key === 'Escape') setSelectedListing(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [selectedListing]);

  useEffect(() => { setTab('active'); }, [sellerId]);

  if (loading) {
    return H('div', { style: { padding: '24px', textAlign: 'center' } },
      H('div', { className: 'spinner' }),
      H('div', { style: { marginTop: '12px' } }, 'Loading seller profile...')
    );
  }

  const activeListings = listings.filter(l => !l?.sold);
  const soldListings = listings.filter(l => !!l?.sold);
  const shownListings = tab === 'sold' ? soldListings : activeListings;

  return H('div', null,
    H('section', { className: 'card', style: { padding: '16px', margin: '12px 0 16px' } },
      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
        H('div', null,
          H('div', { style: { fontWeight: 800, fontSize: '20px' } }, `@${sellerUsername}'s Listings`),
          H('div', { className: 'muted' }, `Active ${activeListings.length} - Sold ${soldListings.length}`)
        ),
        H('button', { className: 'btn', onClick: onBack }, '<- Back')
      )
    ),

    H('div', { className:'row', style:{ gap:8, margin:'0 0 16px' } },
      H('button', {
        className: `btn ${tab === 'active' ? 'primary' : ''}`,
        type: 'button',
        onClick: () => setTab('active')
      }, 'Active listings'),
      H('button', {
        className: `btn ${tab === 'sold' ? 'primary' : ''}`,
        type: 'button',
        onClick: () => setTab('sold')
      }, 'Sold listings')
    ),

    shownListings.length === 0 
      ? H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, tab === 'sold' ? 'No sold listings yet.' : 'No listings from this seller.')
      : (() => {
          const isMobile = isMobileDevice();
          const COLS = isMobile ? 3 : 4;
          const GAP = 12;
          
          return H('section', {
            style: {
              display: 'grid',
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gap: GAP
            }
          },
            shownListings.map(it => {
              const src = it.image_data || '';
              
              return H('div', { 
                key: it.id, 
                className: 'card', 
                style: { padding: 0, overflow: 'hidden', borderRadius: 8 } 
              },
                H('div', { 
                  style: { 
                    position: 'relative', 
                    width: '100%', 
                    aspectRatio: '1 / 1', 
                    background: '#f3f4f6' 
                  } 
                },
                  src && H('img', {
                    src,
                    alt: it.title || 'Item',
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
                    onClick: () => setSelectedListing({ ...it, image_data: src })
                  }),
                  it.sold ? H('div', {
                    style: {
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none'
                    }
                  },
                    H('div', {
                      style: {
                        transform: 'rotate(-18deg)',
                        padding: '4px 14px',
                        textTransform: 'uppercase',
                        letterSpacing: '6px',
                        fontWeight: 800,
                        fontSize: 22,
                        color: 'rgba(4, 120, 87, 0.85)',
                        border: '3px solid rgba(16, 185, 129, 0.55)',
                        background: 'rgba(229, 255, 244, 0.82)',
                        borderRadius: 999
                      }
                    }, 'Sold')
                  ) : null
                )
              );
            })
          );
        })(),

    // In SellerProfile component, update the modal section:
    selectedListing && H('div', {
      className: 'modal open',
      onClick: (e) => { if (e.target.classList.contains('modal')) setSelectedListing(null); }
    },
      H('div', { className: 'modal-inner listing-modal' },
        H('button', { className: 'close', onClick: () => setSelectedListing(null) }, 'x'),
        H(ListingCard, {
          item: selectedListing,
          user,
          canEdit: false,
          onMessage: (item) => {
            setSelectedListing(null); // Close the modal first
            onMessage(item); // Then trigger the message flow
          },
          onAdminDelete: (id) => {
            setListings(prev => prev.filter(l => l.id !== id));
            setSelectedListing(null);
            onAdminDelete?.(id);
          },
          showDistance: false,
          onViewSeller: null // Don't allow recursive seller viewing
        })
      )
    )
  );
}





  // --- Messages (S3 URLs; supports PASTE + DRAG/DROP attachments) ---
function MessagesPanel({ user, initialActiveId, onSeenChange }) {
  if (!user) return H('div', { className:'muted' }, 'Please log in to view messages.');

  const [convos, setConvos] = useState([]);
  const [activeId, setActiveId] = useState(initialActiveId || null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [imgFiles, setImgFiles] = useState([]); // attachments (File[] for S3 upload)
  const imgPreviews = useFilePreviews(imgFiles);
  const fileRef = useRef();
  const [lb, setLb] = useState({ open:false, images:[], index:0 });
  const pollRef = useRef(null);
  const dropRef = useRef();
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  
  // Add scroll tracking state
  const msgsContainerRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const formatMessageTimestamp = (value) => {
    if (!value) return '';
    const dt = new Date(value);
    if (!Number.isFinite(dt.getTime())) return value;
    return dt.toLocaleString();
  };

  
  // Add ref to track current scroll position to avoid stale closures
  const isAtBottomRef = useRef(isAtBottom);
  
  // Keep ref in sync with state
  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  // Check if scrolled to bottom
  const checkIfAtBottom = () => {
    const container = msgsContainerRef.current;
    if (!container) return;
    const threshold = 50; // pixels from bottom
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setIsAtBottom(atBottom);
  };

  // WebSocket connection - FIXED: removed activeId dependency
  useEffect(() => {
    if (!user) return;
    
    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      console.log('Connecting to WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        clearTimeout(reconnectTimeoutRef.current);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'new_message') {
            // Use functional setState to access current activeId without creating dependency
            setActiveId(currentActiveId => {
              if (data.conversation_id === currentActiveId) {
                // Add new message to current conversation
                setMsgs(prev => [...prev, data.message]);
                
                // Only mark as seen if user is at the bottom of the chat
                if (data.sender_id !== user.id && isAtBottomRef.current) {
                  onSeenChange?.(data.conversation_id, data.message.id);
                }
              }
              
              // Always update conversation list for any new message
              fetchConvos();
              
              return currentActiveId; // Return unchanged activeId
            });
          }
        } catch (e) {
          console.error('WebSocket message error:', e);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event?.code);
        wsRef.current = null;

        // Avoid reconnect loops on policy violations (e.g., missing auth cookie)
        if (event?.code !== 1008) {
          // Reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (user) connectWebSocket();
          }, 3000);
        }
      };
      
      // Send ping every 25 seconds to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
      
      return () => {
        clearInterval(pingInterval);
        ws.close();
      };
    }
    
    connectWebSocket();
    
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user?.id]); // ONLY depend on user.id, not activeId

  // Mark messages as seen when scrolling to bottom
  useEffect(() => {
    if (isAtBottom && msgs.length > 0 && activeId) {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg.sender_id !== user?.id) {
        onSeenChange?.(activeId, lastMsg.id);
      }
    }
  }, [isAtBottom, msgs, activeId, user?.id]);

  function addFiles(filesLike) {
    const MAX_EACH_MB = 20;
    const MAX_EACH = MAX_EACH_MB * 1024 * 1024;
    const MAX_COUNT = 5;
    const next = [...imgFiles];
    for (const f of Array.from(filesLike || [])) {
      if (!f || !f.type?.startsWith?.('image/')) continue;
      if (f.size > MAX_EACH) { alert(`Each image must be under ${MAX_EACH_MB}MB`); continue; }
      if (next.length >= MAX_COUNT) break;
      next.push(f);
    }
    setImgFiles(next);
  }

  function pickImgs(e){
    addFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  }

  function onComposerPaste(e){
    const cd = e.clipboardData;
    if (!cd) return;
    const imageItems = Array.from(cd.items || []).filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItems.length === 0) return; // let normal text paste
    e.preventDefault();

    const files = imageItems
      .map(it => it.getAsFile())
      .filter(Boolean)
      .map(blob => new File([blob], `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}.${(blob.type.split('/')[1]||'png')}`, { type: blob.type }));
    addFiles(files);

    const txt = cd.getData('text/plain');
    if (txt) setInput(v => (v ? v + ' ' : '') + txt);
  }

  function onDragOver(e){ e.preventDefault(); }
  function onDrop(e){ e.preventDefault(); addFiles(e.dataTransfer?.files || []); }
  function removeImg(i){ const n = [...imgFiles]; n.splice(i,1); setImgFiles(n); }
  function openLightbox(images, index=0){ setLb({ open:true, images, index }); }

  useEffect(() => { if (initialActiveId) setActiveId(initialActiveId); }, [initialActiveId]);

  async function fetchConvos(){ try{ setConvos(await api.listConversations({ silent:true })); } catch(_){} }
  async function fetchMsgs(){
    if(!activeId) return;
    try{
      const arr = await api.getMessages(activeId, { silent:true });
      setMsgs(arr);
      if (arr.length) onSeenChange?.(activeId, arr[arr.length-1].id);
    } catch{}
  }

  async function deleteConvo(id) {
    if (!id) return;
    const ok = confirm('Delete this conversation? This removes all messages and images for both participants.');
    if (!ok) return;
    try {
      await api.deleteConversation(id);
      if (activeId === id) setActiveId(null);
      setMsgs([]);
      await fetchConvos();
    } catch (e) { alert(e?.message || 'Delete failed'); }
  }

  useEffect(()=>{ fetchConvos(); }, []);
  useEffect(()=>{
    fetchMsgs();
    // Reduce polling frequency since we have WebSocket for real-time updates
    // Keep some polling as fallback in case WebSocket connection fails
    //if(pollRef.current) clearInterval(pollRef.current);
    //if(activeId){ pollRef.current = setInterval(fetchMsgs, 10000); } // Poll every 10s instead of 2.5s
    //return ()=> pollRef.current && clearInterval(pollRef.current);
  }, [activeId]);

  async function send(){
    const bodyTrim = (input || '').trim();
    if(!bodyTrim && imgFiles.length === 0) return;

    // Upload images to S3 first
    const urls = [];
    for (const f of imgFiles) {
      const url = await uploadOneMessageImage(f);
      urls.push(url);
    }

    await api.sendMessage(activeId, bodyTrim, urls);
    setInput('');
    setImgFiles([]);
    await fetchMsgs();
    await fetchConvos();
    
    // Auto-scroll to bottom after sending
    setTimeout(() => {
      if (msgsContainerRef.current) {
        msgsContainerRef.current.scrollTop = msgsContainerRef.current.scrollHeight;
      }
    }, 100);
  }

  async function revealPaypal() {
    if (!activeId) return;
    if (!user?.paypal_email) { alert('Add your PayPal email in Profile first.'); return; }
    const msg = `My PayPal address: ${user.paypal_email}`;
    await api.sendMessage(activeId, msg, []);
    await fetchMsgs();
    await fetchConvos();
  }

  // ------- FIX: build decorated list first, THEN compute active/canReveal -------
  const seenMap = loadSeen(user?.id);
  const convosDecorated = (convos || [])
    .map(c => {
      const unread = !!(
        c.last_message_id && c.last_message_sender_id &&
        c.last_message_sender_id !== user.id &&
        (!seenMap[c.id] || seenMap[c.id] < c.last_message_id)
      );
      const unreadFromAdmin = unread && !!c.last_message_is_admin;
      return { ...c, _unread: unread, _unreadAdmin: unreadFromAdmin };
    })
    .sort((a,b) => {
      const ua = a._unread ? 1 : 0, ub = b._unread ? 1 : 0;
      if (ub - ua) return ub - ua;
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });

  const active = (convosDecorated.find(c => c.id === activeId) || (convos || []).find(c => c.id === activeId)) || null;

  const canRevealPaypal = !!(
    active &&
    active.listing_id &&
    active.listing_owner_id &&
    user?.id === active.listing_owner_id &&
    user?.paypal_email
  );
  // ---------------------------------------------------------------------------

  return H('div', { className:'split' },
    H('aside', { className:'card sidebar', style:{ padding:12 } },
      H('div', { style: { fontWeight:700, marginBottom:8 } }, 'Conversations'),
      ...(convosDecorated.length ? convosDecorated.map(c => H('div', {
          key:c.id,
          className:'row',
          style:{
            padding:'8px 6px',
            borderRadius:12,
            cursor:'pointer',
            background: c.id===activeId?'#f3f4f6':'transparent',
            position:'relative',
            alignItems:'center',
            gap:8
          },
          onClick:()=>setActiveId(c.id)
        },
        H('div', { style:{ fontWeight:600 } }, c.other_user_username ? '@'+c.other_user_username : 'Unknown'),
        c.listing_title ? H('div', { className:'muted' }, ` - ${c.listing_title?.slice?.(0,24)}`) : null,
        c._unread && H('span', {
          style:{ marginLeft:'auto', width:8, height:8, borderRadius:8, background: c._unreadAdmin ? '#111' : '#ef4444' }
        }),
        H('button', {
          title:'Delete conversation',
          'data-testid':'dm-delete',
          onClick:(e)=>{ e.stopPropagation(); deleteConvo(c.id); },
          style:{
            marginLeft: c._unread ? 6 : 'auto',
            width:22, height:22,
            lineHeight:'20px',
            borderRadius:10,
            border:'1px solid #fee2e2',
            background:'#fff5f5',
            color:'#b91c1c',
            fontWeight:800,
            display:'grid',
            placeItems:'center',
            cursor:'pointer'
          }
        }, 'x')
      )) : [H('div', { key:'empty', className:'muted' }, 'No conversations yet')])
    ),

    H('section', { className:'card col', style:{ padding:12, display:'flex', flexDirection:'column' } },
      !activeId && H('div', { className:'muted' }, 'Select a conversation'),

      activeId && H('div', { 
        ref: msgsContainerRef,
        style:{ flex:1, overflow:'auto', padding:4 },
        onScroll: checkIfAtBottom
      },
        msgs.map(m => {
          const ts = formatMessageTimestamp(m.created_at || m.updated_at);
          return H('div', { key:m.id, className:`message ${m.sender_id===user.id?'mine':'their'}` },
            m.body && H('div', null, m.body),
            Array.isArray(m.images) && m.images.length > 0 &&
              H('div', { className:'row', style:{ gap:6, marginTop:6, flexWrap:'wrap' } },
                ...m.images.map((src, i) =>
                  H('img', { key:i, src, loading:'lazy', decoding:'async', style:{ width:140, height:140, objectFit:'cover', borderRadius:10, border:'1px solid #e5e7eb', cursor:'zoom-in' },
                    onClick:()=>openLightbox(m.images, i) })
                )
              ),
            ts && H('div', { className:'muted', style:{ fontSize:11, marginTop:6, textAlign: m.sender_id===user.id ? 'right' : 'left' } }, ts)
          );
        })
      ),

      (activeId && imgPreviews.length > 0) && H('div', { className:'row', style:{ gap:6, flexWrap:'wrap', margin:'6px 0' } },
        ...imgPreviews.map(({ url },i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H('img', { src: url, style:{ width:72, height:72, objectFit:'cover', borderRadius:10, border:'1px solid #e5e7eb' } }),
            H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:2, right:2, padding:'2px 6px' }, onClick:()=>removeImg(i) }, 'x')
          )
        )
      ),

      activeId && H('div', {
        className:'row',
        style:{ alignItems:'flex-end', gap:8 },
        ref: dropRef,
        onDragOver,
        onDrop
      },
        H('input', {
          type:'file', accept:'image/*', multiple:true, ref:fileRef, onChange: pickImgs,
          style:{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }
        }),
        H(AttachButton, { onClick: () => fileRef.current && fileRef.current.click() }),
        H('textarea', {
          placeholder:'Type a message...  (Tip: paste or drag images)',
          value:input,
          rows:2,
          onPaste:onComposerPaste,
          onChange:e=>setInput(e.target.value),
          onKeyDown:e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } },
          style:{ flex:1, resize:'vertical' }
        }),
        canRevealPaypal && H('button', { className:'btn', onClick: revealPaypal }, 'Reveal PayPal address'),
        H('button', { className:'btn primary', onClick:send }, 'Send')
      ),

      H(Lightbox, {
        open: lb.open,
        images: lb.images,
        fallback: lb.images,
        loading: false,
        index: lb.index,
        onClose: ()=> setLb({ open:false, images:[], index:0 }),
        onIndex: (i)=> setLb(s=>({ ...s, index:i }))
      })
    )
  );
}

  // --- Nearby Panel (unchanged) ---
  function NearbyPanel({ user, mineById, onEdit, onDelete, onMessage, onAdminDelete, setTab, onViewSeller, onToggleSold }) {
    const [radius, setRadius] = useState(150);
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [lastUpdatedLabel, setLastUpdatedLabel] = useState('');
    const storedCoords = useMemo(() => {
      try {
        const raw = localStorage.getItem('listit_nearby_coords');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const lat = Number(parsed?.lat);
        const lon = Number(parsed?.lon);
        const ts = Number(parsed?.ts) || 0;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return { lat, lon, ts };
        }
      } catch {}
      return null;
    }, []);
    const coordsRef = useRef(storedCoords ? { lat: storedCoords.lat, lon: storedCoords.lon } : null);
    const coordsTsRef = useRef(storedCoords?.ts || 0);
    const abortRef = useRef(null);

    // NEW: masonry container ref + live column-count
    const masonRef = useRef(null);
    const [nearbyCols, setNearbyCols] = useState(3);
    useEffect(() => {
      if (!masonRef.current) return;
      const el = masonRef.current;

      const readCols = () => {
        const cs = getComputedStyle(el);
        const n = parseInt(cs.columnCount, 10);
        setNearbyCols(Number.isFinite(n) && n > 0 ? n : 3);
      };
      readCols();

      const ro = new ResizeObserver(readCols);
      ro.observe(el);
      window.addEventListener('resize', readCols);
      return () => { ro.disconnect(); window.removeEventListener('resize', readCols); };
    }, []);

    // NEW: interleave helper (row-wise ordering for CSS column masonry)
    const interleaved = useMemo(() => {
      const arr = items || [];
      if (!Array.isArray(arr) || arr.length === 0 || nearbyCols <= 1) return arr;
      const out = [];
      for (let c = 0; c < nearbyCols; c++) {
        for (let i = c; i < arr.length; i += nearbyCols) out.push(arr[i]);
      }
      return out;
    }, [items, nearbyCols]);

    const ensureCoords = useCallback(async (force = false) => {
      const cached = coordsRef.current;
      const now = Date.now();
      if (!force && cached && (now - coordsTsRef.current) < 120000) {
        return cached;
      }
      if (!('geolocation' in navigator)) {
        if (cached) return cached;
        throw new Error('geolocation_unsupported');
      }
      try {
        const position = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy:true,
            timeout:8000,
            maximumAge:60000
          })
        );
        const out = { lat: position.coords.latitude, lon: position.coords.longitude };
        coordsRef.current = out;
        coordsTsRef.current = Date.now();
        try { localStorage.setItem('listit_nearby_coords', JSON.stringify({ ...out, ts: coordsTsRef.current })); } catch {}
        return out;
      } catch (err) {
        if (!force && cached) return cached;
        throw err;
      }
    }, []);

    const load = useCallback(async (forceLocation = false) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setErrorMsg('');
      try {
        const coords = await ensureCoords(forceLocation);
        if (!coords) throw new Error('location_unavailable');
        const res = await api.listNearby(coords.lat, coords.lon, radius, { silent:true, signal: controller.signal });
        if (abortRef.current !== controller) return;
        setItems(Array.isArray(res) ? res : []);
        setLastUpdatedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Nearby load failed:', err);
        let message = 'Could not load nearby listings.';
        if (err?.message === 'geolocation_unsupported') {
          message = 'Geolocation not supported in this browser.';
        } else if (typeof err?.code === 'number') {
          if (err.code === 1) message = 'Location permission denied.';
          else if (err.code === 2) message = 'Unable to determine your location.';
          else if (err.code === 3) message = 'Location lookup timed out.';
        } else if (err?.message === 'location_unavailable') {
          message = 'Location unavailable.';
        }
        if (abortRef.current === controller) {
          setItems([]);
          setErrorMsg(message);
          setLastUpdatedLabel('');
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    }, [ensureCoords, radius]);

    useEffect(() => {
      load(false);
      return () => {
        if (abortRef.current) abortRef.current.abort();
      };
    }, [load]);

    const esc = (e)=> { if(e.key==='Escape') setSelected(null); };
    useEffect(()=>{ if(selected){ window.addEventListener('keydown', esc); return ()=> window.removeEventListener('keydown', esc); }}, [selected]);

    function handleEdit(it) {
      setSelected(null);
      setTab('browse');
      onEdit(it);
    }

    return H('div', { id: 'tab-nearby' },
      H('section', { className:'card', style:{ padding:12, margin:'12px 0 16px' } },
        H('div', { className:'row', style:{ gap:10, alignItems:'center', flexWrap:'wrap' } },
        H('label', { htmlFor:'radius' }, 'Filter radius:'),
        H('select', {
          id:'radius',
          value: radius,
          onChange: e => setRadius(Number(e.target.value)),
          style:{ width:'auto' }
        },
          H('option', { value:150 }, '~500 ft'),
          H('option', { value:402 }, '0.25 mi'),
          H('option', { value:805 }, '0.5 mi'),
          H('option', { value:1609 }, '1 mi')
        ),
        H('button', { className:'btn', onClick: () => load(true), disabled:busy }, busy ? 'Refreshing...' : 'Reload'),
        lastUpdatedLabel && H('span', { className:'muted', style:{ marginLeft:'auto', fontSize:11 } }, lastUpdatedLabel)
      ),

      errorMsg && H('div', { className:'muted', style:{ color:'#b91c1c', marginTop:8, fontSize:12 } }, errorMsg),

      // NOTE: add ref so we can read computed column-count
      H('section', { className:'masonry', ref: masonRef },
        interleaved.map(item =>
          H('div', { key:item.id, className:'masonry-item' },
            H('img', {
              src: item.image_data,
              loading:'lazy',
              decoding:'async',
              onClick: () => setSelected(item),
              style: { cursor: 'pointer' }
            })
          )
        )
      ),

      (!items.length && !busy && !errorMsg) && H('p', { className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No nearby listings found in this radius.'),

      selected && H('div', { className:'modal open', onClick:(e)=>{ if(e.target.classList.contains('modal')) setSelected(null); } },
        H('div', { className:'modal-inner listing-modal' },
          H('button', { className:'close', onClick:()=>setSelected(null) }, 'x'),
          H(ListingCard, {
            item: selected,
            user,
            canEdit: !!mineById[selected.id],
            onEdit: handleEdit,
            onDelete,
            onMessage,
            onAdminDelete,
            showDistance: true,
            onViewSeller,
            onToggleSold
          })
        )
      )
      )
    );
  }

  // --- MassList Modal (fixed) ---
  function MassListModal({ onClose, onDone, reloadAll, reloadMine, user, autoPostNearbyEnabled, onLockedAction }) {
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
    const filePreviews = useFilePreviews(files);

    const fileRef = useRef();

    function pick(e){
      const MAX_EACH_MB = 20;
      const selected = Array.from(e.target.files || []);
      const next = [...files];
      for (const f of selected) {
        if (!f.type?.startsWith?.('image/')) { alert('Only images are allowed'); continue; }
        if (f.size > MAX_EACH_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_EACH_MB}MB`); continue; }
        next.push(f);
      }
      setFiles(next);
      if (fileRef.current) fileRef.current.value = '';
    }
    function removeAt(i){
      const next=[...files];
      const [removed] = next.splice(i,1);
      if (removed) clearDraftCacheForFile(removed);
      setFiles(next);
    }

    async function runMassList(){
      if (!user) { alert('Log in to create listings.'); return; }
      if (user.account_status === 'locked') { onLockedAction?.(); return; }
      if (!files.length) { alert('Pick at least one image.'); return; }
      setBusy(true);
      setProgress({ done: 0, total: files.length, failed: 0 });

      let failed = 0;

      let sharedNearby = { ok:false, lat:null, lon:null, display:'' };
      if (autoPostNearbyEnabled) {
        try {
          const c = await fetchCoordsAndReverse();
          sharedNearby = { ok:true, lat:c.lat, lon:c.lon, display:c.display };
        } catch (_) {
          sharedNearby = { ok:false, lat:null, lon:null, display:'' };
        }
      }

      const limiter = createConcurrencyLimiter(3);

      const jobs = files.map((f) => limiter(async () => {
        let encounteredError = false;
        try {
          const upload = await uploadFileDraft(f);

          let ai = {};
          let aiDescription = '';
          try {
            ai = await api.aiAnalyze({ images: [upload.publicUrl], hint: '' }, { silent:true }) || {};
          } catch (_) {
            /* ignore AI failure; fallback below */
          }

          const safePrice = (Number.isFinite(ai.suggested_price) && ai.suggested_price >= 0) ? ai.suggested_price : 0;
          if (typeof ai.description === 'string' && ai.description.trim()) {
            aiDescription = ai.description.trim().slice(0, 400);
          }
          const payload = {
            title: (ai.title || 'Item for sale').toString().slice(0, 80),
            description: aiDescription || 'No description',
            location: sharedNearby.ok ? sharedNearby.display : '',
            price: safePrice,
            tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
            enable_nearby: sharedNearby.ok ? 1 : 0,
            upload_tokens: [upload.uploadToken]
          };
          if (sharedNearby.ok) { payload.lat = sharedNearby.lat; payload.lon = sharedNearby.lon; }

          const created = await api.createListing(payload);
          if (!created?.id) throw new Error('create_failed');

        } catch (err) {
          encounteredError = true;
          failed += 1;
          console.error('MassList failed:', err);
        } finally {
          setProgress((p) => ({ ...p, done: p.done + 1, failed }));
        }

        return !encounteredError;
      }));

      await Promise.allSettled(jobs);

      try { await reloadMine(); } catch {}
      try { await reloadAll(); } catch {}

      setBusy(false);

      const stats = { total: files.length, created: files.length - failed, failed };
      onDone && onDone(stats);
      onClose && onClose();
    }

    const modal = H('div', { className:'modal open', onClick:(e)=>{ if(e.target.classList.contains('modal')) onClose(); } },
      H('div', { className:'modal-inner', style:{ width:'min(680px, 92vw)', background:'#fff', borderRadius:24, overflow:'hidden' } },
        H('button', { className:'close', onClick:onClose }, 'x'),
        H('div', { style:{ padding:16 } },
          H('div', { style:{ fontWeight:800, fontSize:18, marginBottom:6 } }, 'MassList'),
          H('div', { className:'muted', style:{ marginBottom:12 } }, 'Pick multiple photos from your gallery. We will create one listing per photo using AI for title, tags, and price (you can edit later).'),

          H('div', { className:'row', style:{ gap:8, alignItems:'center' } },
            H('input', { type:'file', accept:'image/*', multiple:true, ref:fileRef, onChange: pick }),
            H('span', { className:'muted' }, `${files.length} selected`)
          ),

          filePreviews.length > 0 && H('div', { className:'row', style:{ gap:8, flexWrap:'wrap', marginTop:12 } },
            ...filePreviews.map(({ url },i) =>
              H('div', { key:i, style:{ position:'relative' } },
                H('img', { src: url, style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #e5e7eb' }, loading:'lazy', decoding:'async' }),
                H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, onClick:()=>removeAt(i) }, 'x')
              )
            )
          ),

          H('div', { className:'row', style:{ marginTop:16 } },
            H('button', { className:'btn', onClick:onClose, disabled:busy }, 'Cancel'),
            H('button', { className:`btn primary`, onClick:runMassList, disabled:busy || files.length===0 }, busy ? 'Working...' : 'Confirm MassList')
          )
        ),

        // Progress overlay
        busy && H('div', {
          style:{
            position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
            display:'grid', placeItems:'center', zIndex:10, textAlign:'center', padding:'16px'
          }
        },
          H('div', null,
            H('div', { className:'spinner' }),
            H('div', { style:{ fontWeight:800, marginTop:6 } }, 'MassList in progress...'),
            H('div', { className:'muted', style:{ marginTop:4 } }, `${progress.done}/${progress.total} completed`),
            progress.failed>0 && H('div', { className:'muted', style:{ marginTop:2, color:'#b91c1c' } }, `${progress.failed} failed`)
          )
        )
      )
    );

    return ReactDOM.createPortal(modal, document.body);
  }

  // --- Profile Panel (unchanged; defined to avoid "ProfilePanel is not defined") ---
  function ProfilePanel({
    user, items, onNewListing, onEdit, onDelete, onLogout, onAdminDelete,
    autoListEnabled, setAutoListEnabled,
    autoPostNearbyEnabled, setAutoPostNearbyEnabled,
    isMobile,
    onViewSeller, // ADD THIS PARAMETER
    onToggleSold
  }) {
    const [showHelp, setShowHelp] = useState(false);
    const [profileSelected, setProfileSelected] = useState(null);

    useEffect(() => {
      if (!profileSelected) return;
      const esc = (e) => { if (e.key === 'Escape') setProfileSelected(null); };
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    }, [profileSelected]);

    const handleEdit = useCallback((it) => {
      setProfileSelected(null);
      onEdit?.(it);
    }, [onEdit]);

    const handleDelete = useCallback(async (it) => {
      if (onDelete) await onDelete(it);
      setProfileSelected(null);
    }, [onDelete]);

    const handleAdminDelete = useCallback(async (id) => {
      if (onAdminDelete) await onAdminDelete(id);
      setProfileSelected(null);
    }, [onAdminDelete]);
    const [profileTab, setProfileTab] = useState('active');

    const [paypalEmail, setPaypalEmail] = useState(user?.paypal_email || '');
    async function savePaypal() {
      const r = await api.updatePaypalEmail((paypalEmail || '').trim());
      if (r?.error) { alert(r.error); return; }
      // refresh global user so Messages sees the latest email
      const me = await api.me({ silent:true });
      AppNav.setUser(me);
      alert('Saved.');
    }

    if (!user) {
      return H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
        H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 'Profile'),
        H('div', { className: 'muted' }, 'Please log in to view your profile.')
      );
    }

    const activeItems = asArray(items).filter(it => !it?.sold);
    const soldItems = asArray(items).filter(it => !!it?.sold);
    const shownItems = profileTab === 'sold' ? soldItems : activeItems;

    return H(React.Fragment, null,
      H('section', { className:'card', style:{ padding:16, margin:'12px 0 16px' } },
        H('div', { className:'row', style:{ justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 } },
          H('div', null,
            H('div', { style:{ fontWeight:800, fontSize:18 } }, user.username ? `@${user.username}` : user.email),
            H('div', { className:'muted' }, 'Your account')
          ),
          // Right controls: Auto-list toggle - New listing - Log out
          H('div', { className:'row', style:{ gap:12, alignItems:'center', flexWrap:'wrap' } },
            H('label', { className:'row', style:{ gap:8, alignItems:'center', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:12 } },
              H('input', {
                type:'checkbox',
                checked: !!autoListEnabled,
                onChange: (e) => setAutoListEnabled(e.target.checked),
                style:{ width:18, height:18 }
              }),
              H('div', null,
                H('div', { style:{ fontWeight:700 } }, 'Auto-list'),
                H('div', { className:'muted', style:{ fontSize:12, marginTop:2 } }, 'new uploads')
              ),
              H('button', {
                type:'button',
                onClick: () => setShowHelp(true),
                title:'About Auto-list',
                style:{
                  marginLeft:6, width:24, height:24, lineHeight:'22px',
                  borderRadius:12, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer'
                }
              }, '?')
            ),
            H('button', { className:'btn', onClick:onNewListing }, 'New listing'),
            H('button', { className:'btn danger', onClick:onLogout }, 'Log out')
          )
        ),

        // Slide-out child when parent is on (mobile-only)
        (isMobile && H('div', {
            style: {
              marginTop: 10,
              overflow: 'hidden',
              maxHeight: autoListEnabled ? 120 : 0,
              transition: 'max-height 220ms ease'
            }
          },
            H('div', { className:'row', style:{ gap:8, alignItems:'center', padding:'8px 10px', border:'1px dashed #e5e7eb', borderRadius:12, background:'#fafafa' } },
              H('input', {
                type:'checkbox',
                checked: !!autoPostNearbyEnabled,
                onChange: (e) => setAutoPostNearbyEnabled(e.target.checked),
                disabled: !autoListEnabled,
                style:{ width:18, height:18 }
              }),
              H('div', null,
                H('div', { style:{ fontWeight:700 } }, 'Also post to Nearby'),
                H('div', { className:'muted', style:{ fontSize:12, marginTop:2 } }, 'Auto-created items will be discoverable in Nearby (asks for your location once).')
              )
            )
          ))),
      H('section', null,
        H('div', { className:'row', style:{ justifyContent:'space-between', margin:'0 0 12px', flexWrap:'wrap' } },
          H('section', { style:{ marginTop:12 } },
            H('label', null, 'PayPal email'),
            H('div', { className:'row', style:{ gap:8, alignItems:'center', flexWrap:'wrap' } },
              H('input', {
                value: paypalEmail,
                onChange: e => setPaypalEmail(e.target.value),
                placeholder: 'name@example.com',
                style:{ minWidth: 260 }
              }),
              H('button', { className:'btn', onClick: savePaypal }, 'Save')
            ),
            H('div', { className:'muted', style:{ fontSize:12, marginTop:4 } },
              'When you press "Reveal PayPal address" in a DM, the email you save here will be sent as a normal message.'
            )
          ),

          H('div', { style:{ fontWeight:800 } }, `Your listings`),
          H('div', { className:'muted' }, `Active ${activeItems.length} - Sold ${soldItems.length}`)
        ),
        H('div', { className:'row', style:{ gap:8, margin:'0 0 16px' } },
          H('button', {
            className: `btn ${profileTab === 'active' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setProfileTab('active')
          }, 'Active listings'),
          H('button', {
            className: `btn ${profileTab === 'sold' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setProfileTab('sold')
          }, 'Sold listings')
        ),
        (shownItems.length
          ? (() => {
              const COLS = isMobile ? 3 : 4;
              const GAP = 12;
              return H('section', {
                style: {
                  display: 'grid',
                  gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                  gap: GAP
                }
              },
                shownItems.map(it => {
                  const src = it.image_data || '';
                  return H('div', {
                    key: it.id,
                    className: 'card',
                    style: { padding: 0, overflow: 'hidden', borderRadius: 8, cursor: 'pointer' },
                    onClick: () => setProfileSelected(it)
                  },
                    H('div', {
                      style: {
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '1 / 1',
                        background: '#f3f4f6'
                      }
                    },
                      src ? H('img', {
                        src,
                        alt: it.title || 'Item',
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
                        }
                      }) : H('div', {
                        style: {
                          position: 'absolute',
                          inset: 0,
                          display: 'grid',
                          placeItems: 'center',
                          color: '#6b7280',
                          fontWeight: 600
                        }
                      }, 'No image'),
                      it.sold ? H('div', {
                        style: {
                          position: 'absolute',
                          top: '22%',
                          left: '50%',
                          transform: 'translateX(-50%) rotate(-12deg)',
                          background: 'rgba(5, 150, 105, 0.92)',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 20,
                          letterSpacing: 4,
                          textTransform: 'uppercase',
                          padding: '6px 24px',
                          borderRadius: 999,
                          pointerEvents: 'none',
                          boxShadow: '0 8px 18px rgba(4,120,87,0.35)'
                        }
                      }, 'Sold') : null
                    )
                  );
                })
              );
            })()
          : H('p', {
              className:'muted',
              style:{ textAlign:'center', margin:'28px 0' }
            }, profileTab === 'sold' ? 'No sold listings yet.' : 'No listings yet. Create your first one!')
        )
      ),

      showHelp && H(AutoListHelpModal, { onClose: () => setShowHelp(false) }),

      profileSelected && H('div', {
        className:'modal open',
        onClick: (e) => { if (e.target.classList.contains('modal')) setProfileSelected(null); }
      },
        H('div', { className: 'modal-inner listing-modal' },
          H('button', { className: 'close', onClick: () => setProfileSelected(null) }, 'x'),
          H(ListingCard, {
            item: profileSelected,
            user,
            canEdit: true,
            onEdit: handleEdit,
            onDelete: handleDelete,
            onAdminDelete: handleAdminDelete,
            onViewSeller,
            onToggleSold,
            showDistance: false
          })
        )
      )
    );
  }

  // ---------- App ----------
  const PAGE_SIZE = 75;

// Add this new component BEFORE the ListingForm component definition
// --- Listing Form Modal ---
// --- Listing Form Modal ---
function ListingFormModal({ isOpen, draft, onClose, onSaved, autoListEnabled, autoPostNearbyEnabled }) {
  if (!isOpen) return null;
  
  const isMobile = isMobileDevice();
  const [showTags, setShowTags] = useState(false);

  const modal = H('div', { 
    className: 'modal open', 
    onClick: (e) => { if (e.target.classList.contains('modal')) onClose(); }
  },
    H('div', { 
      className: 'modal-inner', 
      style: isMobile ? {
        // Mobile: Compact centered modal
        width: '90vw',
        maxWidth: '380px',
        maxHeight: '80vh',
        background: '#fff',
        borderRadius: 16,
        overflow: 'auto',
        margin: 'auto',
        position: 'relative'
      } : {
        // Desktop: unchanged
        width: 'min(680px, 92vw)',
        background: '#fff',
        borderRadius: 24,
        overflow: 'auto',
        maxHeight: '90vh',
        marginTop: '5vh',
        marginBottom: '5vh'
      }
    },
      H('button', { 
        className: 'close', 
        onClick: onClose,
        style: isMobile ? {
          position: 'absolute',
          top: '6px',
          right: '6px',
          zIndex: 10,
          width: '26px',
          height: '26px',
          padding: '0',
          fontSize: '16px',
          lineHeight: '24px',
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(255,255,255,0.9)',
          borderRadius: '13px'
        } : {}
      }, 'x'),
      
      H('div', { style: { padding: isMobile ? '10px' : '16px' } },
        H('div', { style: { 
          fontWeight: 800, 
          fontSize: isMobile ? 15 : 18, 
          marginBottom: isMobile ? 6 : 12
        } }, 
          draft ? 'Edit Listing' : 'New Listing'
        ),
        
        !isMobile && H('div', { className: 'muted', style: { marginBottom: 12 } }, 
          'Add photos and details for your listing. Only images are required - AI can suggest the rest.'
        ),
        
        isMobile ? H(CompactListingForm, { 
          draft, 
          onCancel: onClose, 
          onSaved: () => { onSaved?.(); onClose(); },
          autoListEnabled,
          autoPostNearbyEnabled,
          showTags,
          setShowTags
        }) : H(ListingForm, { 
          draft, 
          onCancel: onClose, 
          onSaved: () => { onSaved?.(); onClose(); },
          autoListEnabled,
          autoPostNearbyEnabled
        })
      )
    )
  );

  return ReactDOM.createPortal(modal, document.body);
}

// --- Compact Listing Form for Mobile ---
function CompactListingForm({ draft, onCancel, onSaved, autoListEnabled, autoPostNearbyEnabled, showTags, setShowTags }) {
  const fileRef = useRef();
  const [files, setFiles] = useState([]);
  const [existingUrls, setExistingUrls] = useState([]);
  const [originalUrls, setOriginalUrls] = useState([]);
  const filePreviews = useFilePreviews(files);
  
  const [title, setTitle] = useState(draft?.title || '');
  const [description, setDescription] = useState(draft?.description || '');
  const [location, setLocation] = useState(draft?.location || '');
  const [priceVal, setPriceVal] = useState(draft?.price?.toString?.() || '');
  const [tags, setTags] = useState(() => {
    if (!draft?.tags) return '';
    if (Array.isArray(draft.tags)) return draft.tags.join(', ');
    return String(draft.tags);
  });
  
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const autoRunning = useRef(false);
  const [autoBusy, setAutoBusy] = useState(false);
  
  const hasFixedGps = !!draft?.lat;
  const [enableNearby, setEnableNearby] = useState(!!draft?.enable_nearby);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const [lat, setLat] = useState(draft?.lat ?? null);
  const [lon, setLon] = useState(draft?.lon ?? null);

  // File picker handler
  function pickFiles(e) {
    const MAX_MB = 20;
    const selected = Array.from(e.target.files || []);
    const next = [...files];
    for (const f of selected) {
      if (f.size > MAX_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_MB}MB`); continue; }
      if (!f.type.startsWith('image/')) { alert('Only images are allowed'); continue; }
      next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeFile(i) {
    const next = [...files];
    const [removed] = next.splice(i, 1);
    if (removed) clearDraftCacheForFile(removed);
    setFiles(next);
  }

  // Load current images
  useEffect(() => {
    (async () => {
      if (draft?.id) {
        try { 
          const arr = await api.getListingImages(draft.id); 
          setExistingUrls(arr || []);
          setOriginalUrls(arr || []);
        }
        catch { 
          setExistingUrls([]); 
          setOriginalUrls([]);
        }
      } else {
        setExistingUrls([]);
        setOriginalUrls([]);
      }
    })();
  }, [draft?.id]);

  async function runAI(){
    setAiErr('');
    setAiBusy(true);
    try {
      const sources = [];

      if (files.length) {
        for (const file of files) {
          if (sources.length >= AI_IMAGE_LIMIT) break;
          try {
            const upload = await uploadFileDraft(file);
            if (upload?.publicUrl) sources.push(upload.publicUrl);
          } catch (err) {
            console.error('AI draft upload failed:', err);
          }
        }
      }

      if (sources.length < AI_IMAGE_LIMIT && existingUrls.length) {
        for (const url of existingUrls) {
          if (sources.length >= AI_IMAGE_LIMIT) break;
          if (typeof url === 'string' && url.trim()) {
            sources.push(url);
          }
        }
      }

      if (!sources.length) {
        alert('No images available for AI analysis.');
        return;
      }

      const res = await api.aiAnalyze({
        images: sources.slice(0, AI_IMAGE_LIMIT),
        hint: `${title} ${description}`.trim()
      });

      if (res.title) setTitle(res.title);
      if (Array.isArray(res.tags)) setTags(res.tags.join(', '));
      if (typeof res.suggested_price === 'number' && !Number.isNaN(res.suggested_price)) {
        setPriceVal(String(res.suggested_price));
      }
      if (typeof res.description === 'string' && res.description.trim()) {
        setDescription(res.description.trim().slice(0, 400));
      }
    } catch (e) { 
      setAiErr(e.message || 'AI failed'); 
    } finally { 
      setAiBusy(false); 
    }
  }

  async function useMyLocation() {
    setGeoErr('');
    if (!('geolocation' in navigator)) { setGeoErr('Geolocation not supported'); return; }
    setGeoBusy(true);
    try {
      const coords = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
          err => rej(err),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        )
      );
      const r = await api.reverseGeocode(coords.lat, coords.lon);
      setLocation(r?.display || `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
      setLat(r?.lat ?? coords.lat);
      setLon(r?.lon ?? coords.lon);
    } catch { setGeoErr('Could not get your location'); }
    finally { setGeoBusy(false); }
  }

  // Auto-list effect
  useEffect(() => {
    if (!autoListEnabled) return;
    if (draft) return;
    if (!files || files.length === 0) return;
    if (autoRunning.current) return;

    (async () => {
      autoRunning.current = true;
      setAutoBusy(true);
      try {
        const uploads = await Promise.all(files.map(uploadFileDraft));
        if (!uploads.length) throw new Error('No images to upload');

        let ai = {};
        let aiDescription = '';
        try {
          const aiSources = uploads.map((u) => u.publicUrl).filter(Boolean).slice(0, AI_IMAGE_LIMIT);
          if (aiSources.length) {
            ai = await api.aiAnalyze({ images: aiSources, hint: '' }, { silent:true }) || {};
          }
        } catch (_) {}

        const parsedPrice = Number(ai.suggested_price);
        const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

        if (typeof ai.description === 'string' && ai.description.trim()) {
          aiDescription = ai.description.trim().slice(0, 400);
        }

        let enableNearbyAuto = 0, latAuto = null, lonAuto = null, locAuto = '';
        if (autoPostNearbyEnabled) {
          try {
            const c = await fetchCoordsAndReverse();
            enableNearbyAuto = 1;
            latAuto = c.lat; lonAuto = c.lon; locAuto = c.display;
          } catch (_) {
            enableNearbyAuto = 0;
          }
        }

        const payload = {
          title: (ai.title || 'Item for sale').toString().slice(0, 80),
          description: aiDescription || 'No description',
          location: locAuto || '',
          price: safePrice,
          tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
          enable_nearby: enableNearbyAuto,
          upload_tokens: uploads.map((u) => u.uploadToken)
        };
        if (enableNearbyAuto) { payload.lat = latAuto; payload.lon = lonAuto; }

        const created = await api.createListing(payload);
        if (!created?.id) throw new Error('Create failed');

        onSaved?.();
      } catch (err) {
        console.error('Auto-list failed:', err);
        alert(`Auto-list failed: ${err?.message || err}`);
      } finally {
        setAutoBusy(false);
      }
    })();
  }, [autoListEnabled, autoPostNearbyEnabled, draft, files]);

  async function submit(e){
    e.preventDefault();
    try {
      const totalImages = existingUrls.length + files.length;
      if (totalImages === 0) {
        alert('Please add at least one image.');
        return;
      }

      const parsedPrice = Number(priceVal);
      const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

      const payload = {
        title: String(title || '').trim(),
        description: String(description || 'No description').trim(),
        location: String(location || '').trim(),
        price: safePrice,
        tags: String(tags || '').trim(),
        enable_nearby: enableNearby ? 1 : 0,
      };
      
      if (enableNearby && !hasFixedGps) { 
        payload.lat = lat; 
        payload.lon = lon; 
      }
      
      if (payload.enable_nearby && !hasFixedGps && (payload.lat == null || payload.lon == null)) {
        alert('Enable Nearby requires using your location.');
        return;
      }

      if (draft) {
        const deletedImages = originalUrls.filter(url => !existingUrls.includes(url));
        if (deletedImages.length > 0) {
          payload.deletedImages = deletedImages;
        }
        await api.updateListing(draft.id, payload);
        if (files.length) await uploadFilesForListing(draft.id, files);
      } else {
        let uploads = [];
        if (files.length) {
          uploads = await Promise.all(files.map(uploadFileDraft));
          const tokens = uploads.map((u) => u.uploadToken).filter(Boolean);
          if (!tokens.length) {
            throw new Error('Image upload failed');
          }
          payload.upload_tokens = tokens;
        }

        const created = await api.createListing(payload);
        if (!created?.id) { throw new Error('Create failed'); }
      }
      onSaved?.();
    } catch (err) {
      console.error('Create/save failed:', err);
      alert(`Create/save failed: ${err?.message || err}`);
    }
  }

  const isFree = !priceVal || !Number.isFinite(Number(priceVal)) || Number(priceVal) === 0;

  return H('form', { 
    onSubmit: submit, 
    className:'row', 
    style:{
      flexDirection:'column', 
      gap: 5,
      position:'relative'
    }
  },
    autoBusy && H('div', {
      style:{
        position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
        display:'grid', placeItems:'center', zIndex:5, borderRadius:12
      }
    }, H('div', null, H('div', {className:'spinner'}), H('div', {style:{marginTop:6, fontWeight:700}}, 'Auto-listing...'))),

    // Compact file picker
    H('div', null,
      H('input', { 
        type:'file', 
        accept:'image/*', 
        multiple:true, 
        ref:fileRef, 
        onChange: pickFiles,
        style: { fontSize: '13px' }
      }),
      filePreviews.length > 0 && H('div', { 
        className:'row', 
        style:{ gap:3, flexWrap:'wrap', marginTop:3 } 
      },
        ...filePreviews.map(({ url },i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H('img', { 
              src: url, 
              style:{ width:44, height:44, objectFit:'cover', borderRadius:6, border:'1px solid #ddd' } 
            }),
            H('button', { 
              className:'btn danger', 
              type:'button', 
              style:{ position:'absolute', top:-2, right:-2, padding:'0px 3px', fontSize:9, lineHeight:'12px' }, 
              onClick:()=>removeFile(i) 
            }, 'x')
          )
        )
      )
    ),

    (existingUrls.length > 0) && H('div', null,
      H('div', { className:'muted', style:{ fontSize:11, marginBottom:2 } }, 'Current:'),
      H('div', { className:'row', style:{ gap:3, flexWrap:'wrap' } },
        ...existingUrls.map((src, i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H('img', { src, style:{ width:44, height:44, objectFit:'cover', borderRadius:6, border:'1px solid #ddd' } }),
            H('button', { 
              className:'btn danger', 
              type:'button', 
              style:{ position:'absolute', top:-2, right:-2, padding:'0px 3px', fontSize:9, lineHeight:'12px' }, 
              onClick:() => {
                const next = [...existingUrls];
                next.splice(i, 1);
                setExistingUrls(next);
              }
            }, 'x')
          )
        )
      )
    ),

    H('button', { 
      type:'button', 
      className:`btn ${aiBusy?'':'primary'}`, 
      disabled:aiBusy, 
      onClick:runAI,
      style: { width: '100%', padding: '8px', fontSize: '13px' }
    }, aiBusy ? 'Analyzing...' : 'Run AI analysis'),
    
    aiErr && H('span', { className:'muted', style:{ color:'#b91c1c', fontSize:11 } }, aiErr),

    H('input', { 
      value:title, 
      maxLength:80, 
      onChange:e=>setTitle(e.target.value), 
      placeholder:'Title (optional)',
      style: { fontSize: '13px', padding: '7px' }
    }),
    
    H('textarea', { 
      value:description, 
      maxLength:400, 
      rows: 2,
      onChange:e=>setDescription(e.target.value), 
      placeholder:'Description (optional)',
      style: { fontSize: '13px', padding: '7px', resize: 'none' }
    }),
    
    H('input', { 
      value:location, 
      maxLength:80, 
      onChange:e=>setLocation(e.target.value), 
      placeholder:'Location (optional)',
      style: { fontSize: '13px', padding: '7px' }
    }),
    
    H('button', { 
      type:'button', 
      className:'btn', 
      onClick:useMyLocation, 
      disabled:geoBusy, 
      style: { width: '100%', padding: '7px', fontSize: '13px' } 
    }, 
      geoBusy ? 'Locating...' : 'Use my location'
    ),
    geoErr && H('span', { className:'muted', style:{ color:'#b91c1c', fontSize:11 } }, geoErr),
    
    H('label', { style:{ display:'flex', alignItems:'center', gap:5, fontSize:12, padding:'3px 0' } },
      H('input', { 
        type:'checkbox', 
        checked:enableNearby, 
        onChange:e=>{
          const checked = e.target.checked;
          setEnableNearby(checked);
          if (checked && !hasFixedGps) useMyLocation();
        },
        style: { width: 16, height: 16 }
      }),
      'Enable Nearby searches'
    ),
    
    H('div', { className:'row', style: { alignItems: 'center', gap: 6 } },
      H('input', {
        value:priceVal,
        inputMode:'decimal',
        onChange:e=>setPriceVal(e.target.value.replace(/[^0-9.]/g,'')),
        placeholder:'Price (empty = $0.00)',
        style: { fontSize: '13px', padding: '7px', flex: 1 }
      }),
      isFree && H('span', { style:{ fontSize:11, color:'#16a34a', fontWeight:700 } }, price(0))
    ),
    
    H('button', {
      type: 'button',
      onClick: () => setShowTags(!showTags),
      style: {
        width: '100%',
        padding: '6px',
        background: '#f9f9f9',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        textAlign: 'left',
        fontSize: 11,
        color: '#6b7280'
      }
    }, showTags ? 'v Hide search tags' : '> Show search tags (optional)'),
    
    showTags && H('input', { 
      placeholder:'e.g. car, suv, 4x4', 
      value:tags, 
      onChange:e=>setTags(e.target.value),
      style: { fontSize: '13px', padding: '7px' }
    }),

    H('div', { className:'row', style: { gap: 6, marginTop: 6 } },
      H('button', { 
        className:'btn primary', 
        type:'submit', 
        disabled:autoBusy, 
        style: { flex: 1, padding: '9px', fontSize: '13px', fontWeight: 600 } 
      }, 
        draft ? 'Save' : 'Create'
      ),
      H('button', { 
        className:'btn', 
        type:'button', 
        onClick:onCancel, 
        disabled:autoBusy, 
        style: { flex: 1, padding: '9px', fontSize: '13px' } 
      }, 
        'Cancel'
      )
    )
  );
}

// Then your existing ListingForm component stays the same...

function App(){
    const { user, setUser } = useAuth();
    const [tab, setTab] = useState('browse');
    const [all, setAll] = useState([]);      // current page rows (thin)
    const [mine, setMine] = useState([]);
    const [query, setQuery] = useState('');
    const [locationQuery, setLocationQuery] = useState('');
    const [sort, setSort] = useState('new'); // default: Newest
    const [showForm, setShowForm] = useState(false);
    const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'login' });
    const [banner, setBanner] = useState(null);
    const [ads, setAds] = useState([]);

    const showLockedBanner = useCallback(() => {
      setBanner({ type: 'locked', message: 'Your account is locked. Please message an admin for help.', ts: Date.now() });
    }, []);

    const dismissBanner = useCallback(() => setBanner(null), []);

    const handleTabChange = (newTab) => {
    if (newTab === 'admin' && !user?.is_admin) {
      return;
    }
    setTab(newTab);
    setViewingSeller(null); // Clear seller view when switching tabs
  };

    // NEW: Seller profile state
    const [viewingSeller, setViewingSeller] = useState(null);
    
    // Pagination / infinite scroll
    const [hasNext, setHasNext] = useState(false);
    const [isFetchingListings, setIsFetchingListings] = useState(false);
    const sentinelRef = useRef(null);
    const loadingListingsRef = useRef(false);
    const nextCursorRef = useRef(null);

    // Modal selection for full listing card
    const [selectedListing, setSelectedListing] = useState(null);
    useEffect(() => {
      if (!selectedListing) return;
      const esc = (e) => { if (e.key === 'Escape') setSelectedListing(null); };
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    }, [selectedListing]);

    const [editing, setEditing] = useState(null);
    const [activeConvoId, setActiveConvoId] = useState(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [hasAdminUnread, setHasAdminUnread] = useState(false);
    const [loadingCount, setLoadingCount] = useState(0);

    // MassList modal
    const [showMassList, setShowMassList] = useState(false);

    // Auto-list toggles (persisted)
    const AUTO_KEY = 'listit_auto_list';
    const [autoListEnabled, setAutoListEnabled] = useState(() => {
      try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
    });
    useEffect(() => { try { localStorage.setItem(AUTO_KEY, autoListEnabled ? '1' : '0'); } catch {} }, [autoListEnabled]);

    const AUTO_NEAR_KEY = 'listit_auto_post_nearby';
    const [autoPostNearbyEnabled, setAutoPostNearbyEnabled] = useState(() => {
      try { return localStorage.getItem(AUTO_NEAR_KEY) === '1'; } catch { return false; }
    });
    useEffect(() => { try { localStorage.setItem(AUTO_NEAR_KEY, autoPostNearbyEnabled ? '1' : '0'); } catch {} }, [autoPostNearbyEnabled]);

    const isMobile = isMobileDevice();

    const refreshAds = useCallback(async () => {
      try {
        const rows = await api.listAds({ silent: true });
        setAds(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Failed to load ads', err);
        setAds([]);
      }
    }, []);

    useEffect(() => { refreshAds(); }, [refreshAds]);

    useEffect(() => {
      AppNav.setUser = setUser;
      AppNav.setTab = setTab;
      AppNav.notifyLocked = showLockedBanner;
      return () => {
        AppNav.setUser = () => {};
        AppNav.setTab = () => {};
        AppNav.notifyLocked = () => {};
      };
    }, [setUser, setTab, showLockedBanner]);
    useEffect(() => {
      AppNav.incLoad = () => setLoadingCount(c => c + 1);
      AppNav.decLoad = () => setLoadingCount(c => Math.max(0, c - 1));
    }, []);

    useEffect(() => {
      if (!user?.is_admin && tab === 'admin') {
        setTab('browse');
      }
    }, [user, tab]);

    const mineById = useMemo(() => {
      const map = Object.create(null);
      (mine || []).forEach(m => { map[m.id] = m; });
      return map;
    }, [mine]);

    // NEW: Handle viewing seller profile
    function handleViewSeller(userId, username) {
      setViewingSeller({ id: userId, username });
      setSelectedListing(null); // Close any open modal
    }

    function handleBackFromSeller() {
      setViewingSeller(null);
    }

    // Debounce: search + city
    const [debouncedQuery, setDebouncedQuery] = useState(query);
    useEffect(() => {
      const t = setTimeout(() => setDebouncedQuery(query), 250);
      return () => clearTimeout(t);
    }, [query]);

    const [debouncedLocation, setDebouncedLocation] = useState(locationQuery);
    useEffect(() => {
      const t = setTimeout(() => setDebouncedLocation(locationQuery), 500);
      return () => clearTimeout(t);
    }, [locationQuery]);

    // Reload helpers
    async function reloadMineOnly(){
      if (!user) { setMine([]); return; }
      const m = await api.listMine();
      setMine(asArray(m)||[]);
    }

    const reloadReqRef = useRef(0);

    const loadListings = useCallback(async ({ cursor = null, replace = false } = {}) => {
      const req = ++reloadReqRef.current;
      loadingListingsRef.current = true;
      setIsFetchingListings(true);
      try {
        const res = await api.listAll({
          q: debouncedQuery.trim() || '',
          loc: debouncedLocation.trim() || '',
          cursor,
          limit: PAGE_SIZE,
          sort
        });

        if (req !== reloadReqRef.current) return;

        const { rows, hasNext, nextCursor } = normalizeListingsResponse(res, PAGE_SIZE);
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
            try { const m = await api.listMine({ silent: true }); setMine(asArray(m)); } catch {}
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
                covers.forEach(r => { if (r && r.id != null) patch[r.id] = r.image_data ? { url: r.image_data } : null; });
                setCoverById(prev => ({ ...prev, ...patch }));
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
    }, [debouncedQuery, debouncedLocation, sort, user?.id]);

    useEffect(() => {
      nextCursorRef.current = null;
      setAll([]);
      setHasNext(false);
      loadListings({ cursor: null, replace: true });
    }, [user?.id, debouncedQuery, debouncedLocation, sort, loadListings]);

    const refreshListings = useCallback(async () => {
      nextCursorRef.current = null;
      setAll([]);
      setHasNext(false);
      await loadListings({ cursor: null, replace: true });
    }, [loadListings]);

    useEffect(() => {
      if (tab !== 'browse') return;
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
    }, [hasNext, loadListings, tab]);

    useEffect(() => { if (tab === 'profile') reloadMineOnly(); }, [tab, user?.id]);

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
    }, [refreshListings]);

    // Unread poll
    async function recomputeUnread() {
      try {
        if (!user) {
          setUnreadCount(0);
          setHasAdminUnread(false);
          return;
        }
        const convos = await api.listConversations({ silent:true });
        const seen = loadSeen(user.id);

        let unreadCount = 0;
        let adminUnread = false;

        for (const c of convos) {
          const lastId = c.last_message_id;
          const lastSender = c.last_message_sender_id;
          const seenValue = seen[c.id] || 0;
          let isUnread = false;

          if (lastId && lastSender && lastSender !== user.id) {
            if (!seenValue || lastId > seenValue) {
              isUnread = true;
            }
          }

          if (isUnread) {
            unreadCount++;
            if (c.last_message_is_admin) {
              adminUnread = true;
            }
          }
        }

        setUnreadCount(unreadCount);
        setHasAdminUnread(adminUnread);
      } catch {}
    }

    useEffect(() => {
      recomputeUnread();
    }, [user?.id]);

    useEffect(() => {
      if (!user) return;
      
      let ws = null;
      let reconnectTimeout = null;
      
      function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('WebSocket connected (App level)');
          clearTimeout(reconnectTimeout);
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'new_message' && data.sender_id !== user.id) {
              // Recompute unread count when new message arrives from another user
              recomputeUnread();
            }
          } catch (e) {
            console.error('WebSocket message error:', e);
          }
        };
        
        ws.onerror = (error) => {
          console.error('WebSocket error (App level):', error);
        };
        
        ws.onclose = (event) => {
          console.log('WebSocket disconnected (App level)', event?.code);
          ws = null;

          if (event?.code !== 1008) {
            // Reconnect after 3 seconds
            reconnectTimeout = setTimeout(() => {
              if (user) connectWebSocket();
            }, 3000);
          }
        };
        
        // Send ping every 25 seconds to keep connection alive
        const pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
        
        return () => {
          clearInterval(pingInterval);
          if (ws) ws.close();
        };
      }
      
      connectWebSocket();
      
      return () => {
        clearTimeout(reconnectTimeout);
        if (ws) {
          ws.close();
          ws = null;
        }
      };
    }, [user?.id]);

    useEffect(() => {
      if (!user && tab === 'messages') setTab('browse');
      if (!isMobile && tab === 'nearby') setTab('browse');
    }, [user, tab, isMobile]);

    // Sort feed (default: keep newest as returned by server)
    const feed = all; // Sorting is now handled server-side

    // City options
    const [cityOptions, setCityOptions] = useState([]);

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
      return () => { alive = false; clearTimeout(timer); };
    }, [locationQuery]);

    async function startMessage(item){
      if(!user){ alert('Log in to message a seller.'); return; }
      if(user.id === item.user_id){ alert('This is your listing.'); return; }

      setViewingSeller(null);
      const convo = await api.ensureConversation({ with_user_id: item.user_id, listing_id: item.id });
      setActiveConvoId(convo.id);
      setTab('messages');
    }

    async function startDirectMessage(userId){
      if (!user) { alert('Log in to message users.'); return; }
      const targetId = Number(userId);
      if (!Number.isFinite(targetId) || targetId <= 0) return;
      if (targetId === user.id) return;
      try {
        setViewingSeller(null);
        const convo = await api.ensureConversation({ with_user_id: targetId });
        setActiveConvoId(convo.id);
        setTab('messages');
      } catch (err) {
        alert(err?.message || 'Failed to open conversation.');
      }
    }


    function handleSeen(convoId, lastMsgId){
      if (!user || !convoId || !lastMsgId) return;
      const map = loadSeen(user.id);
      if (!map[convoId] || map[convoId] < lastMsgId) {
        map[convoId] = lastMsgId;
        saveSeen(user.id, map);
        setTimeout(() => { (async()=>{ await recomputeUnread(); })(); }, 0);
      }
    }

    async function handleAdminDeleteAll(){
      await api.adminDeleteAll();
      setAll([]); setMine([]);
    }
    
    function handleAdminDelete(listingId) {
      setAll(prev => asArray(prev).filter(x => x.id !== listingId));
      setMine(prev => (prev||[]).filter(x => x.id !== listingId));
    }
    
    function handleAuthClick(mode) {
      setAuthModal({ isOpen: true, mode });
    }
    
    function handleAuthSuccess(newUser) {
      setUser(newUser);
      // Reload data after successful auth
      refreshListings();
      reloadMineOnly();
    }

    async function logoutFromProfile(){
      await api.logout();
      setUser(null);
      setTab('browse');
    }

    // Persistent cover cache: coverById[id] = { url, w, h } | null
    const [coverById, setCoverById] = useState(() => (Object.create(null)));
    async function ensureCover(id){
      if (id == null) return;
      if (Object.prototype.hasOwnProperty.call(coverById, id)) return; // already fetched (even null)
      try {
        const arr = await api.getListingImages(id, { silent:true });
        let obj = null;
        if (Array.isArray(arr) && arr.length) {
          obj = typeof arr[0] === 'string'
            ? { url: arr[0], w: null, h: null }
            : { url: arr[0]?.url, w: arr[0]?.w ?? null, h: arr[0]?.h ?? null };
        }
        setCoverById(m => ({ ...m, [id]: obj }));
      } catch {
        setCoverById(m => ({ ...m, [id]: null }));
      }
    }

    // Build render items with best cover + aspect ratio
    const items = useMemo(() => {
      return (feed || []).map(it => {
        const inline = it?.image_data || it?.thumb_url || (Array.isArray(it?.images) ? it.images[0] : null);
        const cached = coverById[it.id];
        const url = inline || cached?.url || '';
        const ar  = (cached?.w && cached?.h) ? (cached.w / cached.h) : 1;
        return { ...it, __cover:url, __ar: ar };
      });
    }, [feed, coverById]);

    const adsForGrid = useMemo(() => {
      if (!Array.isArray(ads) || !ads.length) return [];
      return ads.map(ad => ({
        ...ad,
        position: Number.isFinite(Number(ad?.position)) ? Number(ad.position) : 0
      }));
    }, [ads]);

    const gridEntries = useMemo(() => {
      const base = (items || []).map(it => ({ type: 'listing', data: it }));
      if (!adsForGrid.length) return base;
      const result = [...base];
      const sortedAds = [...adsForGrid].sort((a, b) => {
        const posDiff = (Number(b.position) || 0) - (Number(a.position) || 0);
        if (posDiff !== 0) return posDiff;
        const timeA = a.updated_at || a.created_at || '';
        const timeB = b.updated_at || b.created_at || '';
        if (timeA !== timeB) return timeB.localeCompare(timeA);
        return Number(b.id || 0) - Number(a.id || 0);
      });
      sortedAds.forEach(ad => {
        const pos = Number.isFinite(ad.position) ? ad.position : 0;
        const idx = Math.min(Math.max(pos, 0), result.length);
        result.splice(idx, 0, { type: 'ad', data: ad });
      });
      return result;
    }, [items, adsForGrid]);

    // Grid tile (square)
    function GridTile({ it }) {
      const ref = useRef(null);

      useEffect(() => {
        const el = ref.current; if (!el) return;
        const io = new IntersectionObserver((entries) => {
          if (entries.some(e => e.isIntersecting)) {
            if (!it.__cover) ensureCover(it.id);
            io.disconnect();
          }
        }, { rootMargin: '800px 0px' });
        io.observe(el);
        return () => io.disconnect();
      }, [it.id, it.__cover]);

      const src = it.__cover;

      return H('div', { ref, className:'card', style:{ padding:0, overflow:'hidden', borderRadius:8 } },
        H('div', { style:{ position:'relative', width:'100%', aspectRatio:'1 / 1', background:'#f3f4f6' } },
          src && H('img', {
            src,
            alt: it.title || 'Item',
            loading:'lazy',
            decoding:'async',
            fetchPriority:'low',
            style:{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:'block', cursor:'pointer' },
            onClick: () => setSelectedListing({ ...it, image_data: src })
          })
        )
      );
    }

    // ---------- RENDER ----------
    return H(React.Fragment, null,
      H(Header, { user, setUser, onNav:handleTabChange, active:tab, unreadCount, hasAdminUnread, onAdminDeleteAll: handleAdminDeleteAll, isMobile, onAuthClick: handleAuthClick }),
      banner && H('div', { className:'global-banner', role:'status' },
        H('span', { className:'banner-text' }, banner.message),
        H('button', {
          type:'button',
          className:'banner-dismiss',
          onClick: dismissBanner,
          'aria-label': 'Dismiss locked account notice'
        }, 'Dismiss')
      ),
      H(GlobalLoader, { active: loadingCount > 0 }),

      H('main', { className:'container' },
        // NEW: Show seller profile if viewing
        viewingSeller && H(SellerProfile, {
          sellerId: viewingSeller.id,
          sellerUsername: viewingSeller.username,
          onBack: handleBackFromSeller,
          user,
          onMessage: startMessage,
          onAdminDelete: handleAdminDelete
        }),

        // Only show regular tabs if NOT viewing a seller
        !viewingSeller && tab==='browse' && H(React.Fragment, null,
          H('div', { className:'row', style: { justifyContent:'space-between', margin:'12px 0 18px', flexWrap:'wrap' } },
            H('div', { className:'row', style:{ gap:10, flexWrap:'wrap' } },
              H('input', {
                placeholder:'Search title, description, tags...',
                value:query,
                onChange:e=>setQuery(e.target.value),
                style:{ maxWidth:360 }
              }),
              H(CityAutocomplete, {
                value: locationQuery,
                onChange: setLocationQuery,
                options: cityOptions,
                onUseMyLocation: async () => {
                  try {
                    if (!('geolocation' in navigator)) { alert('Geolocation not supported'); return; }
                    const { coords } = await new Promise((res, rej)=>
                      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true, timeout:8000, maximumAge:60000 })
                    );
                    const r = await api.reverseGeocode(coords.latitude, coords.longitude);
                    const city = r?.city || (r?.display || '').split(',')[0];
                    if (city) setLocationQuery(city);
                  } catch { alert('Could not determine your location'); }
                }
              }),
              H('select', { value:sort, onChange:e=>setSort(e.target.value) },
                H('option', { value:'new' }, 'Newest'),
                H('option', { value:'price_asc' }, 'Price: Low -> High'),
                H('option', { value:'price_desc' }, 'Price: High -> Low'),
                H('option', { value:'city' }, 'City (A -> Z)')
              )
            ),
            H('div', { className:'row', style:{ gap:8 } },
              H('button', { className:'btn primary', onClick:()=>{
                if(!user){ alert('Log in to create a listing.'); return; }
                if(user.account_status === 'locked'){ showLockedBanner(); return; }
                setEditing(null);
                setShowForm(true);
              } }, 'New listing'),
              H('button', { className:'btn', onClick:()=>{
                if(!user){ alert('Log in to create listings.'); return; }
                if(user.account_status === 'locked'){ showLockedBanner(); return; }
                setShowMassList(true);
              } }, 'MassList')
            )
          ),

          // REMOVED THE INLINE FORM SECTION HERE

          // Grid: 4 across desktop, 3 across mobile
          (() => {
            const COLS = isMobile ? 3 : 4;
            const GAP  = 12;
            return H('section', {
              style: {
                display:'grid',
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gap: GAP
              }
            },
              gridEntries.map(entry => {
                if (entry.type === 'ad') {
                  return H(AdTile, { key: `ad-${entry.data.id}`, ad: entry.data, cols: COLS });
                }
                return H(GridTile, { key: `listing-${entry.data.id}`, it: entry.data });
              })
            );
          })(),

          // Infinite scroll status
          H('div', {
            style: {
              display: 'flex',
              justifyContent: 'center',
              padding: '16px 0',
              minHeight: 40
            }
          },
            isFetchingListings
              ? H('span', { className: 'muted' }, 'Loading listings...')
              : (!hasNext && items.length
                  ? H('span', { className: 'muted' }, 'No more results')
                  : null)
          ),

          // Sentinel element for intersection observer
          H('div', { ref: sentinelRef, style: { width: '100%', height: 1 } }),

          // Empty state
          !items.length && H('p', { className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No listings yet.'),

          // Modal with full card (distance OFF)
          selectedListing && H('div', {
            className:'modal open',
            onClick:(e)=>{ if (e.target.classList.contains('modal')) setSelectedListing(null); }
          },
            H('div', { className:'modal-inner listing-modal' },
              H('button', { className:'close', onClick:()=>setSelectedListing(null) }, 'x'),
              H(ListingCard, {
                item: selectedListing,
                user,
                canEdit: !!mineById[selectedListing.id],
                onEdit:(it)=>{
                  if(user?.account_status === 'locked'){ showLockedBanner(); return; }
                  const rich = mineById[it.id] || it;
                  setEditing(rich);
                  setShowForm(true);
                  setSelectedListing(null);
                  // REMOVED window.scrollTo
                },
                onDelete: async(it)=>{
                  if (confirm('Remove this listing? (Your past messages will remain)')) {
                    await api.deleteListing(it.id);
                    setSelectedListing(null);
                    await refreshListings();
                  }
                },
                onMessage: startMessage,
                onAdminDelete: handleAdminDelete,
                showDistance: false,
                onViewSeller: handleViewSeller, // NEW: Pass the handler
                onToggleSold: mineById[selectedListing.id] ? toggleSold : undefined
              })
            )
          )
        ),

        !viewingSeller && (tab==='nearby') &&
          H(NearbyPanel, {
            user,
            mineById,
            onEdit:(it)=>{
              if(user?.account_status === 'locked'){ showLockedBanner(); return; }
              const rich = mineById[it.id] || it;
              setEditing(rich);
              setShowForm(true);
              // REMOVED window.scrollTo
            },
            onDelete: async(it)=>{ if(confirm('Remove this listing? (Your past messages will remain)')){ await api.deleteListing(it.id); await refreshListings(); } },
            onMessage: startMessage,
            onAdminDelete: handleAdminDelete,
            onViewSeller: handleViewSeller,
            onToggleSold: toggleSold,
            setTab
          }),

        !viewingSeller && (tab==='messages') &&
          (user
            ? H(MessagesPanel, { user, initialActiveId: activeConvoId, onSeenChange: handleSeen })
            : H('div', { className:'muted', style:{ padding:'16px 0' } }, 'Please log in to view messages.')
          ),

        !viewingSeller && (tab==='profile') &&
          H(ProfilePanel, { isMobile,
            user,
            items: mine,
            onNewListing: () => {
              if(!user){ alert('Log in to create a listing.'); return; }
              if(user.account_status === 'locked'){ showLockedBanner(); return; }
              setEditing(null);
              setShowForm(true);
              setTab('browse');
            },
            onEdit:(it)=>{
              if(user?.account_status === 'locked'){ showLockedBanner(); return; }
              const rich = mineById[it.id] || it;
              setEditing(rich);
              setShowForm(true);
              setTab('browse');
              // REMOVED window.scrollTo
            },
            onDelete: async(it)=>{ if(confirm('Remove this listing? (Your past messages will remain)')){ await api.deleteListing(it.id); await reloadMineOnly(); await refreshListings(); } },
            onLogout: logoutFromProfile,
            onAdminDelete: handleAdminDelete,
            autoListEnabled,
            setAutoListEnabled,
            autoPostNearbyEnabled,
            setAutoPostNearbyEnabled,
            onViewSeller: handleViewSeller, // ADD THIS LINE
            onToggleSold: toggleSold
          }),

        !viewingSeller && (tab==='admin') &&
          (user?.is_admin
            ? H(AdminDashboard, { onViewSeller: handleViewSeller, onMessageUser: startDirectMessage, onAdsUpdated: refreshAds })
            : H('section', { className: 'card', style: { padding: 16 } }, 'Admin access only.'))
      ),

      // MassList modal
      showMassList && H(MassListModal, {
        onClose: () => setShowMassList(false),
        onDone: () => {},
        reloadAll: refreshListings,
        reloadMine: reloadMineOnly,
        user,
        onLockedAction: showLockedBanner,
        autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled)
      }),

      // NEW: Listing Form modal
      showForm && H(ListingFormModal, {
        isOpen: showForm,
        draft: editing,
        onClose: () => { setShowForm(false); setEditing(null); },
        onSaved: async () => { await refreshListings(); },
        autoListEnabled,
        autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled)
      }),

      // ADD THIS NEW AUTH MODAL:
      H(AuthModal, {
        isOpen: authModal.isOpen,
        onClose: () => setAuthModal({ ...authModal, isOpen: false }),
        initialMode: authModal.mode,
        onSuccess: handleAuthSuccess
      })
    );
  }

  function useAuth() {
    const [user, setUser] = useState(null);
    useEffect(() => { api.me().then(setUser).catch(()=>setUser(null)); }, []);
    return { user, setUser };
  }

  // Robust mount (React 18+ or older)
  const rootEl = document.getElementById('root');
  if (ReactDOM.createRoot) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(H(App));
  } else {
    ReactDOM.render(H(App), rootEl);
  }

})();


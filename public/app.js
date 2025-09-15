// public/app.js
//
// S3-first uploads (presign → PUT → finalize) + AI helper via local dataURLs
// Messages: paste/drag/attach images → S3 URLs (kept!)
// Conversations list: red "×" delete button (kept!)
// CHANGE: All listing fields optional EXCEPT at least one image.
//         If price field empty/invalid, default to $0.00 and render the price in green.
// NEW: MassList — pick multiple photos → AI per image → create multiple listings with uploads.
// NEW: Auto-list setting (Profile): when ON, attaching photos in the New listing form
//      will AI-analyze and immediately create the listing + upload photos automatically.
//      Includes "？" help modal with high-contrast text.
// NEW: Auto-list sub-toggle: "Also post to Nearby." When Auto-list is ON and this is enabled,
//      auto-created (and MassListed) items are created with enable_nearby=1 and lat/lon set.
//
// NEW (this file):
// - Thin-fetch + pagination for the Listings tab (75 per page, default sort=Newest)
//   * /api/listings uses ?noimg=1 (metadata only) with ?page=1&limit=75
//   * Batch prewarm first covers via /api/listings/covers
//   * Client guards against array OR {rows, hasNext, total, page} responses.

(() => {
  const { useEffect, useMemo, useRef, useState } = React;

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
  const AppNav = { setUser: () => {}, setTab: () => {}, incLoad: () => {}, decLoad: () => {} };

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

  // Arrange items so rows read left→right in a CSS multi-column layout
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
    if (res && typeof res === 'object') {
      if (typeof res.hasNext === 'boolean') hasNext = res.hasNext;
      else if (typeof res.next === 'boolean') hasNext = res.next;
      else if (Number.isFinite(res.total) && Number.isFinite(res.page)) {
        const shown = (res.page - 1) * limit + rows.length;
        hasNext = shown < res.total;
      } else {
        hasNext = rows.length === limit;
      }
    } else {
      hasNext = rows.length === limit;
    }
    return { rows, hasNext };
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
      H('div', { className: 'loader-text' }, 'Loading…')
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
      if (!res.ok) {
        let msg = 'request_failed';
        try { msg = (await res.json()).error || msg; } catch {}
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
  }, meta).then(user => {
    // ADD THIS:
    if (user && user.token) {
      console.log('Storing WebSocket token');
      sessionStorage.setItem('wsToken', user.token);
    }
    return user;
  });
},

register(payload, meta) { 
  return this._fetch('/api/register', { 
    method:'POST', 
    headers:{'Content-Type':'application/json'}, 
    body:JSON.stringify(payload) 
  }, meta).then(user => {
    // ADD THIS:
    if (user && user.token) {
      console.log('Storing WebSocket token');
      sessionStorage.setItem('wsToken', user.token);
    }
    return user;
  });
},
  
  async logout(meta) {
    try { 
      await this._fetch('/api/logout', { method:'POST' }, meta); 
      // ADD THESE LINES:
      sessionStorage.removeItem('wsToken');
      localStorage.removeItem('wsToken');
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
      let q, loc, page, limit, sort;
      if (typeof a === 'object' && a !== null) {
        q = a.q || '';
        loc = a.loc || '';
        page = a.page || 1;
        limit = a.limit || 75;
        sort = a.sort || 'new';
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
      params.set('page', String(page));
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
    deleteListing(id, meta) { return this._fetch(`/api/listings/${id}`, { method:'DELETE' }, meta); },

    adminDeleteListing(id, meta) { return this._fetch(`/api/admin/listings/${id}`, { method:'DELETE' }, meta); },
    adminDeleteAll(meta)       { return this._fetch('/api/admin/listings', { method:'DELETE' }, meta); },

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

    // --- S3 upload helpers ---
    signUpload({ filename, contentType, bytes }, meta) {
      return this._fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ filename, contentType, bytes })
      }, meta);
    },
    finalizeUpload({ listingId, key, url, width, height, bytes }, meta) {
      return this._fetch('/api/uploads/finalize', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ listingId, key, url, width, height, bytes })
      }, meta);
    }
  };

  // Upload a single file to S3 then finalize in DB (for listings)
  async function uploadOneImage(listingId, file) {
    const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
    if (sig.error) throw new Error(sig.error);

    // PUT bytes to S3
    const putRes = await fetch(sig.uploadUrl, { method:'PUT', body:file, headers:{ 'Content-Type': file.type } });
    if (!putRes.ok) throw new Error('s3_put_failed');

    // measure image dims
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: null, h: null });
      img.src = URL.createObjectURL(file);
    });

    await api.finalizeUpload({
      listingId,
      key: sig.Key,
      url: sig.publicUrl,
      width: dims.w, height: dims.h, bytes: file.size
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
        placeholder:'City…',
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
function Header({ user, setUser, onNav, active, unreadCount, onAdminDeleteAll, isMobile, onAuthClick }) {
  // If user not logged in, show Register/Login buttons
  if (!user) {
    return H('header', null,
      H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
        H('div', { className: 'row', style: { gap: 12 } },
          H('div', { style: { width: 36, height: 36, borderRadius: 12, background: '#111', color: '#0aaa3aff', display: 'grid', placeItems: 'center', fontWeight: 800 } }, 'CL'),
          H('div', null, H('div', { style: { fontWeight: 800 } }, 'Creegslist'), H('div', { className: 'muted' }, 'Sell on the spot'))
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

  const messagesBtn = H('button', {
    className: `btn ${active==='messages'?'primary':''}`,
    style: { position: 'relative' },
    onClick: () => {
      if (!user) { alert('Log in to view messages.'); return; }
      onNav('messages');
    }
  }, 'Messages',
    (unreadCount > 0) &&
      H('span', { style: { position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 10, background: '#ef4444' } })
  );

  return H('header', null,
    H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
      H('div', { className: 'row', style: { gap: 12 } },
        H('div', { style: { width: 36, height: 36, borderRadius: 12, background: '#111', color: '#0aaa3aff', display: 'grid', placeItems: 'center', fontWeight: 800 } }, 'CL'),
        H('div', null, H('div', { style: { fontWeight: 800 } }, 'Creegslist'), H('div', { className: 'muted' }, 'Sell on the spot'))
      ),
      H('nav', { className: 'row' },
        H('button', { className: `btn ${active==='browse'?'primary':''}`, onClick: () => onNav('browse') }, 'Listings'),
        isMobile && H('button', { className: `btn ${active==='nearby'?'primary':''}`, onClick: () => onNav('nearby') }, 'Nearby'),
        messagesBtn,
        H('button', { className: `btn ${active==='profile'?'primary':''}`, onClick: () => onNav('profile'), title: 'Profile & settings' }, profileLabel)
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
      
      // ADD THESE 3 LINES HERE:
      if (user.token) {
        sessionStorage.setItem('wsToken', user.token);
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
        H('button', { className: 'close', onClick: onClose }, '✕'),
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
              placeholder: '••••••••',
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
      const next = [...files]; next.splice(i,1); onChange(next);
    }

    return H('div', null,
      H('div', { className:'row' },
        H('input', { type:'file', accept:'image/*', multiple:true, ref, onChange: pick }),
        H('span', { className:'muted' }, `${(files||[]).length} file(s)`)
      ),
      H('div', { className:'row', style:{ flexWrap:'wrap', gap:8, marginTop:8 } },
        ...(files||[]).map((f,i)=> H('div', { key:i, style:{ position:'relative' } },
          H('img', {
            src: URL.createObjectURL(f),
            style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #ddd' }
          }),
          H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, onClick:()=>removeAt(i) }, '×')
        ))
      )
    );
  }

  // Helper: convert File[] to dataURLs for AI analysis only
  async function filesToDataUrls(files = []) {
    async function toB64(file) {
      return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    }
    const out = [];
    for (const f of files.slice(0,3)) out.push(await toB64(f));
    return out;
  }
  async function fileToDataUrl(file) {
    const arr = await filesToDataUrls([file]);
    return arr && arr[0];
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
            }, '✕')
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
      setAiErr(''); setAiBusy(true);
      try {
        let dataUrls = [];
        
        // Convert new files to data URLs
        if (files.length) {
          const newDataUrls = await filesToDataUrls(files);
          dataUrls.push(...newDataUrls);
        }
        
        // Convert existing S3 URLs to data URLs
        if (!files.length && existingUrls.length) {
          for (const url of existingUrls.slice(0, 3)) { // Max 3 for AI
            if (url.startsWith('http')) {
              const dataUrl = await urlToDataUrl(url);
              if (dataUrl) dataUrls.push(dataUrl);
            } else if (url.startsWith('data:')) {
              dataUrls.push(url);
            }
          }
        }
        
        if (!dataUrls.length) {
          alert('No images available for AI analysis. Please add new images or ensure existing images are accessible.');
          return;
        }
        
        const res = await api.aiAnalyze({ 
          images: dataUrls, 
          hint: `${title} ${description}`.trim() 
        });
        
        if (res.title) setTitle(res.title);
        if (Array.isArray(res.tags)) setTags(res.tags.join(', '));
        if (typeof res.suggested_price === 'number' && !Number.isNaN(res.suggested_price)) {
          setPriceVal(String(res.suggested_price));
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

    // Auto-list: when ON, creating a brand-new listing & user added photos → AI + create + upload
    useEffect(() => {
      if (!autoListEnabled) return;
      if (draft) return;            // only for new listings
      if (!files || files.length === 0) return;
      if (autoRunning.current) return;

      (async () => {
        autoRunning.current = true;
        setAutoBusy(true);
        try {
          // AI best-effort
          let ai = {};
          try {
            const dataUrls = await filesToDataUrls(files);
            ai = await api.aiAnalyze({ images: dataUrls, hint: '' }, { silent:true }) || {};
          } catch (_) {}

          const parsedPrice = Number(ai.suggested_price);
          const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

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
            description: 'No description',  // Provide default
            location: locAuto || 'No location',  // Provide default
            price: safePrice,
            tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
            enable_nearby: enableNearbyAuto
          };
          if (enableNearbyAuto) { payload.lat = latAuto; payload.lon = lonAuto; }

          const created = await api.createListing(payload);
          if (!created?.id) throw new Error('Create failed');
          await uploadFilesForListing(created.id, files);

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
    // Check total images (existing + new)
    const totalImages = existingUrls.length + files.length;
    if (totalImages === 0) {
      alert('Please add at least one image.');
      return;
    }

    // Default price to $0.00 if empty/invalid
    const parsedPrice = Number(priceVal);
    const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

    const payload = {
      title: String(title || '').trim(),
      description: String(description || 'No description').trim(),
      location: String(location || 'No location').trim(),
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
      // Determine which images were deleted
      const deletedImages = originalUrls.filter(url => !existingUrls.includes(url));
      
      // Include deleted images in the payload
      if (deletedImages.length > 0) {
        payload.deletedImages = deletedImages;
      }
      
      await api.updateListing(draft.id, payload);
      if (files.length) await uploadFilesForListing(draft.id, files);
    } else {
      const created = await api.createListing(payload);
      if (!created?.id) { throw new Error('Create failed'); }
      if (files.length) await uploadFilesForListing(created.id, files);
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
      }, H('div', null, H('div', {className:'spinner'}), H('div', {style:{marginTop:6, fontWeight:700}}, 'Auto-listing…'))),

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
              }, '×')
            )
          )
        )
      ),

      H('div', { className:'row', style:{ gap:8 } },
        H('button', { type:'button', className:`btn ${aiBusy?'':'primary'}`, disabled:aiBusy, onClick:runAI }, aiBusy ? 'Analyzing…' : 'Run AI analysis'),
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
        H('button', { type:'button', className:'btn', onClick:useMyLocation, disabled:geoBusy }, geoBusy ? 'Locating…' : 'Use my location'),
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
  function Lightbox({ open, images, index, onClose, onIndex }) {
    const esc = (e)=> { if(e.key==='Escape') onClose(); };
    React.useEffect(()=>{ if(open){ window.addEventListener('keydown', esc); return ()=> window.removeEventListener('keydown', esc); }}, [open]);
    if(!open) return null;

    const len = Math.max(1, (images && images.length) || 0);

    const modal = H('div', {
      className:'modal open lightbox',
      onClick:(e)=>{ if(e.target.classList.contains('modal')) onClose(); }
    },
      H('div', { className:'modal-inner' },
        H('button', { className:'close', onClick:onClose }, '✕'),
        H('button', { className:'arrow left', onClick:()=>onIndex((index-1+len)%len) }, '◀'),
        H('img', { src: images[index] }),
        H('button', { className:'arrow right', onClick:()=>onIndex((index+1)%len) }, '▶'),
        H('div', { className:'thumbs' },
          ...(images||[]).map((img,i)=> H('img', { key:i, src:img, className: i===index?'active':'', onClick:()=>onIndex(i) }))
        )
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
    initialAR = 4/3,
    lockAR = true
  }) {
    const wrapRef = React.useRef(null);
    const imgRef  = React.useRef(null);

    const [activeSrc, setActiveSrc] = React.useState('');
    const [ratio, setRatio]         = React.useState(initialAR);

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

    function onLoad(e) {
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
      activeSrc && H('img', {
        ref: imgRef,
        src: activeSrc,
        alt,
        loading: 'lazy',
        decoding: 'async',
        fetchpriority: 'low',
        onLoad,
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          cursor: onClick ? 'pointer' : 'default'
        },
        onClick
      })
    );
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
  showDistance = false 
}) {

  const [open, setOpen] = useState(false);
  const [images, setImages] = useState(null);
  const [idx, setIdx] = useState(0);
  const [derivedMeters, setDerivedMeters] = React.useState(null);

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
    if (!images) { 
      try { 
        const arr = await api.getListingImages(item.id); 
        setImages(arr && arr.length ? arr : [item.image_data]); 
      } catch { 
        setImages([item.image_data]); 
      } 
    }
    setIdx(start); 
    setOpen(true);
  }

  const isFree = Number(item?.price ?? 0) === 0;

  const controls = [];
  if (!user || user.id !== item.user_id) {
    controls.push(H('button', { 
      key: 'm', 
      className: 'btn primary', 
      onClick: () => onMessage?.(item) 
    }, 'Message seller'));
  }
  if (canEdit) {
    controls.push(H('button', { 
      key: 'e', 
      className: 'btn', 
      onClick: () => onEdit?.(item) 
    }, 'Edit'));
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
      return '—';
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

  return H('div', { className: 'card' },
    H('div', {
      className: 'aspect',
      onClick: (e) => { 
        e.stopPropagation(); 
        openModal(0); 
      },
      style: { cursor: 'zoom-in' }
    }, H('img', { 
      src: item.image_data || (images && images[0]), 
      loading: 'lazy', 
      decoding: 'async' 
    })),
    
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
      
      H('div', { className: 'muted' }, item.location),
      
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
    
    H(Lightbox, { 
      open, 
      images: images || [item.image_data], 
      index: idx, 
      onClose: () => setOpen(false), 
      onIndex: setIdx 
    })
  );
}

// NEW: Seller Profile Component
function SellerProfile({ sellerId, sellerUsername, onBack, user, onMessage, onAdminDelete }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [error, setError] = useState(null);
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
    H('button', { className: 'btn', onClick: onBack }, '← Back')
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

  if (loading) {
    return H('div', { style: { padding: '24px', textAlign: 'center' } },
      H('div', { className: 'spinner' }),
      H('div', { style: { marginTop: '12px' } }, 'Loading seller profile...')
    );
  }

  return H('div', null,
    H('section', { className: 'card', style: { padding: '16px', margin: '12px 0 16px' } },
      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
        H('div', null,
          H('div', { style: { fontWeight: 800, fontSize: '20px' } }, `@${sellerUsername}'s Listings`),
          H('div', { className: 'muted' }, `${listings.length} active listing${listings.length !== 1 ? 's' : ''}`)
        ),
        H('button', { className: 'btn', onClick: onBack }, '← Back')
      )
    ),

    listings.length === 0 
      ? H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, 'No listings from this seller.')
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
            listings.map(it => {
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
                  })
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
        H('button', { className: 'close', onClick: () => setSelectedListing(null) }, '✕'),
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
  const fileRef = useRef();
  const [lb, setLb] = useState({ open:false, images:[], index:0 });
  const pollRef = useRef(null);
  const dropRef = useRef();
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  
  // Add scroll tracking state
  const msgsContainerRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  
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
      // Get auth token from cookie
      const token = sessionStorage.getItem('wsToken') || 
                  localStorage.getItem('wsToken') ||
                  document.cookie.match(/token=([^;]+)/)?.[1];

      if (!token) {
        console.error('No token available for WebSocket');
        return;
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;  
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
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        wsRef.current = null;
        
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (user) connectWebSocket();
        }, 3000);
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
      return { ...c, _unread: unread };
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
        c.listing_title ? H('div', { className:'muted' }, ` • ${c.listing_title?.slice?.(0,24)}`) : null,
        c._unread && H('span', {
          style:{ marginLeft:'auto', width:8, height:8, borderRadius:8, background:'#ef4444' }
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
        }, '×')
      )) : [H('div', { key:'empty', className:'muted' }, 'No conversations yet')])
    ),

    H('section', { className:'card col', style:{ padding:12, display:'flex', flexDirection:'column' } },
      !activeId && H('div', { className:'muted' }, 'Select a conversation'),

      activeId && H('div', { 
        ref: msgsContainerRef,
        style:{ flex:1, overflow:'auto', padding:4 },
        onScroll: checkIfAtBottom
      },
        msgs.map(m => H('div', { key:m.id, className:`message ${m.sender_id===user.id?'mine':'their'}` },
          m.body && H('div', null, m.body),
          Array.isArray(m.images) && m.images.length > 0 &&
            H('div', { className:'row', style:{ gap:6, marginTop:6, flexWrap:'wrap' } },
              ...m.images.map((src, i) =>
                H('img', { key:i, src, loading:'lazy', decoding:'async', style:{ width:140, height:140, objectFit:'cover', borderRadius:10, border:'1px solid #e5e7eb', cursor:'zoom-in' },
                  onClick:()=>openLightbox(m.images, i) })
              )
            )
        ))
      ),

      (activeId && imgFiles.length > 0) && H('div', { className:'row', style:{ gap:6, flexWrap:'wrap', margin:'6px 0' } },
        ...imgFiles.map((f,i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H('img', { src: URL.createObjectURL(f), style:{ width:72, height:72, objectFit:'cover', borderRadius:10, border:'1px solid #e5e7eb' } }),
            H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:2, right:2, padding:'2px 6px' }, onClick:()=>removeImg(i) }, '×')
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
          placeholder:'Type a message…  (Tip: paste or drag images)',
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
        index: lb.index,
        onClose: ()=> setLb({ open:false, images:[], index:0 }),
        onIndex: (i)=> setLb(s=>({ ...s, index:i }))
      })
    )
  );
}

  // --- Nearby Panel (unchanged) ---
  function NearbyPanel({ user, mineById, onEdit, onDelete, onMessage, onAdminDelete, setTab, onViewSeller }) {
    const [radius, setRadius] = useState(150);
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState(null);

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

    async function load() {
      if (!('geolocation' in navigator)) { alert('Geolocation not supported'); return; }
      setBusy(true);
      try {
        const { coords } = await new Promise((res, rej)=>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true, timeout:8000, maximumAge:60000 })
        );
        const res = await api.listNearby(coords.latitude, coords.longitude, radius, { silent:true });
        setItems(res || []);
      } catch (e) {
        alert('Could not load nearby listings');
      } finally {
        setBusy(false);
      }
    }

    useEffect(() => { load(); }, [radius]);

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
            H('option', { value:150 },  '≈500 ft'),
            H('option', { value:402 },  '¼ mi'),
            H('option', { value:805 },  '½ mi'),
            H('option', { value:1609 }, '1 mi')
          ),
          H('button', { className:'btn', onClick:load, disabled:busy }, busy ? 'Finding nearby…' : 'Reload')
        )
      ),

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

      (!items.length && !busy) && H('p', { className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No nearby listings found in this radius.'),

      selected && H('div', { className:'modal open', onClick:(e)=>{ if(e.target.classList.contains('modal')) setSelected(null); } },
        H('div', { className:'modal-inner listing-modal' },
          H('button', { className:'close', onClick:()=>setSelected(null) }, '✕'),
          H(ListingCard, {
            item: selected,
            user,
            canEdit: !!mineById[selected.id],
            onEdit: handleEdit,
            onDelete,
            onMessage,
            onAdminDelete,
            showDistance: true,
            onViewSeller
          })
        )
      )
    );
  }

  // --- MassList Modal (fixed) ---
  function MassListModal({ onClose, onDone, reloadAll, reloadMine, user, autoPostNearbyEnabled }) {
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });

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
    function removeAt(i){ const next=[...files]; next.splice(i,1); setFiles(next); }

    async function runMassList(){
      if (!user) { alert('Log in to create listings.'); return; }
      if (!files.length) { alert('Pick at least one image.'); return; }
      setBusy(true);
      setProgress({ done: 0, total: files.length, failed: 0 });

      let failed = 0;

      // Try to get coords ONCE if auto-post-nearby is enabled
      let sharedNearby = { ok:false, lat:null, lon:null, display:'' };
      if (autoPostNearbyEnabled) {
        try {
          const c = await fetchCoordsAndReverse();
          sharedNearby = { ok:true, lat:c.lat, lon:c.lon, display:c.display };
        } catch (_) { sharedNearby = { ok:false, lat:null, lon:null, display:'' }; }
      }

      for (let i=0; i<files.length; i++){
        const f = files[i];
        try {
          // AI analysis per image (best effort)
          let ai = {};
          try {
            const b64 = await fileToDataUrl(f);
            ai = await api.aiAnalyze({ images: [b64], hint: '' }, { silent:true }) || {};
          } catch (_) { /* ignore AI failure; fallback below */ }

          const safePrice = (Number.isFinite(ai.suggested_price) && ai.suggested_price >= 0) ? ai.suggested_price : 0;
          const payload = {
            title: (ai.title || 'Item for sale').toString().slice(0, 80),
            description: 'No description',
            location: sharedNearby.ok ? sharedNearby.display : 'No location',
            price: safePrice,
            tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
            enable_nearby: sharedNearby.ok ? 1 : 0,
            image_data: await fileToDataUrl(f) // Add base64 image for creation
          };
          if (sharedNearby.ok) { payload.lat = sharedNearby.lat; payload.lon = sharedNearby.lon; }

          const created = await api.createListing(payload);
          if (!created?.id) throw new Error('create_failed');

          await uploadOneImage(created.id, f);
        } catch (e) {
          failed += 1;
        } finally {
          setProgress(p => ({ ...p, done: p.done + 1, failed }));
        }
      }

      try { await reloadMine(); } catch {}
      try { await reloadAll(); } catch {}

      setBusy(false);

      const stats = { total: files.length, created: files.length - failed, failed };
      onDone && onDone(stats);
      onClose && onClose();
    }

    const modal = H('div', { className:'modal open', onClick:(e)=>{ if(e.target.classList.contains('modal')) onClose(); } },
      H('div', { className:'modal-inner', style:{ width:'min(680px, 92vw)', background:'#fff', borderRadius:24, overflow:'hidden' } },
        H('button', { className:'close', onClick:onClose }, '✕'),
        H('div', { style:{ padding:16 } },
          H('div', { style:{ fontWeight:800, fontSize:18, marginBottom:6 } }, 'MassList'),
          H('div', { className:'muted', style:{ marginBottom:12 } }, 'Pick multiple photos from your gallery. We will create one listing per photo using AI for title, tags, and price (you can edit later).'),

          H('div', { className:'row', style:{ gap:8, alignItems:'center' } },
            H('input', { type:'file', accept:'image/*', multiple:true, ref:fileRef, onChange: pick }),
            H('span', { className:'muted' }, `${files.length} selected`)
          ),

          files.length > 0 && H('div', { className:'row', style:{ gap:8, flexWrap:'wrap', marginTop:12 } },
            ...files.map((f,i) =>
              H('div', { key:i, style:{ position:'relative' } },
                H('img', { src: URL.createObjectURL(f), style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #e5e7eb' }, loading:'lazy', decoding:'async' }),
                H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, onClick:()=>removeAt(i) }, '×')
              )
            )
          ),

          H('div', { className:'row', style:{ marginTop:16 } },
            H('button', { className:'btn', onClick:onClose, disabled:busy }, 'Cancel'),
            H('button', { className:`btn primary`, onClick:runMassList, disabled:busy || files.length===0 }, busy ? 'Working…' : 'Confirm MassList')
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
            H('div', { style:{ fontWeight:800, marginTop:6 } }, 'MassList in progress…'),
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
    onViewSeller // ADD THIS PARAMETER
  }) {
    const [showHelp, setShowHelp] = useState(false);

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

    return H(React.Fragment, null,
      H('section', { className:'card', style:{ padding:16, margin:'12px 0 16px' } },
        H('div', { className:'row', style:{ justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 } },
          H('div', null,
            H('div', { style:{ fontWeight:800, fontSize:18 } }, user.username ? `@${user.username}` : user.email),
            H('div', { className:'muted' }, 'Your account')
          ),
          // Right controls: Auto-list toggle • New listing • Log out
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

          H('div', { style:{ fontWeight:800 } }, `Your listings (${items.length})`)
        ),
        H('section', { className:'grid' },
          (items.length
            ? items.map(item =>
                H(ListingCard, {
                  key:item.id,
                  item,
                  user,
                  canEdit: true,
                  onEdit,
                  onDelete,
                  onAdminDelete,
                  onViewSeller
                })
              )
            : [H('p', { key:'empty', className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No listings yet. Create your first one!')]
          )
        )
      ),

      showHelp && H(AutoListHelpModal, { onClose: () => setShowHelp(false) })
    );
  }

  // ---------- App ----------
  const PAGE_SIZE = 75;

// Add this new component BEFORE the ListingForm component definition
// --- Listing Form Modal ---
function ListingFormModal({ isOpen, draft, onClose, onSaved, autoListEnabled, autoPostNearbyEnabled }) {
  if (!isOpen) return null;

  const modal = H('div', { 
    className: 'modal open', 
    onClick: (e) => { if (e.target.classList.contains('modal')) onClose(); }
  },
    H('div', { 
      className: 'modal-inner', 
      style: { 
        width: 'min(680px, 92vw)', 
        background: '#fff', 
        borderRadius: 24, 
        overflow: 'auto',
        maxHeight: '90vh',
        marginTop: '5vh',
        marginBottom: '5vh'
      }
    },
      H('button', { className: 'close', onClick: onClose }, '✕'),
      H('div', { style: { padding: 16 } },
        H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 
          draft ? 'Edit Listing' : 'New Listing'
        ),
        H('div', { className: 'muted', style: { marginBottom: 12 } }, 
          'Add photos and details for your listing. Only images are required - AI can suggest the rest.'
        ),
        H(ListingForm, { 
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
    

   const handleTabChange = (newTab) => {
    setTab(newTab);
    setViewingSeller(null); // Clear seller view when switching tabs
  };

    // NEW: Seller profile state
    const [viewingSeller, setViewingSeller] = useState(null);
    
    // Pagination
    const [page, setPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);

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

    useEffect(() => { AppNav.setUser = setUser; AppNav.setTab = setTab; }, [setUser, setTab]);
    useEffect(() => {
      AppNav.incLoad = () => setLoadingCount(c => c + 1);
      AppNav.decLoad = () => setLoadingCount(c => Math.max(0, c - 1));
    }, []);

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

    // Reset to page 1 when filters/sort change
    useEffect(() => { setPage(1); }, [debouncedQuery, debouncedLocation, sort]);

    // Reload helpers
    async function reloadMineOnly(){
      if (!user) { setMine([]); return; }
      const m = await api.listMine();
      setMine(asArray(m)||[]);
    }

    const reloadReqRef = useRef(0);
    async function reload(){
      const req = ++reloadReqRef.current;
      try {
        // Load listings for ALL users (authenticated or not)
        const res = await api.listAll({ q: debouncedQuery.trim() || '', loc: debouncedLocation.trim() || '', page, limit: PAGE_SIZE, sort });

        if (req !== reloadReqRef.current) return;

        const { rows, hasNext } = normalizeListingsResponse(res, PAGE_SIZE);
        setAll(rows || []);
        setHasNext(!!hasNext);

        // Only load user's own listings if authenticated
        if (user) {
          try { const m = await api.listMine({ silent: true }); setMine(asArray(m)); } catch {}
        } else {
          setMine([]);
        }

        // Prewarm a bunch of covers (works for all users)
        try {
          const ids = (rows || []).slice(0, 24).map(r => r.id);
          const covers = await api.getCoversBatch(ids, { silent: true });
          if (Array.isArray(covers) && covers.length) {
            const patch = {};
            covers.forEach(r => { if (r && r.id != null) patch[r.id] = r.image_data ? { url: r.image_data } : null; });
            setCoverById(prev => ({ ...prev, ...patch }));
          }
        } catch {}
      } catch (e) {
        console.error('reload failed', e);
        setAll([]); setHasNext(false);
      }
    }

    useEffect(() => { reload(); }, [user?.id, debouncedQuery, debouncedLocation, page, sort]);

    useEffect(() => { if (tab === 'profile') reloadMineOnly(); }, [tab, user?.id]);

    // Unread poll
    async function recomputeUnread() {
      try {
        if (!user) { setUnreadCount(0); return; }
        const convos = await api.listConversations({ silent:true });
        const seen = loadSeen(user.id);
        
        let unreadCount = 0;
        for (const c of convos) {
          // Check if there's a new message we haven't seen
          if (c.last_message_id && 
              c.last_message_sender_id && 
              c.last_message_sender_id !== user.id) {
            
            // If we've never seen any messages in this conversation, it's unread
            if (!seen[c.id]) {
              unreadCount++;
            } 
            // If the last message ID is greater than what we've seen, it's unread
            else if (c.last_message_id > seen[c.id]) {
              unreadCount++;
            }
          }
        }
        
        setUnreadCount(unreadCount);
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
        const token = sessionStorage.getItem('wsToken') || 
                    localStorage.getItem('wsToken') ||
                    document.cookie.match(/token=([^;]+)/)?.[1];

        if (!token) {
          console.error('No token available for WebSocket (App level)');
          return;
        }
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
        
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
        
        ws.onclose = () => {
          console.log('WebSocket disconnected (App level)');
          ws = null;
          
          // Reconnect after 3 seconds
          reconnectTimeout = setTimeout(() => {
            if (user) connectWebSocket();
          }, 3000);
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
    const cityOptions = useMemo(() => {
      const set = new Set();
      asArray(all).forEach(l => {
        const raw = (l.location || '').trim();
        if (!raw) return;
        const city = raw.split(',')[0].trim();
        if (city) set.add(city);
      });
      return Array.from(set).sort((a,b)=> a.localeCompare(b));
    }, [all]);

    async function startMessage(item){
      if(!user){ alert('Log in to message a seller.'); return; }
      if(user.id === item.user_id){ alert('This is your listing.'); return; }

      setViewingSeller(null);
      const convo = await api.ensureConversation({ with_user_id: item.user_id, listing_id: item.id });
      setActiveConvoId(convo.id);
      setTab('messages');
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
      reload();
      reloadMineOnly();
    }

    async function logoutFromProfile(){
      await api.logout();
      sessionStorage.removeItem('wsToken');
      localStorage.removeItem('wsToken');
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
    H(Header, { user, setUser, onNav:handleTabChange, active:tab, unreadCount, onAdminDeleteAll: handleAdminDeleteAll, isMobile,  onAuthClick: handleAuthClick }),      H(GlobalLoader, { active: loadingCount > 0 }),

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
                placeholder:'Search title, description, tags…',
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
                H('option', { value:'price_asc' }, 'Price: Low → High'),
                H('option', { value:'price_desc' }, 'Price: High → Low'),
                H('option', { value:'city' }, 'City (A → Z)')
              )
            ),
            H('div', { className:'row', style:{ gap:8 } },
              H('button', { className:'btn primary', onClick:()=>{ if(!user){ alert('Log in to create a listing.'); return; } setEditing(null); setShowForm(true); } }, 'New listing'),
              H('button', { className:'btn', onClick:()=>{ if(!user){ alert('Log in to create listings.'); return; } setShowMassList(true); } }, 'MassList')
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
              items.map(it => H(GridTile, { key: it.id, it }))
            );
          })(),

          // Pagination controls
          H('div', { className:'row', style:{ justifyContent:'center', gap:8, margin:'16px 0' } },
            H('button', { className:'btn', disabled: page<=1, onClick:()=>{ setPage(p=>Math.max(1, p-1)); window.scrollTo(0, 0); } }, '← Prev'),
            H('div', { className:'muted', style:{ padding:'6px 10px' } }, `Page ${page}`),
            H('button', { className:'btn', disabled: !hasNext, onClick:()=>{ setPage(p=>p+1); window.scrollTo(0, 0); } }, 'Next →')
          ),

          // Empty state
          !items.length && H('p', { className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No listings yet.'),

          // Modal with full card (distance OFF)
          selectedListing && H('div', {
            className:'modal open',
            onClick:(e)=>{ if (e.target.classList.contains('modal')) setSelectedListing(null); }
          },
            H('div', { className:'modal-inner listing-modal' },
              H('button', { className:'close', onClick:()=>setSelectedListing(null) }, '✕'),
              H(ListingCard, {
                item: selectedListing,
                user,
                canEdit: !!mineById[selectedListing.id],
                onEdit:(it)=>{
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
                    await reload();
                  }
                },
                onMessage: startMessage,
                onAdminDelete: handleAdminDelete,
                showDistance: false,
                onViewSeller: handleViewSeller // NEW: Pass the handler
              })
            )
          )
        ),

        !viewingSeller && (tab==='nearby') &&
          H(NearbyPanel, {
            user,
            mineById,
            onEdit:(it)=>{
              const rich = mineById[it.id] || it;
              setEditing(rich);
              setShowForm(true);
              // REMOVED window.scrollTo
            },
            onDelete: async(it)=>{ if(confirm('Remove this listing? (Your past messages will remain)')){ await api.deleteListing(it.id); await reload(); } },
            onMessage: startMessage,
            onAdminDelete: handleAdminDelete,
            onViewSeller: handleViewSeller,
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
            onNewListing: () => { if(!user){ alert('Log in to create a listing.'); return; } setEditing(null); setShowForm(true); setTab('browse'); },
            onEdit:(it)=>{
              const rich = mineById[it.id] || it;
              setEditing(rich);
              setShowForm(true);
              setTab('browse');
              // REMOVED window.scrollTo
            },
            onDelete: async(it)=>{ if(confirm('Remove this listing? (Your past messages will remain)')){ await api.deleteListing(it.id); await reloadMineOnly(); await reload(); } },
            onLogout: logoutFromProfile,
            onAdminDelete: handleAdminDelete,
            autoListEnabled,
            setAutoListEnabled,
            autoPostNearbyEnabled,
            setAutoPostNearbyEnabled,
            onViewSeller: handleViewSeller // ADD THIS LINE
          })
      ),

      // MassList modal
      showMassList && H(MassListModal, {
        onClose: () => setShowMassList(false),
        onDone: () => {},
        reloadAll: reload,
        reloadMine: reloadMineOnly,
        user,
        autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled)
      }),

      // NEW: Listing Form modal
      showForm && H(ListingFormModal, {
        isOpen: showForm,
        draft: editing,
        onClose: () => { setShowForm(false); setEditing(null); },
        onSaved: async () => { await reload(); },
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
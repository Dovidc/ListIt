/* public/app.js — usernames + titles + unread dots + multi-images + AI analysis (title, tags, suggested price)
   + admin delete-all & per-card + private tags (visible only in edit/create)
   + global 401 handling, logout-to-browse safety, Messages with image attachments + attach icon button
   + "Use my location" in listing form
   + City autocomplete + semantic location search (fuzzy), still restricted to existing listing locations
*/

(() => {
  const { useEffect, useMemo, useRef, useState } = React;

  // small bridge so api can redirect UI on 401s
  const AppNav = { setUser: () => {}, setTab: () => {} };

  // --- Helpers ---
  function H(tag, props, ...children) { return React.createElement(tag, props || null, ...children); }
  function price(n) { return Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' }); }
  function seenKey(userId){ return `listit_seen_${userId||'anon'}`; }
  function loadSeen(userId){ try{ return JSON.parse(localStorage.getItem(seenKey(userId))||'{}'); }catch{ return {}; } }
  function saveSeen(userId, map){ try{ localStorage.setItem(seenKey(userId), JSON.stringify(map||{})); }catch{} }

  // --- API (centralized 401 handling) ---
  const api = {
    async _fetch(url, opts = {}) {
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
    },

    me()              { return this._fetch('/api/me', { method:'GET' }); },
    register(payload) { return this._fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); },
    login(email, password) {
      return this._fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email, password }) });
    },
    async logout() {
      try { await this._fetch('/api/logout', { method:'POST' }); } catch {}
    },

    async listAll(q, loc) {
      const params = new URLSearchParams();
      if (q)   params.set('q', q);
      if (loc) params.set('loc', loc);
      const url = '/api/listings' + (params.toString() ? `?${params.toString()}` : '');
      const r = await fetch(url);
      return r.json();
    },
    listMine()      { return this._fetch('/api/listings?mine=1', { method:'GET' }); },
    createListing(payload) {
      return this._fetch('/api/listings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    },
    updateListing(id, payload) {
      return this._fetch(`/api/listings/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    },
    deleteListing(id) { return this._fetch(`/api/listings/${id}`, { method:'DELETE' }); },

    adminDeleteListing(id) { return this._fetch(`/api/admin/listings/${id}`, { method:'DELETE' }); },
    adminDeleteAll()       { return this._fetch('/api/admin/listings', { method:'DELETE' }); },

    ensureConversation({ with_user_id, listing_id }) {
      return this._fetch('/api/conversations', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ with_user_id, listing_id }) });
    },
    listConversations() { return this._fetch('/api/conversations', { method:'GET' }); },
    getMessages(id)     { return this._fetch(`/api/conversations/${id}/messages`, { method:'GET' }); },
    sendMessage(id, body, images){
      return this._fetch(`/api/conversations/${id}/messages`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ body, images })
      });
    },

    getListingImages(id){ return this._fetch(`/api/listings/${id}/images`, { method:'GET' }); },

    aiAnalyze({ images, hint }) {
      return this._fetch('/api/ai/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ images, hint }) });
    },

    reverseGeocode(lat, lon) {
      return this._fetch(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { method: 'GET' });
    }
  };

  // --- Attach icon button ---
  function AttachButton({ onClick, title = 'Attach images' }) {
    return H('button', {
      className: 'icon-btn',
      type: 'button',
      onClick,
      title,
      'aria-label': title,
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

  // --- City Autocomplete (client-side from existing listings) ---
  function CityAutocomplete({ value, onChange, options, onUseMyLocation }) {
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState(0);
    const boxRef = useRef(null);

    const list = useMemo(() => {
      const v = (value || '').trim().toLowerCase();
      if (!v) return options.slice(0, 8);
      return options.filter(c => c.toLowerCase().includes(v)).slice(0, 8);
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

  // --- Header ---
  function Header({ user, setUser, onNav, active, unreadCount, onAdminDeleteAll }) {
    const authArea = user
      ? H('div', { className: 'row', style: { gap: 8 } },
          H('div', { className: 'muted' }, user.username ? `@${user.username}` : user.email),
          user.is_admin && H('button', {
            className: 'btn danger',
            onClick: async () => {
              if (confirm('Delete ALL listings? This cannot be undone.')) {
                await onAdminDeleteAll?.();
              }
            }
          }, 'Admin: Delete ALL'),
          H('button', { className: 'btn', onClick: async () => {
            await api.logout();
            setUser(null);
            onNav('browse');   // immediate bounce
          } }, 'Log out')
        )
      : H(AuthButtons, { setUser });

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
          H('div', { style: { width: 36, height: 36, borderRadius: 12, background: '#111', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 } }, 'L'),
          H('div', null, H('div', { style: { fontWeight: 800 } }, 'ListIt'), H('div', { className: 'muted' }, 'Sell simply'))
        ),
        H('nav', { className: 'row' },
          H('button', { className: `btn ${active==='browse'?'primary':''}`, onClick: () => onNav('browse') }, 'Listings'),
          messagesBtn
        ),
        authArea
      )
    );
  }

  function AuthButtons({ setUser }) {
    const [mode, setMode] = useState('login');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [err, setErr] = useState('');

    async function go() {
      setErr('');
      try {
        if (mode === 'login') {
          const u = await api.login(email, password);
          setUser(u); setEmail(''); setPassword('');
        } else {
          const u = await api.register({ username, email, password });
          setUser(u); setUsername(''); setEmail(''); setPassword('');
        }
      } catch(e){ setErr(e.message); }
    }

    return H('div', { className: 'row', style: { gap: 8 } },
      H('div', { className: 'row', style: { gap: 6 } },
        H('button', { className: `btn ${mode==='login'?'primary':''}`, onClick: () => setMode('login') }, 'Log in'),
        H('button', { className: `btn ${mode==='register'?'primary':''}`, onClick: () => setMode('register') }, 'Register')
      ),
      err && H('span', { className: 'muted', style: { color: '#be123c' } }, err),
      mode==='register' && H('input', { placeholder: 'Username', value: username, onChange: e => setUsername(e.target.value) }),
      H('input', { placeholder: 'Email', value: email, onChange: e => setEmail(e.target.value) }),
      H('input', { placeholder: 'Password', type: 'password', value: password, onChange: e => setPassword(e.target.value) }),
      H('button', { className: 'btn primary', onClick: go }, mode==='login' ? 'Log in' : 'Create account')
    );
  }

  // --- Multi Image Picker for listings ---
  function MultiImagePicker({ values, onChange }) {
    const ref = useRef();
    const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

    async function pick(e) {
      const files = Array.from(e.target.files || []);
      const newImgs = [];
      for (const f of files) {
        if (f.size > 3*1024*1024) { alert('Each image must be under 3MB'); continue; }
        newImgs.push(await toB64(f));
      }
      onChange([...(values||[]), ...newImgs]);
      ref.current.value = '';
    }
    function removeAt(i) {
      const next = [...values]; next.splice(i,1); onChange(next);
    }

    return H('div', null,
      H('div', { className:'row' },
        H('input', { type:'file', accept:'image/*', multiple:true, ref, onChange: pick }),
        H('span', { className:'muted' }, `${(values||[]).length} image(s)`)
      ),
      H('div', { className:'row', style:{ flexWrap:'wrap', gap:8, marginTop:8 } },
        ...(values||[]).map((src,i)=> H('div', { key:i, style:{ position:'relative' } },
          H('img', { src, style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #ddd' } }),
          H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, onClick:()=>removeAt(i) }, '×')
        ))
      )
    );
  }

  // --- Listing Form (adds "Use my location") ---
  function ListingForm({ draft, onCancel, onSaved }) {
    const [images, setImages] = useState([]);
    const [title, setTitle] = useState(draft?.title || '');
    the [description, setDescription] = useState(draft?.description || '');
    const [location, setLocation] = useState(draft?.location || '');
    const [priceVal, setPriceVal] = useState(draft?.price?.toString?.() || '');
    const [tags, setTags] = useState(Array.isArray(draft?.tags) ? draft.tags.join(', ') : '');
    const [aiBusy, setAiBusy] = useState(false);
    const [aiErr, setAiErr] = useState('');

    const [geoBusy, setGeoBusy] = useState(false);
    const [geoErr, setGeoErr] = useState('');

    useEffect(() => {
      (async () => {
        if (draft?.id) {
          try { const arr = await api.getListingImages(draft.id); setImages(arr || [draft.image_data].filter(Boolean)); }
          catch { setImages([draft.image_data].filter(Boolean)); }
        } else { setImages([]); }
      })();
    }, [draft?.id]);

    async function runAI(){
      setAiErr(''); setAiBusy(true);
      try {
        if (!images.length) { alert('Add at least one image first.'); return; }
        const res = await api.aiAnalyze({ images, hint: `${title} ${description}`.trim() });
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
      } catch (e) {
        setGeoErr('Could not get your location');
      } finally {
        setGeoBusy(false);
      }
    }

    async function submit(e){
      e.preventDefault();
      const payload = {
        images,
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        price: Number(priceVal),
        tags
      };
      if (!images.length || !payload.description || !payload.location || Number.isNaN(payload.price) || payload.price <= 0) {
        alert('Fill all fields and add at least one image.');
        return;
      }
      if (draft) await api.updateListing(draft.id, payload); else await api.createListing(payload);
      onSaved?.();
    }

    return H('form', { onSubmit: submit, className:'row', style:{flexDirection:'column', gap:12}},
      H(MultiImagePicker, { values:images, onChange:setImages }),

      H('div', { className:'row', style:{ gap:8 } },
        H('button', { type:'button', className:`btn ${aiBusy?'':'primary'}`, disabled:aiBusy, onClick:runAI }, aiBusy ? 'Analyzing…' : 'Run AI analysis'),
        aiErr && H('span', { className:'muted', style:{ color:'#b91c1c' } }, aiErr),
        H('span', { className:'muted' }, 'Generates a concise title, ~20 tags, and a suggested price')
      ),

      H('label', null, 'Title'),
      H('input', { value:title, maxLength:80, onChange:e=>setTitle(e.target.value) }),

      H('label', null, 'Description'),
      H('textarea', { value:description, maxLength:400, onChange:e=>setDescription(e.target.value) }),

      H('label', null, 'Location'),
      H('div', { className:'row', style:{ gap:8 } },
        H('input', { value:location, maxLength:80, onChange:e=>setLocation(e.target.value), placeholder:'City, State' }),
        H('button', { type:'button', className:'btn', onClick:useMyLocation, disabled:geoBusy }, geoBusy ? 'Locating…' : 'Use my location'),
        geoErr && H('span', { className:'muted', style:{ color:'#b91c1c' } }, geoErr)
      ),

      H('label', null, 'Price'),
      H('input', { value:priceVal, inputMode:'decimal', onChange:e=>setPriceVal(e.target.value.replace(/[^0-9.]/g,'')) }),

      H('div', { className:'card', style:{ padding:12, background:'#fafafa' } },
        H('div', { style:{ fontWeight:600, marginBottom:6 } }, 'Search tags (private)'),
        H('div', { className:'muted', style:{ marginBottom:6 } }, 'Not shown publicly; help others find your item. Example: "car, suv, 4x4".'),
        H('input', { placeholder:'e.g. car, suv, 4x4', value:tags, onChange:e=>setTags(e.target.value) })
      ),

      H('div', { className:'row' },
        H('button', { className:'btn primary', type:'submit' }, draft ? 'Save changes' : 'Create listing'),
        H('button', { className:'btn', type:'button', onClick:onCancel }, 'Cancel')
      )
    );
  }

  // --- Lightbox ---
  function Lightbox({ open, images, index, onClose, onIndex }) {
    const esc = (e)=> { if(e.key==='Escape') onClose(); };
    React.useEffect(()=>{ if(open){ window.addEventListener('keydown', esc); return ()=> window.removeEventListener('keydown', esc); }}, [open]);
    if(!open) return null;
    function prev(){ onIndex((index-1+images.length)%images.length); }
    function next(){ onIndex((index+1)%images.length); }
    return H('div', { className:'modal open', onClick:(e)=>{ if(e.target.classList.contains('modal')) onClose(); } },
      H('div', { className:'modal-inner' },
        H('button', { className:'close', onClick:onClose }, '✕'),
        H('button', { className:'arrow left', onClick:prev }, '◀'),
        H('img', { src: images[index] }),
        H('button', { className:'arrow right', onClick:next }, '▶'),
        H('div', { className:'thumbs' },
          ...images.map((img,i)=> H('img', { key:i, src:img, className: i===index?'active':'', onClick:()=>onIndex(i) }))
        )
      )
    );
  }

  // --- Listing card ---
  function ListingCard({ item, canEdit, onEdit, onDelete, user, onMessage, onAdminDelete }) {
    const [open, setOpen] = useState(false);
    const [images, setImages] = useState(null);
    const [idx, setIdx] = useState(0);

    async function openModal(start=0){
      if(!images){ try { const arr = await api.getListingImages(item.id); setImages(arr && arr.length ? arr : [item.image_data]); } catch { setImages([item.image_data]); } }
      setIdx(start); setOpen(true);
    }

    const controls = [];
    if (!user || user.id !== item.user_id) {
      controls.push(H('button', { key:'m', className:'btn primary', onClick:()=>onMessage(item) }, 'Message seller'));
    }
    if (canEdit) {
      controls.push(H('button', { key:'e', className:'btn', onClick:()=>onEdit(item) }, 'Edit'));
      controls.push(H('button', { key:'d', className:'btn danger', onClick:()=>onDelete(item) }, 'Remove Listing'));
    }
    if (user?.is_admin) {
      controls.push(H('button', {
        key:'admin-del',
        className:'btn danger',
        onClick: async () => {
          if (!confirm('Admin: Delete this listing?')) return;
          await api.adminDeleteListing(item.id);
          onAdminDelete?.(item.id);
        }
      }, 'Admin Delete'));
    }

    return H('div', { className:'card' },
      H('div', { className:'aspect', onClick:()=>openModal(0), style:{ cursor:'zoom-in' } }, H('img', { src:item.image_data })),
      H('div', { style:{ padding:16 } },
        H('div', { className:'row', style:{ justifyContent:'space-between', alignItems:'start' } },
          H('div', null,
            H('div', { style:{ fontWeight:800 } }, item.title || 'Item for sale'),
            H('div', { className:'muted' }, item.description)
          ),
          H('div', { style:{ fontWeight:800, textAlign:'right' } }, price(item.price))
        ),
        H('div', { className:'muted' }, item.location),
        H('div', { className:'muted' }, `Seller: ${item.owner_username ? '@'+item.owner_username : '—'}`),
        H('div', { className:'row', style:{ marginTop:8, justifyContent:'flex-start', gap:8 } }, ...controls)
      ),
      H(Lightbox, { open, images: images || [item.image_data], index: idx, onClose:()=>setOpen(false), onIndex:setIdx })
    );
  }

  // --- Messages (with image attachments + attach icon) ---
  function MessagesPanel({ user, initialActiveId, onSeenChange }) {
    if (!user) return H('div', { className:'muted' }, 'Please log in to view messages.');

    const [convos, setConvos] = useState([]);
    const [activeId, setActiveId] = useState(initialActiveId || null);
    const [msgs, setMsgs] = useState([]);
    const [input, setInput] = useState('');
    const pollRef = useRef(null);

    // attachments state
    const [imgFiles, setImgFiles] = useState([]); // data URLs
    const fileRef = useRef();
    const [lb, setLb] = useState({ open:false, images:[], index:0 });

    const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    async function pickImgs(e){
      const files = Array.from(e.target.files || []);
      const next = [...imgFiles];
      for (const f of files) {
        if (f.size > 3*1024*1024) { alert('Each image must be under 3MB'); continue; }
        next.push(await toB64(f));
        if (next.length >= 5) break;
      }
      setImgFiles(next);
      if (fileRef.current) fileRef.current.value = '';
    }
    function removeImg(i){
      const n = [...imgFiles]; n.splice(i,1); setImgFiles(n);
    }
    function openLightbox(images, index=0){ setLb({ open:true, images, index }); }

    useEffect(() => { if (initialActiveId) setActiveId(initialActiveId); }, [initialActiveId]);

    async function fetchConvos(){ try{ setConvos(await api.listConversations()); } catch(_){} }
    async function fetchMsgs(){
      if(!activeId) return;
      try{
        const arr = await api.getMessages(activeId);
        setMsgs(arr);
        if (arr.length) onSeenChange?.(activeId, arr[arr.length-1].id);
      } catch{}
    }

    useEffect(()=>{ fetchConvos(); }, []);
    useEffect(()=>{
      fetchMsgs();
      if(pollRef.current) clearInterval(pollRef.current);
      if(activeId){ pollRef.current = setInterval(fetchMsgs, 2500); }
      return ()=> pollRef.current && clearInterval(pollRef.current);
    }, [activeId]);

    async function send(){
      const bodyTrim = (input || '').trim();
      if(!bodyTrim && imgFiles.length === 0) return;
      await api.sendMessage(activeId, bodyTrim, imgFiles);
      setInput('');
      setImgFiles([]);
      await fetchMsgs();
      await fetchConvos();
    }

    const seenMap = loadSeen(user?.id);
    const convosDecorated = (convos||[]).map(c => {
      const unread = !!(c.last_message_id && c.last_message_sender_id && c.last_message_sender_id !== user.id && (!seenMap[c.id] || seenMap[c.id] < c.last_message_id));
      return { ...c, _unread: unread };
    }).sort((a,b) => {
      const ua = a._unread ? 1 : 0, ub = b._unread ? 1 : 0;
      if (ub - ua) return ub - ua;
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });

    return H('div', { className:'split' },
      H('aside', { className:'card sidebar', style:{ padding:12 } },
        H('div', { style:{ fontWeight:700, marginBottom:8 } }, 'Conversations'),
        ...(convosDecorated.length ? convosDecorated.map(c => H('div', {
            key:c.id,
            className:'row',
            style:{ padding:'8px 6px', borderRadius:12, cursor:'pointer', background: c.id===activeId?'#f3f4f6':'transparent', position:'relative' },
            onClick:()=>setActiveId(c.id)
          },
          H('div', { style:{ fontWeight:600 } }, c.other_user_username ? '@'+c.other_user_username : 'Unknown'),
          c.listing_title ? H('div', { className:'muted' }, ` • ${c.listing_title?.slice?.(0,24)}`) : null,
          c._unread && H('span', { style:{ marginLeft:'auto', width:8, height:8, borderRadius:8, background:'#ef4444' } })
        )) : [H('div', { key:'empty', className:'muted' }, 'No conversations yet')])
      ),
      H('section', { className:'card col', style:{ padding:12, display:'flex', flexDirection:'column' } },
        !activeId && H('div', { className:'muted' }, 'Select a conversation'),
        activeId && H('div', { style:{ flex:1, overflow:'auto', padding:4 } },
          msgs.map(m => H('div', { key:m.id, className:`message ${m.sender_id===user.id?'mine':'their'}` },
            m.body && H('div', null, m.body),
            Array.isArray(m.images) && m.images.length > 0 &&
              H('div', { className:'row', style:{ gap:6, marginTop:6, flexWrap:'wrap' } },
                ...m.images.map((src, i) =>
                  H('img', { key:i, src, style:{ width:140, height:140, objectFit:'cover', borderRadius:10, border:'1px solid #e5e7eb', cursor:'zoom-in' },
                    onClick:()=>openLightbox(m.images, i) })
                )
              )
          ))
        ),
        activeId && H('div', { className:'row', style:{ alignItems:'center', gap:8 } },
          H('input', {
            type:'file', accept:'image/*', multiple:true, ref:fileRef, onChange: pickImgs,
            style:{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }
          }),
          H(AttachButton, { onClick: () => fileRef.current && fileRef.current.click() }),
          H('input', {
            placeholder:'Type a message…',
            value:input,
            onChange:e=>setInput(e.target.value),
            onKeyDown:e=>{ if(e.key==='Enter') send(); },
            style:{ flex:1 }
          }),
          H('button', { className:'btn primary', onClick:send }, 'Send')
        ),
        imgFiles.length > 0 && H('div', { className:'row', style:{ gap:8, padding:'6px 0' } },
          ...imgFiles.map((src,i)=> H('div', { key:i, style:{ position:'relative' } },
            H('img', { src, style:{ width:48, height:48, objectFit:'cover', borderRadius:8, border:'1px solid #ddd' } }),
            H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:-6, right:-6, padding:'2px 6px' }, onClick:()=>removeImg(i) }, '×')
          ))
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

  // --- App ---
  function App(){
    const { user, setUser } = useAuth();
    const [tab, setTab] = useState('browse');
    const [all, setAll] = useState([]);
    const [mine, setMine] = useState([]);
    const [query, setQuery] = useState('');
    const [locationQuery, setLocationQuery] = useState('');
    const [sort, setSort] = useState('new');
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);

    const [activeConvoId, setActiveConvoId] = useState(null);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => { AppNav.setUser = setUser; AppNav.setTab = setTab; }, [setUser, setTab]);

    const mineById = useMemo(() => {
      const map = Object.create(null);
      (mine || []).forEach(m => { map[m.id] = m; });
      return map;
    }, [mine]);

    async function reload(){
      const [a, m] = await Promise.all([ api.listAll('', locationQuery), user ? api.listMine() : Promise.resolve([]) ]);
      setAll(a); setMine(m||[]);
    }
    useEffect(()=>{ reload(); }, [user?.id, locationQuery]);

    useEffect(() => {
      (async () => {
        const a = await api.listAll(query.trim() || '', locationQuery.trim() || '');
        setAll(a);
      })();
    }, [query, locationQuery]);

    async function recomputeUnread() {
      try {
        if (!user) { setUnreadCount(0); return; }
        const convos = await api.listConversations();
        const seen = loadSeen(user.id);
        const n = (convos || []).filter(c =>
          c.last_message_id &&
          c.last_message_sender_id &&
          c.last_message_sender_id !== user.id &&
          (!seen[c.id] || seen[c.id] < c.last_message_id)
        ).length;
        setUnreadCount(n);
      } catch {}
    }
    useEffect(() => {
      let t;
      recomputeUnread();
      t = setInterval(recomputeUnread, 3000);
      return () => clearInterval(t);
    }, [user?.id]);

    useEffect(() => {
      if (!user && tab === 'messages') setTab('browse');
    }, [user, tab]);

    const feed = useMemo(()=>{
      const list = [...(all || [])];
      if (sort === 'price_asc') {
        list.sort((a,b)=>a.price-b.price);
      } else if (sort === 'price_desc') {
        list.sort((a,b)=>b.price-a.price);
      } else if (sort === 'city') {
        list.sort((a,b)=>{
          const la = (a.location || '').toLowerCase();
          const lb = (b.location || '').toLowerCase();
          return la.localeCompare(lb);
        });
      } else {
        list.sort((a,b)=>b.id-a.id); // newest
      }
      return list;
    }, [all, sort]);

    // derive distinct city options for autocomplete
    const cityOptions = useMemo(() => {
      const set = new Set();
      (all || []).forEach(l => {
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
      setAll(prev => prev.filter(x => x.id !== listingId));
      setMine(prev => prev.filter(x => x.id !== listingId));
    }

    return H(React.Fragment, null,
      H(Header, { user, setUser, onNav:setTab, active:tab, unreadCount, onAdminDeleteAll: handleAdminDeleteAll }),
      H('main', { className:'container' },
        tab==='browse' && H(React.Fragment, null,
          H('div', { className:'row', style:{ justifyContent:'space-between', margin:'12px 0 18px' } },
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
            H('button', { className:'btn primary', onClick:()=>{ if(!user){ alert('Log in to create a listing.'); return; } setEditing(null); setShowForm(true); } }, 'New listing')
          ),

          showForm && H('section', { className:'card', style:{ padding:16, marginBottom:16 } },
            H(ListingForm, {
              draft: editing,
              onCancel:()=>setShowForm(false),
              onSaved: async ()=>{ setShowForm(false); setEditing(null); await reload(); }
            })
          ),

          H('section', { className:'grid' },
            feed.map(item => {
              const mineItem = mineById[item.id];
              return H(ListingCard, {
                key:item.id,
                item,
                user,
                canEdit: !!mineItem,
                onEdit:(it)=>{
                  const rich = mineById[it.id] || it;
                  setEditing(rich);
                  setShowForm(true);
                  window.scrollTo({ top:0, behavior:'smooth' });
                },
                onDelete: async(it)=>{ if(confirm('Remove this listing? (Your past messages will remain)')){ await api.deleteListing(it.id); await reload(); } },
                onMessage: startMessage,
                onAdminDelete: handleAdminDelete
              });
            })
          ),
          !feed.length && H('p', { className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No listings yet.')
        ),
        (tab==='messages') &&
          (user
            ? H(MessagesPanel, { user, initialActiveId: activeConvoId, onSeenChange: handleSeen })
            : H('div', { className:'muted', style:{ padding:'16px 0' } }, 'Please log in to view messages.')
          )
      )
    );
  }

  function useAuth() {
    const [user, setUser] = useState(null);
    useEffect(() => { api.me().then(setUser).catch(()=>setUser(null)); }, []);
    return { user, setUser };
  }

  ReactDOM.render(H(App), document.getElementById('root'));
})();

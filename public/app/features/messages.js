(() => {
  function createMessagesFeature({ React, ReactDOM, api, uploads, helpers, components }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Messages feature requires React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Messages feature requires ReactDOM.');
    }
    if (!api) {
      throw new Error('Messages feature requires an API client.');
    }

    const {
      useState,
      useEffect,
      useMemo,
      useRef,
      useCallback
    } = React;

    const uploadOneMessageImage = uploads?.uploadOneMessageImage;
    const useFilePreviews = uploads?.useFilePreviews;
    if (typeof uploadOneMessageImage !== 'function') {
      throw new Error('Messages feature requires uploadOneMessageImage helper.');
    }
    if (typeof useFilePreviews !== 'function') {
      throw new Error('Messages feature requires useFilePreviews hook.');
    }

    const loadSeen = helpers?.loadSeen;
    if (typeof loadSeen !== 'function') {
      throw new Error('Messages feature requires loadSeen helper.');
    }

    const Lightbox = components?.Lightbox;
    const ImageWithSkeleton = components?.ImageWithSkeleton;
    if (typeof Lightbox !== 'function' || typeof ImageWithSkeleton !== 'function') {
      throw new Error('Messages feature requires media components.');
    }

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function AttachButton({ onClick, title = 'Attach images', variant = 'library' }) {
      const icon = variant === 'camera'
        ? H('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
            H('rect', { x: 3, y: 6, width: 18, height: 13, rx: 3, stroke: '#9ca3af', 'stroke-width': 2 }),
            H('path', { d: 'M9 6l1.5-2h3L15 6', stroke: '#9ca3af', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
            H('circle', { cx: 12, cy: 12.5, r: 3, stroke: '#9ca3af', 'stroke-width': 2 })
          )
        : H('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
            H('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2, stroke: '#9ca3af', 'stroke-width': 2 }),
            H('circle', { cx: 9, cy: 10, r: 2, fill: '#9ca3af' }),
            H('path', { d: 'M7 18l4-4 3 3 4-5 3 4', stroke: '#9ca3af', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
          );
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
      }, icon);
    }

    function MessagesPanel({ user, initialActiveId, onSeenChange, onConversationsUpdate }) {
      if (!user) return H('div', { className:'muted' }, 'Please log in to view messages.');

      const [convos, setConvos] = useState([]);
      const [activeId, setActiveId] = useState(initialActiveId || null);
      const [msgs, setMsgs] = useState([]);
      const [input, setInput] = useState('');
      const [imgFiles, setImgFiles] = useState([]);
      const imgPreviews = useFilePreviews(imgFiles);
      const cameraFileRef = useRef();
      const libraryFileRef = useRef();
      const [lb, setLb] = useState({ open:false, images:[], index:0 });
      const pollRef = useRef(null);
      const dropRef = useRef();
      const wsRef = useRef(null);
      const reconnectTimeoutRef = useRef(null);

      const msgsContainerRef = useRef(null);
      const [isAtBottom, setIsAtBottom] = useState(true);
      const formatMessageTimestamp = (value) => {
        if (!value) return '';
        const dt = new Date(value);
        if (!Number.isFinite(dt.getTime())) return value;
        return dt.toLocaleString();
      };

      const isAtBottomRef = useRef(isAtBottom);

      useEffect(() => {
        isAtBottomRef.current = isAtBottom;
      }, [isAtBottom]);

      const checkIfAtBottom = () => {
        const container = msgsContainerRef.current;
        if (!container) return;
        const threshold = 50;
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
        setIsAtBottom(atBottom);
      };

      useEffect(() => {
        if (!user) return;

        function connectWebSocket() {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = `${protocol}//${window.location.host}/ws`;
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;

          ws.onopen = () => {
            clearTimeout(reconnectTimeoutRef.current);
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);

              if (data.type === 'new_message') {
                setActiveId(currentActiveId => {
                  if (data.conversation_id === currentActiveId) {
                    setMsgs(prev => [...prev, data.message]);

                    if (data.sender_id !== user.id && isAtBottomRef.current) {
                      onSeenChange?.(data.conversation_id, data.message.id);
                    }
                  }

                  fetchConvos();

                  return currentActiveId;
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
            wsRef.current = null;

            if (event?.code !== 1008) {
              reconnectTimeoutRef.current = setTimeout(() => {
                if (user) connectWebSocket();
              }, 3000);
            }
          };

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

        const cleanup = connectWebSocket();

        return () => {
          if (typeof cleanup === 'function') cleanup();
          clearTimeout(reconnectTimeoutRef.current);
          if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
          }
        };
      }, [user?.id]);

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
        if (e?.target) e.target.value = '';
      }

      function onComposerPaste(e){
        const cd = e.clipboardData;
        if (!cd) return;
        const imageItems = Array.from(cd.items || []).filter(it => it.kind === 'file' && it.type.startsWith('image/'));
        if (imageItems.length === 0) return;
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

      async function fetchConvos(){
        try{
          const list = await api.listConversations({ silent:true });
          setConvos(list);
          onConversationsUpdate?.(list);
        } catch(_){}
      }
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
        const ok = confirm('Delete this conversation from your inbox? The other participant will keep the messages.');
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
      }, [activeId]);

      async function send(){
        const bodyTrim = (input || '').trim();
        if(!bodyTrim && imgFiles.length === 0) return;

        const urls = [];
        for (const f of imgFiles) {
          const url = await uploadOneMessageImage(f);
          urls.push(url);
        }

        let resp;
        try {
          resp = await api.sendMessage(activeId, bodyTrim, urls);
        } catch (e) {
          alert(e?.message || 'Send failed');
          return;
        }

        if (resp?.other_user_deleted) {
          alert('Heads up: This user deleted the conversation. They may not see your new message.');
        }

        setInput('');
        setImgFiles([]);
        await fetchMsgs();
        await fetchConvos();

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
        let resp;
        try {
          resp = await api.sendMessage(activeId, msg, []);
        } catch (e) {
          alert(e?.message || 'Send failed');
          return;
        }

        if (resp?.other_user_deleted) {
          alert('Heads up: This user deleted the conversation. They may not see your new message.');
        }
        await fetchMsgs();
        await fetchConvos();
      }

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
                      H(ImageWithSkeleton, { key:i, src, loading:'lazy', decoding:'async', style:{ width:140, height:140, objectFit:'cover', borderRadius:10, border:'1px solid #e5e7eb', cursor:'zoom-in' },
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
                H(ImageWithSkeleton, { src: url, style:{ width:72, height:72, objectFit:'cover', borderRadius:10, border:'1px solid #e5e7eb' } }),
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
              type:'file', accept:'image/*', capture:'environment', ref:cameraFileRef, onChange: pickImgs,
              style:{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }
            }),
            H('input', {
              type:'file', accept:'image/*', multiple:true, ref:libraryFileRef, onChange: pickImgs,
              style:{ position:'absolute', width:1, height:1, opacity:0, pointerEvents:'none' }
            }),
            H(AttachButton, { onClick: () => cameraFileRef.current && cameraFileRef.current.click(), title: 'Take a photo', variant: 'camera' }),
            H(AttachButton, { onClick: () => libraryFileRef.current && libraryFileRef.current.click(), title: 'Attach from photos', variant: 'library' }),
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

    return { MessagesPanel };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.messages = {
    createMessagesFeature
  };
})();

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

  const core = window.ListItCore || {};
  const {
    createApiClient,
    formatCurrency,
    formatDistance,
    haversineMeters: coreHaversineMeters
  } = core;

  if (typeof createApiClient !== 'function') {
    throw new Error('ListIt core bundle failed to load.');
  }

  const price = (n) => formatCurrency(n ?? 0);
  const fmtDistance = (m) => formatDistance(m);
  const haversineMeters = (...args) => coreHaversineMeters(...args);

  // Device detection helper provided by modular helpers bundle

  // small bridge so api can redirect UI on 401s + track global loading
  const AppNav = { setUser: () => {}, setTab: () => {}, incLoad: () => {}, decLoad: () => {}, notifyLocked: () => {} };
  const PAGE_SIZE = 75;

  const helpersFactory = window.ListItApp?.helpers?.createHelpers;
  if (typeof helpersFactory !== 'function') {
    throw new Error('Helpers bundle failed to load.');
  }
  const {
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
    useVirtualMasonry
  } = helpersFactory({ React });

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

  // --- API ---
  const api = createApiClient({
    onRequestStart: () => AppNav.incLoad(),
    onRequestEnd: () => AppNav.decLoad(),
    onUnauthorized: () => {
      AppNav.setUser(null);
      AppNav.setTab('browse');
    },
    onAccountLocked: () => AppNav.notifyLocked(),
    fetchImpl: (input, init) => fetch(input, init)
  });

  const authFeatureFactory = window.ListItApp?.features?.auth?.createAuthFeature;
  if (typeof authFeatureFactory !== 'function') {
    throw new Error('Auth feature bundle failed to load.');
  }
  const { AuthProvider, useAuth, AuthModal } = authFeatureFactory({ api, ReactDOM });

  const uploadsFeatureFactory = window.ListItApp?.features?.uploads?.createUploadsFeature;
  if (typeof uploadsFeatureFactory !== 'function') {
    throw new Error('Uploads feature bundle failed to load.');
  }
  const {
    dedupeImageUrls,
    collectListingImages,
    selectPrimaryListingImage,
    clearDraftCacheForFile,
    uploadFileDraft,
    fetchListingImagesCached,
    prepareListingForModal,
    warmListingImages,
    uploadFilesForListing,
    uploadOneMessageImage,
    listingImageCache,
    listingImageInFlight,
    useFilePreviews,
    filesToDataUrls,
    fileToDataUrl,
    AI_IMAGE_LIMIT
  } = uploadsFeatureFactory({ api, React });

  const mediaComponentsFactory = window.ListItApp?.components?.media?.createMediaComponents;
  if (typeof mediaComponentsFactory !== 'function') {
    throw new Error('Media components bundle failed to load.');
  }
  const { Lightbox, ImageWithSkeleton, ResponsiveImage } = mediaComponentsFactory({ React, ReactDOM });

  const adsComponentsFactory = window.ListItApp?.components?.ads?.createAdsComponents;
  if (typeof adsComponentsFactory !== 'function') {
    throw new Error('Ads components bundle failed to load.');
  }
  const { AdTile } = adsComponentsFactory({
    React,
    components: { ImageWithSkeleton }
  });

  const gridComponentsFactory = window.ListItApp?.components?.grid?.createGridComponents;
  if (typeof gridComponentsFactory !== 'function') {
    throw new Error('Grid components bundle failed to load.');
  }
  const { GridTile } = gridComponentsFactory({
    React,
    components: { ImageWithSkeleton }
  });

  const layoutComponentsFactory = window.ListItApp?.components?.layout?.createLayoutComponents;
  if (typeof layoutComponentsFactory !== 'function') {
    throw new Error('Layout components bundle failed to load.');
  }
  const { Header, GlobalLoader } = layoutComponentsFactory({ React });

  const listingsFeatureFactory = window.ListItApp?.features?.listings?.createListingsFeature;
  if (typeof listingsFeatureFactory !== 'function') {
    throw new Error('Listings feature bundle failed to load.');
  }
  const { useListingsFeature, CityAutocomplete } = listingsFeatureFactory({
    React,
    api,
    helpers: {
      normalizeListingsResponse,
      asArray,
      selectPrimaryListingImage,
      pageSize: PAGE_SIZE
    }
  });

  const notificationsFeatureFactory = window.ListItApp?.features?.notifications?.createNotificationsFeature;
  if (typeof notificationsFeatureFactory !== 'function') {
    throw new Error('Notifications feature bundle failed to load.');
  }
  const { useMessageNotifications } = notificationsFeatureFactory({ React });

  const messagesFeatureFactory = window.ListItApp?.features?.messages?.createMessagesFeature;
  if (typeof messagesFeatureFactory !== 'function') {
    throw new Error('Messages feature bundle failed to load.');
  }
  const { MessagesPanel } = messagesFeatureFactory({
    React,
    ReactDOM,
    api,
    uploads: {
      uploadOneMessageImage,
      useFilePreviews
    },
    helpers: {
      loadSeen
    },
    components: {
      Lightbox,
      ImageWithSkeleton
    }
  });

  const adminFeatureFactory = window.ListItApp?.features?.admin?.createAdminFeature;
  if (typeof adminFeatureFactory !== 'function') {
    throw new Error('Admin feature bundle failed to load.');
  }
  const { AdminDashboard } = adminFeatureFactory({
    React,
    ReactDOM,
    api,
    components: {
      AdTile
    }
  });

  const listingQueueFeatureFactory = window.ListItApp?.features?.listingQueue?.createListingQueueFeature;
  if (typeof listingQueueFeatureFactory !== 'function') {
    throw new Error('Listing queue feature bundle failed to load.');
  }
  const { useListingQueue } = listingQueueFeatureFactory({ React });

  const listingQueueContextFactory = window.ListItApp?.contexts?.listingQueue?.createListingQueueContext;
  if (typeof listingQueueContextFactory !== 'function') {
    throw new Error('Listing queue context bundle failed to load.');
  }
  const { ListingQueueProvider, useListingQueueState, ListingQueueToast } = listingQueueContextFactory({
    React,
    useListingQueue
  });

  const listingsContextFactory = window.ListItApp?.contexts?.listings?.createListingsContext;
  if (typeof listingsContextFactory !== 'function') {
    throw new Error('Listings context bundle failed to load.');
  }
  const { ListingsProvider, useListings } = listingsContextFactory({ React });

  const notificationsContextFactory = window.ListItApp?.contexts?.notifications?.createNotificationsContext;
  if (typeof notificationsContextFactory !== 'function') {
    throw new Error('Notifications context bundle failed to load.');
  }
  const { NotificationsProvider, useNotifications } = notificationsContextFactory({ React });

  window.ListItApp.hooks = window.ListItApp.hooks || {};
  window.ListItApp.hooks.useListings = useListings;
  window.ListItApp.hooks.useNotifications = useNotifications;
  window.ListItApp.hooks.useListingQueue = useListingQueue;
  window.ListItApp.hooks.useListingQueueState = useListingQueueState;
  const listingComponentsFactory = window.ListItApp?.components?.listings?.createListingComponents;
  if (typeof listingComponentsFactory !== 'function') {
    throw new Error('Listing components bundle failed to load.');
  }
  const {
    MultiFilePicker,
    InfoHelpModal,
    AutoListHelpModal,
    AiDescriptionHelpModal,
    ListingForm,
    MassListModal,
    ReportSellerModal,
    ListingModal,
    ListingCard,
    ListingGalleryModal
  } = listingComponentsFactory({
    React,
    ReactDOM,
    api,
    uploads: {
      clearDraftCacheForFile,
      uploadFileDraft,
      uploadFilesForListing,
      useFilePreviews,
      AI_IMAGE_LIMIT,
      collectListingImages,
      dedupeImageUrls,
      fetchListingImagesCached,
      listingImageCache,
      listingImageInFlight
    },
    helpers: {
      isMobileDevice,
      createConcurrencyLimiter,
      fetchCoordsAndReverse,
      getUserCoordsOnce,
      useBodyScrollLock,
      haversineMeters
    },
    components: {
      ImageWithSkeleton,
      ResponsiveImage
    },
    formatting: {
      price,
      fmtDistance
    }
  });

  const listingFormsFeatureFactory = window.ListItApp?.features?.listingForms?.createListingFormsFeature;
  if (typeof listingFormsFeatureFactory !== 'function') {
    throw new Error('Listing forms feature bundle failed to load.');
  }
  const {
    SmartImage,
    ListingFormModal,
    CompactListingForm
  } = listingFormsFeatureFactory({
    React,
    ReactDOM,
    api,
    helpers: {
      isMobileDevice,
      fetchCoordsAndReverse
    },
    uploads: {
      clearDraftCacheForFile,
      uploadFileDraft,
      uploadFilesForListing,
      useFilePreviews,
      AI_IMAGE_LIMIT
    },
    formatting: {
      price
    },
    components: {
      ListingForm,
      ImageWithSkeleton
    }
  });
  window.ListItApp.legacy = window.ListItApp.legacy || {};
  window.ListItApp.legacy.SmartImage = SmartImage;

  const profileFeatureFactory = window.ListItApp?.features?.profile?.createProfileFeature;
  if (typeof profileFeatureFactory !== 'function') {
    throw new Error('Profile feature bundle failed to load.');
  }
  const { ProfilePanel } = profileFeatureFactory({
    React,
    api,
    helpers: { asArray },
    components: {
      ImageWithSkeleton,
      InfoHelpModal,
      AutoListHelpModal,
      AiDescriptionHelpModal,
      ListingModal
    },
    appNav: AppNav
  });


function App(){
    const { user, setUser, pushMeta } = useAuth();
    const [tab, setTab] = useState('browse');
    const [showForm, setShowForm] = useState(false);
    const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'login' });
    const [banner, setBanner] = useState(null);
    const [ads, setAds] = useState([]);

    const listings = useListingsFeature({ user, currentTab: tab });
    const {
      listings: all,
      setListings: setAll,
      mine,
      setMine,
      query,
      setQuery,
      locationQuery,
      setLocationQuery,
      sort,
      setSort,
      hasNext,
      isFetchingListings,
      sentinelRef,
      selectedListing,
      setSelectedListing,
      editing,
      setEditing,
      showMassList,
      setShowMassList,
      reloadMineOnly,
      refreshListings,
      toggleSold,
      cityOptions,
      items,
      ensureCover
    } = listings;

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
    
    // Pagination / infinite scroll handled via listings feature

    // Modal selection for full listing card comes from listings feature
    const [activeConvoId, setActiveConvoId] = useState(null);
    const tabRef = useRef(tab);
    const activeConvoIdRef = useRef(activeConvoId);
    const [windowFocused, setWindowFocused] = useState(() => {
      if (typeof document === 'undefined') return true;
      return !document.hidden;
    });
    const windowFocusedRef = useRef(windowFocused);
    const [unreadCount, setUnreadCount] = useState(0);
    const [hasAdminUnread, setHasAdminUnread] = useState(false);
    const [loadingCount, setLoadingCount] = useState(0);
    // Auto-list toggles (persisted)
    const AUTO_KEY = 'listit_auto_list';
    const [autoListEnabled, setAutoListEnabled] = useState(() => {
      try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
    });
    useEffect(() => { try { localStorage.setItem(AUTO_KEY, autoListEnabled ? '1' : '0'); } catch {} }, [autoListEnabled]);

    const AI_DESC_KEY = 'listit_ai_descriptions';
    const [aiDescriptionEnabled, setAiDescriptionEnabled] = useState(() => {
      try { return localStorage.getItem(AI_DESC_KEY) === '1'; } catch { return false; }
    });
    useEffect(() => { try { localStorage.setItem(AI_DESC_KEY, aiDescriptionEnabled ? '1' : '0'); } catch {} }, [aiDescriptionEnabled]);

    const AUTO_NEAR_KEY = 'listit_auto_post_nearby';
    const [autoPostNearbyEnabled, setAutoPostNearbyEnabled] = useState(() => {
      try { return localStorage.getItem(AUTO_NEAR_KEY) === '1'; } catch { return false; }
    });
    useEffect(() => { try { localStorage.setItem(AUTO_NEAR_KEY, autoPostNearbyEnabled ? '1' : '0'); } catch {} }, [autoPostNearbyEnabled]);

    const isMobile = isMobileDevice();

    const {
      backgroundQueueEnabled,
      enqueueListingJob
    } = useListingQueueState();

    const pushSetupRef = useRef({ userId: null, permission: null });

    const notifications = useMessageNotifications({
      onSelectConversation: (conversationId) => {
        setViewingSeller(null);
        setTab('messages');
        setActiveConvoId(conversationId || null);
      }
    });

    const {
      messageToasts,
      showMessageToast,
      removeToast,
      handleToastClick,
      handleConversationsUpdate,
      playNotificationTone,
      resetNotifications,
      getConversationMeta
    } = notifications;

    useEffect(() => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const handleFocus = () => setWindowFocused(true);
      const handleBlur = () => setWindowFocused(false);
      const handleVisibility = () => setWindowFocused(!document.hidden);
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);
      document.addEventListener('visibilitychange', handleVisibility);
      return () => {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    }, []);

    useEffect(() => { tabRef.current = tab; }, [tab]);
    useEffect(() => { activeConvoIdRef.current = activeConvoId; }, [activeConvoId]);
    useEffect(() => { windowFocusedRef.current = windowFocused; }, [windowFocused]);

    const refreshAds = useCallback(async () => {
      try {
        const rows = await api.listAds({ silent: true });
        setAds(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Failed to load ads', err);
        setAds([]);
      }
    }, []);

    const removePushSubscription = useCallback(async () => {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration || !registration.pushManager) return;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return;
        const serialized = serializePushSubscription(subscription);
        if (serialized) {
          try {
            await api.pushUnsubscribe(serialized, { silent: true });
          } catch (err) {
            console.warn('Push unsubscribe request failed:', err);
          }
        }
        try {
          await subscription.unsubscribe();
        } catch (err) {
          console.warn('Push unsubscribe failed:', err);
        }
      } catch (err) {
        console.warn('Push cleanup failed:', err);
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

    useEffect(() => {
      if (user?.id) return;
      resetNotifications();
    }, [user?.id, resetNotifications]);

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

    // Unread poll
    async function recomputeUnread() {
      try {
        if (!user) {
          setUnreadCount(0);
          setHasAdminUnread(false);
          return;
        }
        const convos = await api.listConversations({ silent:true });
        handleConversationsUpdate(convos);
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

            if (data.type === 'new_message') {
              if (data.sender_id !== user.id) {
                recomputeUnread();
                const shouldNotify =
                  tabRef.current !== 'messages' ||
                  activeConvoIdRef.current !== data.conversation_id ||
                  !windowFocusedRef.current;
                if (shouldNotify) {
                  const bodyText = typeof data?.message?.body === 'string' ? data.message.body : '';
                  const images = Array.isArray(data?.message?.images) ? data.message.images : [];
                  const convoMeta = getConversationMeta(data.conversation_id);
                  const senderName = data.sender_username || convoMeta?.other_user_username || '';
                  const listingTitle = convoMeta?.listing_title || '';
                  showMessageToast({
                    conversationId: data.conversation_id,
                    messageId: data.message?.id || null,
                    senderName,
                    listingTitle,
                    preview: bodyText,
                    imageCount: images.length
                  });
                  playNotificationTone();
                }
              }
            }
          } catch (e) {
            console.error('WebSocket message error (App level):', e);
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
      let aborted = false;

      async function setupPushNotifications() {
        if (!user?.id) return;
        if (!pushMeta?.available) return;
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        if (typeof Notification === 'undefined') return;

        const vapidKey = pushMeta?.vapidPublicKey;
        if (!vapidKey) return;

        const currentPermission = Notification.permission;
        const last = pushSetupRef.current;
        if (last && last.userId === user.id && last.permission === 'granted' && currentPermission === 'granted') {
          return;
        }

        if (currentPermission === 'denied') {
          pushSetupRef.current = { userId: user.id, permission: 'denied' };
          return;
        }

        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          const readyRegistration = await navigator.serviceWorker.ready.catch(() => registration);
          if (aborted) return;

          let permission = Notification.permission;
          if (permission === 'default' && typeof Notification.requestPermission === 'function') {
            try {
              permission = await Notification.requestPermission();
            } catch (err) {
              console.warn('Notification permission request failed:', err);
              pushSetupRef.current = { userId: user.id, permission: 'error' };
              return;
            }
          }

          if (permission !== 'granted') {
            pushSetupRef.current = { userId: user.id, permission };
            return;
          }

          const applicationServerKey = base64UrlToUint8Array(vapidKey);
          if (!applicationServerKey) {
            pushSetupRef.current = { userId: user.id, permission: 'error' };
            return;
          }

          let subscription = await readyRegistration.pushManager.getSubscription();
          if (!subscription) {
            subscription = await readyRegistration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey
            });
          }

          if (!subscription) {
            pushSetupRef.current = { userId: user.id, permission: 'error' };
            return;
          }

          const serialized = serializePushSubscription(subscription);
          if (!serialized) {
            pushSetupRef.current = { userId: user.id, permission: 'error' };
            return;
          }

          await api.pushSubscribe(serialized, { silent: true });
          pushSetupRef.current = { userId: user.id, permission: 'granted' };
        } catch (err) {
          console.warn('Push setup failed:', err);
          pushSetupRef.current = { userId: user.id, permission: 'error' };
        }
      }

      setupPushNotifications();

      return () => { aborted = true; };
    }, [user?.id, pushMeta?.available, pushMeta?.vapidPublicKey]);

    useEffect(() => {
      if (!user && tab === 'messages') setTab('browse');
      if (!isMobile && tab === 'nearby') setTab('browse');
    }, [user, tab, isMobile]);

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
      await removePushSubscription();
      await api.logout();
      setUser(null);
      setTab('browse');
    }

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

    const openListingModal = useCallback((listing, coverSrc) => {
      const { payload, images } = prepareListingForModal(listing, coverSrc);
      if (!payload) return;
      setSelectedListing(payload);
      if (listing?.id) {
        warmListingImages(listing.id, images);
      }
    }, [setSelectedListing]);

    const handleListingTileEvent = useCallback((evt, listing, coverSrc) => {
      if (evt && typeof evt.preventDefault === 'function') {
        evt.preventDefault();
      }
      if (evt && typeof evt.stopPropagation === 'function') {
        evt.stopPropagation();
      }
      openListingModal(listing, coverSrc);
    }, [openListingModal]);

    // ---------- RENDER ----------
    return H(ListingsProvider, { value: listings },
      H(NotificationsProvider, { value: notifications },
        H(React.Fragment, null,
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
                return H(GridTile, {
                  key: `listing-${entry.data.id}`,
                  item: entry.data,
                  onEnsureCover: ensureCover,
                  onSelect: handleListingTileEvent
                });
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

          H(ListingModal, {
            open: !!selectedListing,
            item: selectedListing,
            onClose: () => setSelectedListing(null),
            cardProps: {
              user,
              canEdit: !!mineById[selectedListing?.id],
              onEdit: (it) => {
                if (user?.account_status === 'locked') { showLockedBanner(); return; }
                const rich = mineById[it.id] || it;
                setEditing(rich);
                setShowForm(true);
                setSelectedListing(null);
                // REMOVED window.scrollTo
              },
              onDelete: async (it) => {
                if (confirm('Remove this listing? (Your past messages will remain)')) {
                  await api.deleteListing(it.id);
                  setSelectedListing(null);
                  await refreshListings();
                }
              },
              onMessage: startMessage,
              onAdminDelete: handleAdminDelete,
              showDistance: false,
              onViewSeller: handleViewSeller,
              onToggleSold: mineById[selectedListing?.id] ? toggleSold : undefined
            }
          })
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
            ? H(MessagesPanel, {
                user,
                initialActiveId: activeConvoId,
                onSeenChange: handleSeen,
                onConversationsUpdate: handleConversationsUpdate
              })
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
            aiDescriptionEnabled,
            setAiDescriptionEnabled,
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
        autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled),
        aiDescriptionEnabled,
        backgroundQueueEnabled,
        enqueueListingJob
      }),

      // NEW: Listing Form modal
      showForm && H(ListingFormModal, {
        isOpen: showForm,
        draft: editing,
        onClose: () => { setShowForm(false); setEditing(null); },
        onSaved: async () => { await refreshListings({ preserveExisting: true }); },
        autoListEnabled,
        aiDescriptionEnabled,
        autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled),
        backgroundQueueEnabled,
        enqueueListingJob
      }),

      // ADD THIS NEW AUTH MODAL:
      H(AuthModal, {
        isOpen: authModal.isOpen,
        onClose: () => setAuthModal({ ...authModal, isOpen: false }),
        initialMode: authModal.mode,
        onSuccess: handleAuthSuccess
      }),

      H(ListingQueueToast, null),

      messageToasts.length > 0 && H('div', {
        className: 'message-toast-container',
        'aria-live': 'assertive'
      },
        messageToasts.map((toast) => H('div', {
          key: toast.id,
          className: 'message-toast',
          role: 'status',
          tabIndex: 0,
          onClick: () => handleToastClick(toast),
          onKeyDown: (evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
              evt.preventDefault();
              handleToastClick(toast);
            }
          }
        },
          H('div', { className: 'message-toast__title' }, toast.title),
          H('div', { className: 'message-toast__preview' }, toast.preview)
        ))
      )
        )
      )
    );
  }

  function Root() {
    return H(AuthProvider, null,
      H(ListingQueueProvider, null,
        H(App)
      )
    );
  }

  // Robust mount (React 18+ or older)
  const rootEl = document.getElementById('root');
  if (ReactDOM.createRoot) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(H(Root));
  } else {
    ReactDOM.render(H(Root), rootEl);
  }

})();
















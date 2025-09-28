(() => {
  function assertFunction(fn, name) {
    if (typeof fn !== 'function') {
      throw new Error(`${name} is required.`);
    }
    return fn;
  }

  function createAppShell({
    React,
    ReactDOM,
    api,
    helpers,
    AppNav,
    features,
    contexts,
    components,
    uploads,
    utilities
  }) {
    if (!React || !ReactDOM) {
      throw new Error('App shell requires React and ReactDOM.');
    }

    const {
      useState,
      useEffect,
      useMemo,
      useRef,
      useCallback
    } = React;

    const {
      H,
      isMobileDevice,
      loadSeen,
      saveSeen,
      serializePushSubscription,
      base64UrlToUint8Array,
      asArray
    } = helpers || {};

    assertFunction(H, 'helpers.H');
    assertFunction(isMobileDevice, 'helpers.isMobileDevice');
    assertFunction(loadSeen, 'helpers.loadSeen');
    assertFunction(saveSeen, 'helpers.saveSeen');
    assertFunction(serializePushSubscription, 'helpers.serializePushSubscription');
    assertFunction(base64UrlToUint8Array, 'helpers.base64UrlToUint8Array');
    assertFunction(asArray, 'helpers.asArray');

    const { price, fmtDistance } = utilities || {};

    const auth = features?.auth || {};
    const listingsFeature = features?.listings || {};
    const messageCenter = features?.messageCenter || {};
    const messagesFeature = features?.messages || {};
    const adminFeature = features?.admin || {};
    const profileFeature = features?.profile || {};
    const nearbyFeature = features?.nearby || {};
    const listingFormsFeature = features?.listingForms || {};

    const {
      AuthProvider,
      useAuth,
      AuthModal
    } = auth;

    const {
      useListingsFeature,
      CityAutocomplete
    } = listingsFeature;

    const { useMessageCenter } = messageCenter;
    const { MessagesPanel } = messagesFeature;
    const { AdminDashboard } = adminFeature;
    const { ProfilePanel } = profileFeature;
    const { NearbyPanel } = nearbyFeature;
    const { ListingFormModal } = listingFormsFeature;

    assertFunction(AuthProvider, 'features.auth.AuthProvider');
    assertFunction(useAuth, 'features.auth.useAuth');
    assertFunction(AuthModal, 'features.auth.AuthModal');
    assertFunction(useListingsFeature, 'features.listings.useListingsFeature');
    assertFunction(CityAutocomplete, 'features.listings.CityAutocomplete');
    assertFunction(useMessageCenter, 'features.messageCenter.useMessageCenter');
    assertFunction(MessagesPanel, 'features.messages.MessagesPanel');
    assertFunction(AdminDashboard, 'features.admin.AdminDashboard');
    assertFunction(ProfilePanel, 'features.profile.ProfilePanel');
    assertFunction(NearbyPanel, 'features.nearby.NearbyPanel');
    assertFunction(ListingFormModal, 'features.listingForms.ListingFormModal');

    const listingContext = contexts?.listings || {};
    const notificationsContext = contexts?.notifications || {};
    const listingQueueContext = contexts?.listingQueue || {};

    const { ListingsProvider } = listingContext;
    const { NotificationsProvider } = notificationsContext;
    const {
      ListingQueueProvider,
      ListingQueueToast,
      useListingQueueState
    } = listingQueueContext;

    assertFunction(ListingsProvider, 'contexts.listings.ListingsProvider');
    assertFunction(NotificationsProvider, 'contexts.notifications.NotificationsProvider');
    assertFunction(ListingQueueProvider, 'contexts.listingQueue.ListingQueueProvider');
    assertFunction(ListingQueueToast, 'contexts.listingQueue.ListingQueueToast');
    assertFunction(useListingQueueState, 'contexts.listingQueue.useListingQueueState');

    const layoutComponents = components?.layout || {};
    const gridComponents = components?.grid || {};
    const listingComponents = components?.listing || {};

    const { Header, GlobalLoader } = layoutComponents;
    const { ListingsGrid } = gridComponents;
    const {
      MassListModal,
      ListingModal,
      SellerProfile
    } = listingComponents;

    assertFunction(Header, 'components.layout.Header');
    assertFunction(GlobalLoader, 'components.layout.GlobalLoader');
    assertFunction(ListingsGrid, 'components.grid.ListingsGrid');
    assertFunction(MassListModal, 'components.listing.MassListModal');
    assertFunction(ListingModal, 'components.listing.ListingModal');
    assertFunction(SellerProfile, 'components.listing.SellerProfile');

    const {
      prepareListingForModal,
      warmListingImages
    } = uploads || {};

    assertFunction(prepareListingForModal, 'uploads.prepareListingForModal');
    assertFunction(warmListingImages, 'uploads.warmListingImages');

    if (!api) {
      throw new Error('App shell requires an API client.');
    }

    const App = React.memo(function AppComponent(){
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

      const isMobile = isMobileDevice();

      const handleTabChange = (newTab) => {
        if (newTab === 'admin' && !user?.is_admin) {
          return;
        }
        if (newTab === 'nearby' && !isMobile) {
          return;
        }
        setTab(newTab);
        setViewingSeller(null);
      };

      const [viewingSeller, setViewingSeller] = useState(null);

      const {
        activeConvoId,
        setActiveConvoId,
        unreadCount,
        hasAdminUnread,
        recomputeUnread,
        notifications
      } = useMessageCenter({
        user,
        tab,
        onTabChange: setTab,
        onClearSeller: () => setViewingSeller(null)
      });
      const [loadingCount, setLoadingCount] = useState(0);

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

      const {
        backgroundQueueEnabled,
        enqueueListingJob
      } = useListingQueueState();

      const pushSetupRef = useRef({ userId: null, permission: null });

      const {
        messageToasts,
        handleToastClick,
        handleConversationsUpdate
      } = notifications;

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

      const mineById = useMemo(() => {
        const map = Object.create(null);
        (mine || []).forEach(m => { map[m.id] = m; });
        return map;
      }, [mine]);

      function handleViewSeller(userId, username) {
        setViewingSeller({ id: userId, username });
        setSelectedListing(null);
      }

      function handleBackFromSeller() {
        setViewingSeller(null);
      }

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
        refreshListings();
        reloadMineOnly();
      }

      async function logoutFromProfile(){
        await removePushSubscription();
        await api.logout();
        setUser(null);
        setTab('browse');
      }

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
          viewingSeller && H(SellerProfile, {
            sellerId: viewingSeller.id,
            sellerUsername: viewingSeller.username,
            onBack: handleBackFromSeller,
            user,
            onMessage: startMessage,
            onAdminDelete: handleAdminDelete
          }),

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

            H(ListingsGrid, {
              items,
              ads,
              isMobile,
              onEnsureCover: ensureCover,
              onSelect: handleListingTileEvent
            }),

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

            H('div', { ref: sentinelRef, style: { width: '100%', height: 1 } }),

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
              onViewSeller: handleViewSeller,
              onToggleSold: toggleSold
            }),

          !viewingSeller && (tab==='admin') &&
            (user?.is_admin
              ? H(AdminDashboard, { onViewSeller: handleViewSeller, onMessageUser: startDirectMessage, onAdsUpdated: refreshAds })
              : H('section', { className: 'card', style: { padding: 16 } }, 'Admin access only.'))
        ),

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
    });

    function Root() {
      return H(AuthProvider, null,
        H(ListingQueueProvider, null,
          H(App)
        )
      );
    }

    return { App, Root };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.app = window.ListItApp.app || {};
  window.ListItApp.app.createAppShell = createAppShell;
})();


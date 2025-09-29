(() => {
  function assertFunction(fn, name) {
    const isFn = typeof fn === 'function';
    const isReactComponent = !!fn && typeof fn === 'object' && (
      typeof fn.render === 'function' ||
      typeof fn.type === 'function' ||
      typeof fn.$$typeof === 'symbol'
    );

    if (!isFn && !isReactComponent) {
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
      useMemo
    } = React;

    const {
      H
    } = helpers || {};

    assertFunction(H, 'helpers.H');

    const { price, fmtDistance } = utilities || {};

    const auth = features?.auth || {};
    const listingsFeature = features?.listings || {};
    const messageCenter = features?.messageCenter || {};
    const messagesFeature = features?.messages || {};
    const adminFeature = features?.admin || {};
    const profileFeature = features?.profile || {};
    const nearbyFeature = features?.nearby || {};
    const listingFormsFeature = features?.listingForms || {};
    const preferencesFeature = features?.preferences || {};
    const pushFeature = features?.push || {};
    const adsFeature = features?.ads || {};
    const appViewFeature = features?.appView || {};

    const {
      AuthProvider,
      useAuth,
      AuthModal
    } = auth;

    const {
      useListingsFeature,
      CityAutocomplete,
      useListingModal
    } = listingsFeature;

    const { useMessageCenter } = messageCenter;
    const { MessagesPanel, useMessageActions } = messagesFeature;
    const { AdminDashboard, useAdminListingActions } = adminFeature;
    const { ProfilePanel } = profileFeature;
    const { NearbyPanel } = nearbyFeature;
    const { ListingFormModal } = listingFormsFeature;
    const { useAppPreferences } = preferencesFeature;
    const { usePushNotifications } = pushFeature;
    const { useAds } = adsFeature;
    const { useAppView } = appViewFeature;

    assertFunction(AuthProvider, 'features.auth.AuthProvider');
    assertFunction(useAuth, 'features.auth.useAuth');
    assertFunction(AuthModal, 'features.auth.AuthModal');
    assertFunction(useListingsFeature, 'features.listings.useListingsFeature');
    assertFunction(CityAutocomplete, 'features.listings.CityAutocomplete');
    assertFunction(useListingModal, 'features.listings.useListingModal');
    assertFunction(useMessageCenter, 'features.messageCenter.useMessageCenter');
    assertFunction(MessagesPanel, 'features.messages.MessagesPanel');
    assertFunction(useMessageActions, 'features.messages.useMessageActions');
    assertFunction(AdminDashboard, 'features.admin.AdminDashboard');
    assertFunction(useAdminListingActions, 'features.admin.useAdminListingActions');
    assertFunction(ProfilePanel, 'features.profile.ProfilePanel');
    assertFunction(NearbyPanel, 'features.nearby.NearbyPanel');
    assertFunction(ListingFormModal, 'features.listingForms.ListingFormModal');
    assertFunction(useAppPreferences, 'features.preferences.useAppPreferences');
    assertFunction(usePushNotifications, 'features.push.usePushNotifications');
    assertFunction(useAds, 'features.ads.useAds');
    assertFunction(useAppView, 'features.appView.useAppView');

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


    if (!api) {
      throw new Error('App shell requires an API client.');
    }

    const App = React.memo(function AppComponent(){
      const { user, setUser, pushMeta } = useAuth();
      const appView = useAppView({ user });
      const {
        tab,
        setTab,
        banner,
        showLockedBanner,
        dismissBanner,
        viewingSeller,
        setViewingSeller,
        authModal,
        setAuthModal,
        handleTabChange,
        openAuthModal,
        isMobile
      } = appView;
      const [showForm, setShowForm] = useState(false);
      const {
        autoListEnabled,
        setAutoListEnabled,
        aiDescriptionEnabled,
        setAiDescriptionEnabled,
        autoPostNearbyEnabled,
        setAutoPostNearbyEnabled
      } = useAppPreferences();

      const { ads, refreshAds } = useAds();

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

      const {
        backgroundQueueEnabled,
        enqueueListingJob
      } = useListingQueueState();

      const {
        messageToasts,
        handleToastClick,
        handleConversationsUpdate
      } = notifications;
      const { removePushSubscription } = usePushNotifications({ user, pushMeta });

      const { handleAdminDeleteAll, handleAdminDelete } = useAdminListingActions({
        setAllListings: setAll,
        setMineListings: setMine
      });

      const { openListingModal, handleListingTileEvent } = useListingModal({
        setSelectedListing
      });

      const { startMessage, startDirectMessage, handleSeen } = useMessageActions({
        user,
        onConversationOpened: setActiveConvoId,
        onTabChange: setTab,
        onSellerCleared: () => setViewingSeller(null),
        recomputeUnread
      });

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


      function handleAuthClick(mode) {
        openAuthModal(mode);
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
              isMobile,
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


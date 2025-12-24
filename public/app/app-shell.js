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

  const EDITOR_DEFAULT_STATE = {
    isOpen: false,
    originTab: 'browse',
    reopenListingId: null,
    draftSnapshot: null
  };

  const SUPPORTER_PROMPT_KEY = 'listit_supporter_prompt_at';
  const SUPPORTER_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
  const SUPPORTER_PROMPT_DELAY_MS = 2000;
  const SUPPORTER_DEFAULT_AMOUNT = 300;
  const SUPPORTER_PREMIUM_AMOUNT = 199;
  const SUPPORTER_DEFAULT_CURRENCY = 'usd';

  // Minimum background time before triggering refresh (prevents flicker on quick app switches)
  const RESUME_MIN_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

  function createEditorState(overrides = {}) {
    return { ...EDITOR_DEFAULT_STATE, ...overrides };
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
      useCallback,
      useRef: providedUseRef
    } = React;

    const useRef = typeof providedUseRef === 'function' ? providedUseRef : ((initial) => ({ current: initial }));

    const {
      H,
      getUserCoordsOnce
    } = helpers || {};

    assertFunction(H, 'helpers.H');

    const { price, fmtDistance } = utilities || {};

    const auth = features?.auth || {};
    const listingsFeature = features?.listings || {};
    const messageCenter = features?.messageCenter || {};
    const messagesFeature = features?.messages || {};
    const adminFeature = features?.admin || {};
    const profileFeature = features?.profile || {};
    const listingFormsFeature = features?.listingForms || {};
    const preferencesFeature = features?.preferences || {};
    const pushFeature = features?.push || {};
    const adsFeature = features?.ads || {};
    const appViewFeature = features?.appView || {};
    const iapService = features?.iap || null;

    const {
      AuthProvider,
      useAuth,
      AuthModal
    } = auth;

    // LandingPage removed - users can now browse without auth

    const {
      useListingsFeature,
      CityAutocomplete,
      useListingModal
    } = listingsFeature;

    const { useMessageCenter } = messageCenter;
    const { MessagesPanel, useMessageActions } = messagesFeature;
    const { AdminDashboard, useAdminListingActions } = adminFeature;
    const { ProfilePanel } = profileFeature;
    const { ListingFormModal, DesktopNewListingModal, runAutoList } = listingFormsFeature;
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
    assertFunction(ListingFormModal, 'features.listingForms.ListingFormModal');
    assertFunction(runAutoList, 'features.listingForms.runAutoList');
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
    const supporterComponents = components?.supporter || {};
    const legalComponents = components?.legal || {};

    const { Header, GlobalLoader, ResumeOverlay, CustomDropdown } = layoutComponents;
    const { ListingsGrid } = gridComponents;
    const {
      MassListModal,
      ListingModal,
      SellerProfile
    } = listingComponents;
    const { SupporterInfoModal, SupporterUpsellModal, SelectBuyerModal } = supporterComponents;
    const { LegalAcceptanceModal } = legalComponents;

    assertFunction(Header, 'components.layout.Header');
    assertFunction(GlobalLoader, 'components.layout.GlobalLoader');
    assertFunction(ListingsGrid, 'components.grid.ListingsGrid');
    assertFunction(MassListModal, 'components.listing.MassListModal');
    assertFunction(ListingModal, 'components.listing.ListingModal');
    assertFunction(SellerProfile, 'components.listing.SellerProfile');
    assertFunction(SupporterInfoModal, 'components.supporter.SupporterInfoModal');
    assertFunction(SupporterUpsellModal, 'components.supporter.SupporterUpsellModal');


    if (!api) {
      throw new Error('App shell requires an API client.');
    }

    const App = React.memo(function AppComponent() {
      const { user, setUser, pushMeta, loading: loadingUser } = useAuth();

      const premiumFreeForAll = Boolean(user?.payments_disabled);
      const hasPremiumAccess = useMemo(() => {
        return premiumFreeForAll || !!user?.supporter_tier || user?.supporter_badge || user?.subscription_status === 'active';
      }, [premiumFreeForAll, user?.supporter_tier, user?.supporter_badge, user?.subscription_status]);
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
      const [editorState, setEditorState] = useState(() => createEditorState());
      const [loadingCount, setLoadingCount] = useState(0);
      const [mobileCreateMode, setMobileCreateMode] = useState('list');
      const [initialListingFiles, setInitialListingFiles] = useState([]);
      const [initialMassListFiles, setInitialMassListFiles] = useState([]);
      const galleryInputRef = useRef(null);
      const cameraInputRef = useRef(null);
      const {
        autoListEnabled,
        autoPostNearbyEnabled,
        setAutoPostNearbyEnabled,
        autoInquiryEnabled,
        setAutoInquiryEnabled
      } = useAppPreferences();
      const [supporterInfoState, setSupporterInfoState] = useState({ open: false, username: '', since: null, tier: null, isSelf: false });
      const [supporterUpsellState, setSupporterUpsellState] = useState({
        open: false,
        mode: 'prompt',
        busy: false,
        error: '',
        amount: SUPPORTER_DEFAULT_AMOUNT,
        currency: SUPPORTER_DEFAULT_CURRENCY,
        selectedTier: 'basic',
        notice: ''
      });
      const supporterQueryHandledRef = useRef(false);
      const plusButtonTimerRef = useRef(null);
      const isLongPressRef = useRef(false);
      const [showDesktopNewListingModal, setShowDesktopNewListingModal] = useState(false);

      // Legal acceptance modal state
      const [showLegalModal, setShowLegalModal] = useState(false);
      const [legalCheckDone, setLegalCheckDone] = useState(false);

      // Moderation flagged modal state
      const [showModerationModal, setShowModerationModal] = useState(false);

      // Desktop location accuracy warning toast
      const [showDesktopAccuracyToast, setShowDesktopAccuracyToast] = useState(false);
      const DESKTOP_ACCURACY_TOAST_KEY = 'listit_desktop_accuracy_shown';

      useEffect(() => {
        // Only show on desktop, and only once per session
        if (isMobile) return;
        const alreadyShown = sessionStorage.getItem(DESKTOP_ACCURACY_TOAST_KEY);
        if (alreadyShown) return;

        // Show toast after a brief delay
        const showTimer = setTimeout(() => {
          setShowDesktopAccuracyToast(true);
          sessionStorage.setItem(DESKTOP_ACCURACY_TOAST_KEY, 'true');
        }, 1500);

        return () => clearTimeout(showTimer);
      }, [isMobile]);

      // Auto-hide desktop accuracy toast after 10 seconds
      useEffect(() => {
        if (!showDesktopAccuracyToast) return;
        const hideTimer = setTimeout(() => {
          setShowDesktopAccuracyToast(false);
        }, 10000);
        return () => clearTimeout(hideTimer);
      }, [showDesktopAccuracyToast]);

      // Initialize IAP service on iOS native
      useEffect(() => {
        if (iapService && typeof iapService.initialize === 'function') {
          iapService.initialize().catch(() => {
            // Silent fail - IAP will initialize on demand when user tries to purchase
          });
        }
      }, []);

      // Scroll preservation
      const browseScrollPos = useRef(0);
      const prevTabRef = useRef(tab);

      // Resume overlay state - tracks when app went to background and shows refresh screen
      // Also shows on initial app start
      const [isResuming, setIsResuming] = useState(true);
      const backgroundTimestampRef = useRef(null);
      const resumeTimerRef = useRef(null);
      const initialLoadRef = useRef(true);

      // Wrapper for tab changes to save scroll position
      const onTabChange = useCallback((newTab) => {
        if (tab === 'browse') {
          browseScrollPos.current = window.scrollY;
        }
        handleTabChange(newTab);
      }, [tab, handleTabChange]);

      // Restore scroll position when returning to browse
      React.useLayoutEffect(() => {
        const scrollTo = (y) => {
          if (isMobile) {
            const container = document.querySelector('main.container');
            if (container) container.scrollTop = y;
          } else {
            window.scrollTo(0, y);
          }
        };

        if (tab === 'browse' && prevTabRef.current !== 'browse') {
          scrollTo(browseScrollPos.current);
        } else if (tab !== 'browse') {
          scrollTo(0);
        }
        prevTabRef.current = tab;
      }, [tab, isMobile]);

      const setSupporterPromptSeen = useCallback(() => {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(SUPPORTER_PROMPT_KEY, String(Date.now()));
          }
        } catch {
          // Ignore storage failures
        }
      }, []);

      const showSupporterPrompt = useCallback(() => {
        setSupporterUpsellState((prev) => ({
          ...prev,
          open: true,
          mode: 'prompt',
          busy: false,
          error: '',
          amount: prev.amount ?? SUPPORTER_DEFAULT_AMOUNT,
          currency: prev.currency || SUPPORTER_DEFAULT_CURRENCY,
          selectedTier: 'basic',
          notice: ''
        }));
        setSupporterPromptSeen();
      }, [setSupporterPromptSeen, premiumFreeForAll]);

      const closeSupporterUpsell = useCallback(() => {
        setSupporterUpsellState((prev) => ({ ...prev, open: false, busy: false, notice: '' }));
        setSupporterPromptSeen();
      }, [setSupporterPromptSeen]);

      const handleTierChange = useCallback((tier) => {
        setSupporterUpsellState((prev) => ({ ...prev, selectedTier: tier }));
      }, []);

      const handleSupporterBadgeClick = useCallback((payload = {}) => {
        const usernameRaw = typeof payload?.username === 'string' ? payload.username.trim() : '';
        const username = usernameRaw || 'This user';
        const since = payload?.since || null;
        const tier = payload?.tier || null;
        const isSelf = Boolean(payload?.isSelf);
        setSupporterInfoState({ open: true, username, since, tier, isSelf });
      }, []);

      const handleSupporterInfoClose = useCallback(() => {
        setSupporterInfoState((prev) => ({ ...prev, open: false }));
      }, []);

      const handleSupporterInfoJoin = useCallback(() => {
        const isSelf = supporterInfoState.isSelf;
        setSupporterInfoState((prev) => ({ ...prev, open: false }));
        if (isSelf) return;
        showSupporterPrompt();
      }, [showSupporterPrompt, supporterInfoState.isSelf]);

      const handleSupporterPromptCta = useCallback(() => {
        if (user?.supporter_badge) return;
        showSupporterPrompt();
      }, [showSupporterPrompt, user?.supporter_badge]);

      const handleJoinSupporterProgram = useCallback(async (tier = 'basic') => {
        if (premiumFreeForAll) {
          setSupporterUpsellState((prev) => ({ ...prev, busy: false, error: '', notice: '' }));
          return;
        }
        setSupporterUpsellState((prev) => ({ ...prev, busy: true, error: '', notice: '' }));

        // Use IAP on iOS native
        if (iapService && typeof iapService.isIOSNative === 'function' && iapService.isIOSNative()) {
          try {
            await iapService.initialize();
            const result = await iapService.purchase();
            if (result?.success) {
              // Refresh user to get updated supporter status
              const updatedUser = await api.me();
              if (updatedUser && !updatedUser.error) {
                AppNav.setUser(updatedUser);
              }
              setSupporterUpsellState((prev) => ({ ...prev, open: false, busy: false, error: '' }));
            } else {
              throw new Error(result?.error || 'Purchase failed');
            }
          } catch (err) {
            const message = err?.message || 'Could not complete purchase.';
            if (message.includes('cancel') || message.includes('Cancel')) {
              setSupporterUpsellState((prev) => ({ ...prev, busy: false, error: '' }));
            } else {
              setSupporterUpsellState((prev) => ({ ...prev, busy: false, error: message }));
            }
          }
          return;
        }

        // Use Stripe for web/desktop
        try {
          const response = await api.startSupporterCheckout(tier);
          if (response && typeof response.amount !== 'undefined') {
            setSupporterUpsellState((prev) => ({
              ...prev,
              amount: Number.isFinite(Number(response.amount)) ? Number(response.amount) : prev.amount,
              currency: response.currency || prev.currency,
              notice: ''
            }));
          }
          if (response?.url) {
            if (typeof window !== 'undefined' && typeof window.location?.assign === 'function') {
              window.location.assign(response.url);
            }
            return;
          }
          throw new Error(response?.error || 'Checkout unavailable');
        } catch (err) {
          let message = err?.message || 'Could not start checkout.';
          if (message === 'payments_disabled') {
            setSupporterUpsellState((prev) => ({ ...prev, busy: false, error: '', notice: '' }));
            return;
          }
          setSupporterUpsellState((prev) => ({ ...prev, busy: false, error: message }));
        }
      }, [api, premiumFreeForAll, iapService, AppNav]);

      // User coordinates for location-based ads
      const [userCoords, setUserCoords] = useState(null);
      useEffect(() => {
        console.log('[app-shell] Fetching user coords for ads...');
        if (typeof getUserCoordsOnce === 'function') {
          getUserCoordsOnce().then(coords => {
            console.log('[app-shell] Got user coords:', coords);
            if (coords) setUserCoords(coords);
          }).catch((err) => {
            console.error('[app-shell] Failed to get coords:', err);
          });
        } else {
          console.warn('[app-shell] getUserCoordsOnce not available');
        }
      }, []);

      const { ads, refreshAds } = useAds({
        userLat: userCoords?.lat,
        userLon: userCoords?.lon,
        isPremium: hasPremiumAccess
      });

      const listings = useListingsFeature({ user, currentTab: tab });
      const {
        query,
        setQuery,
        submitSearch,
        locationQuery,
        setLocationQuery,
        sort,
        setSort,
        hasNext,
        isFetchingListings,
        listingError,
        loadMore,
        sentinelRef,
        isInfiniteScrollSupported,
        reloadMineOnly,
        refreshListings,
        addListing,
        toggleSold,
        cityOptions,
        items,
        mine,
        ensureCover
      } = listings;

      // UI state - managed locally in app-shell, not in the listings hook
      const [selectedListing, setSelectedListing] = useState(null);
      const [editing, setEditing] = useState(null);
      const [showMassList, setShowMassList] = useState(false);

      // Saved listings state - use object instead of Set for better React re-render detection
      const [savedListingIds, setSavedListingIds] = useState({});

      // Fetch saved listing IDs when user logs in
      useEffect(() => {
        if (!user) {
          setSavedListingIds({});
          return;
        }
        api.getSavedListingIds({ silent: true })
          .then(result => {
            if (result?.ids) {
              const idsObj = {};
              result.ids.forEach(id => { idsObj[id] = true; });
              setSavedListingIds(idsObj);
            }
          })
          .catch(() => {
            // Silently fail - saved IDs are optional
          });
      }, [user?.id]);

      // Toggle save/unsave for a listing (optimistic update)
      const toggleSaveListing = useCallback(async (listing, save) => {
        if (!user || !listing?.id) return;
        // Optimistic update - update UI immediately
        if (save) {
          setSavedListingIds(prev => ({ ...prev, [listing.id]: true }));
        } else {
          setSavedListingIds(prev => {
            const next = { ...prev };
            delete next[listing.id];
            return next;
          });
        }
        try {
          if (save) {
            await api.saveListing(listing.id);
          } else {
            await api.unsaveListing(listing.id);
          }
        } catch (e) {
          console.error('Failed to toggle save:', e);
          // Revert on error
          if (save) {
            setSavedListingIds(prev => {
              const next = { ...prev };
              delete next[listing.id];
              return next;
            });
          } else {
            setSavedListingIds(prev => ({ ...prev, [listing.id]: true }));
          }
          throw e;
        }
      }, [user]);

      // Automatic geolocation refresh every 5 minutes
      const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
      useEffect(() => {
        const interval = setInterval(() => {
          // Clear GPS cache and refresh listings automatically
          if (typeof helpers?.clearCoordsCache === 'function') {
            helpers.clearCoordsCache(true);
          }
          refreshListings({ preserveExisting: true });
        }, AUTO_REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
      }, [refreshListings]);

      // Search dropdown state
      const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
      const searchInputRef = useRef(null);
      const searchDropdownRef = useRef(null);

      // Categories for search dropdown
      const searchCategories = [
        'Appliances', 'Tech', 'Furniture', 'Clothing', 'Electronics',
        'Books', 'Sports', 'Toys', 'Tools', 'Garden', 'Auto', 'Art'
      ];

      // State to track recent searches (triggers re-render when updated)
      const [recentSearches, setRecentSearches] = useState(() => {
        try {
          const stored = JSON.parse(localStorage.getItem('listit_recent_searches') || '[]');
          return stored.sort((a, b) => b.count - a.count).slice(0, 5);
        } catch { return []; }
      });

      // Save a search to history
      const saveSearchToHistory = useCallback((term) => {
        if (!term || !term.trim()) return;
        const normalized = term.trim().toLowerCase();
        try {
          const stored = JSON.parse(localStorage.getItem('listit_recent_searches') || '[]');
          const existing = stored.find(s => s.term.toLowerCase() === normalized);
          if (existing) {
            existing.count = (existing.count || 1) + 1;
            existing.term = term.trim(); // Keep original casing
          } else {
            stored.push({ term: term.trim(), count: 1 });
          }
          // Keep only last 20 unique searches
          const sorted = stored.sort((a, b) => b.count - a.count).slice(0, 20);
          localStorage.setItem('listit_recent_searches', JSON.stringify(sorted));
          // Update state to trigger re-render
          setRecentSearches(sorted.slice(0, 5));
        } catch { }
      }, []);

      // Handle search submission with history tracking
      const handleSearchSubmit = useCallback((customQuery) => {
        const searchTerm = customQuery !== undefined ? customQuery : query;
        if (searchTerm && searchTerm.trim()) {
          saveSearchToHistory(searchTerm);
        }
        setSearchDropdownOpen(false);
        submitSearch(customQuery);
      }, [query, submitSearch, saveSearchToHistory]);

      // Handle clicking a suggestion
      const handleSearchSuggestionClick = useCallback((term) => {
        setQuery(term);
        setSearchDropdownOpen(false);
        saveSearchToHistory(term);
        submitSearch(term);
      }, [setQuery, submitSearch, saveSearchToHistory]);

      // Close dropdown when clicking outside
      useEffect(() => {
        if (!searchDropdownOpen) return;

        const handleClickOutside = (e) => {
          const dropdown = searchDropdownRef.current;
          const searchInput = searchInputRef.current;
          // Don't close if clicking inside dropdown or search input
          if (dropdown && dropdown.contains(e.target)) return;
          if (searchInput && searchInput.contains(e.target)) return;
          // Stop the event from reaching listings when closing dropdown
          e.stopPropagation();
          e.preventDefault();
          setSearchDropdownOpen(false);
        };

        // Use a small delay to avoid the click that opened the dropdown from immediately closing it
        const timeoutId = setTimeout(() => {
          // Use capture phase to intercept before the event reaches other handlers
          document.addEventListener('click', handleClickOutside, true);
          document.addEventListener('touchend', handleClickOutside, true);
        }, 10);

        return () => {
          clearTimeout(timeoutId);
          document.removeEventListener('click', handleClickOutside, true);
          document.removeEventListener('touchend', handleClickOutside, true);
        };
      }, [searchDropdownOpen]);

      // Edit listing toast state
      const [recentlyCreatedListing, setRecentlyCreatedListing] = useState(null);
      const [showEditToast, setShowEditToast] = useState(false);
      const editToastTimeoutRef = useRef(null);
      const editToastSwipeRef = useRef(null);
      const editToastStartXRef = useRef(0);
      const editToastCurrentXRef = useRef(0);

      // Backward compatibility aliases
      const all = items;

      // Return to top toast state
      const [showReturnToTop, setShowReturnToTop] = useState(false);
      const RETURN_TO_TOP_ITEM_THRESHOLD = 90;
      const RETURN_TO_TOP_SCROLL_THRESHOLD = 600; // pixels from top

      // Show/hide return to top based on items count AND scroll position
      useEffect(() => {
        if (tab !== 'browse' || items.length < RETURN_TO_TOP_ITEM_THRESHOLD) {
          setShowReturnToTop(false);
          return;
        }

        // On mobile, main.container is the scroll container (position: fixed with overflow-y: auto)
        // On desktop, window is the scroll container
        const getScrollContainer = () => {
          if (isMobile) {
            return document.querySelector('main.container');
          }
          return window;
        };

        const handleScroll = () => {
          const container = getScrollContainer();
          const scrollY = container === window
            ? (window.scrollY || window.pageYOffset || 0)
            : (container?.scrollTop || 0);
          setShowReturnToTop(scrollY > RETURN_TO_TOP_SCROLL_THRESHOLD);
        };

        // Check initial position
        handleScroll();

        const container = getScrollContainer();
        if (container) {
          container.addEventListener('scroll', handleScroll, { passive: true });
          return () => container.removeEventListener('scroll', handleScroll);
        }
      }, [items.length, tab, isMobile]);

      const handleReturnToTop = useCallback(async () => {
        setShowReturnToTop(false);
        await refreshListings();
        // Scroll the correct container to top
        if (isMobile) {
          const container = document.querySelector('main.container');
          if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, [refreshListings, isMobile]);

      // Karma modal state
      const [karmaModalOpen, setKarmaModalOpen] = useState(false);
      const [karmaListingId, setKarmaListingId] = useState(null);

      // Wrap toggleSold with karma logic for premium users
      const toggleSoldWithKarma = useCallback(async (listing, makeSold) => {
        if (makeSold && hasPremiumAccess) {
          // Show karma modal for premium users when marking as sold
          setKarmaListingId(listing.id);
          setKarmaModalOpen(true);
          // Don't mark as sold yet - wait for modal
        } else {
          // Non-premium users or unmarking sold - proceed normally
          await toggleSold?.(listing, makeSold);
          // Close the listing modal after marking as sold (non-premium flow)
          if (makeSold) {
            setSelectedListing(null);
          }
        }
      }, [user, toggleSold, hasPremiumAccess]);

      const handleKarmaBuyerSelected = useCallback(async (result) => {
        setKarmaModalOpen(false);
        const listing = mine.find(it => it.id === karmaListingId) || all.find(it => it.id === karmaListingId);
        if (listing) {
          // Now mark as sold after karma is awarded
          await toggleSold?.(listing, true);
        }
        setKarmaListingId(null);
        // Close the listing modal after marking as sold
        setSelectedListing(null);
      }, [karmaListingId, mine, all, toggleSold]);

      const handleKarmaModalClose = useCallback(() => {
        // User clicked X or outside modal - just close without marking as sold
        setKarmaModalOpen(false);
        setKarmaListingId(null);
      }, []);

      const handleKarmaSkip = useCallback(async () => {
        // User clicked Skip - mark as sold without awarding karma
        setKarmaModalOpen(false);
        const listing = mine.find(it => it.id === karmaListingId) || all.find(it => it.id === karmaListingId);
        if (listing) {
          await toggleSold?.(listing, true);
        }
        setKarmaListingId(null);
        // Close the listing modal after marking as sold
        setSelectedListing(null);
      }, [karmaListingId, mine, all, toggleSold]);

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
        onTabChange: onTabChange,
        onClearSeller: () => setViewingSeller(null)
      });
      const {
        backgroundQueueEnabled,
        enqueueListingJob,
        showUploadingToast,
        hideUploadingToast
      } = useListingQueueState();

      const {
        messageToasts,
        handleToastClick,
        handleConversationsUpdate
      } = notifications;
      const { removePushSubscription } = usePushNotifications({ user, pushMeta });

      const { handleAdminDeleteAll, handleAdminDelete } = useAdminListingActions({
        refreshListings,
        reloadMineOnly
      });

      const { openListingModal, handleListingTileEvent } = useListingModal({
        setSelectedListing
      });

      const { startMessage, startDirectMessage, handleSeen, blockedUserModal } = useMessageActions({
        user,
        onConversationOpened: setActiveConvoId,
        onTabChange: onTabChange,
        onSellerCleared: () => setViewingSeller(null),
        recomputeUnread,
        onAuthClick: handleAuthClick
      });

      useEffect(() => {
        AppNav.setUser = setUser;
        AppNav.setTab = onTabChange;
        AppNav.notifyLocked = showLockedBanner;
        AppNav.openConversation = (conversationId) => {
          if (conversationId) {
            setActiveConvoId(conversationId);
            onTabChange('messages');
          }
        };
        return () => {
          AppNav.setUser = () => { };
          AppNav.setTab = () => { };
          AppNav.notifyLocked = () => { };
          AppNav.openConversation = () => { };
        };
      }, [setUser, onTabChange, showLockedBanner, setActiveConvoId]);
      useEffect(() => {
        AppNav.incLoad = () => setLoadingCount(c => c + 1);
        AppNav.decLoad = () => setLoadingCount(c => Math.max(0, c - 1));
      }, []);

      // Dismiss initial load overlay after app starts (runs once on mount)
      useEffect(() => {
        if (!initialLoadRef.current) return;
        initialLoadRef.current = false;
        // Show overlay for 1.5 seconds on initial load
        setTimeout(() => {
          setIsResuming(false);
        }, 1500);
        // No cleanup - this is a one-time operation that must complete
      }, []);

      // Check for pending push notification navigation (iOS cold start)
      useEffect(() => {
        const checkPendingNotification = () => {
          try {
            const pendingConvoId = localStorage.getItem('pendingConversationId');
            if (pendingConvoId) {
              localStorage.removeItem('pendingConversationId');
              const convoId = Number(pendingConvoId) || pendingConvoId;
              // Delay to ensure app is fully loaded
              setTimeout(() => {
                setActiveConvoId(convoId);
                onTabChange('messages');
              }, 500);
            }
          } catch (e) {
            // Ignore localStorage errors
          }
        };
        // Check immediately and again after a short delay
        checkPendingNotification();
        const timer = setTimeout(checkPendingNotification, 1000);
        return () => clearTimeout(timer);
      }, [setActiveConvoId, onTabChange]);

      // Check if user needs to accept legal documents
      useEffect(() => {
        if (!user || loadingUser || legalCheckDone) return;

        let alive = true;
        (async () => {
          try {
            const status = await api.getLegalStatus();
            if (!alive) return;
            if (status?.needs_acceptance) {
              setShowLegalModal(true);
            }
            setLegalCheckDone(true);
          } catch (err) {
            // If the API fails, don't block the user - just log it
            console.error('Failed to check legal status:', err);
            if (alive) setLegalCheckDone(true);
          }
        })();

        return () => { alive = false; };
      }, [user, loadingUser, legalCheckDone]);

      const handleLegalAccepted = useCallback(() => {
        setShowLegalModal(false);
      }, []);

      // Background/foreground detection - always refresh after minimum background time
      // This prevents crashes from stale state (cursors, cache, WebView memory reclaim)
      useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const handleResume = async (backgroundTime) => {
          const elapsedMs = Date.now() - backgroundTime;

          // Skip if was only in background very briefly (under 3 seconds)
          // This prevents unnecessary refreshes from quick task switches like
          // opening notification center or briefly switching apps
          if (elapsedMs < RESUME_MIN_THRESHOLD_MS) {
            return;
          }

          // Always refresh after any meaningful background period
          // This is safer than trying to detect "stale" data because:
          // 1. Pagination cursors can become invalid server-side
          // 2. iOS may reclaim WebView memory in ways we can't detect
          // 3. The cost of an extra refresh is low vs the cost of a crash
          const overlayStartTime = Date.now();
          setIsResuming(true);
          try {
            // Clear cached GPS coordinates so we get fresh location
            if (typeof helpers?.clearCoordsCache === 'function') {
              helpers.clearCoordsCache();
            }

            // Check for pending fire-and-forget jobs that might have completed
            let hasPendingJobs = false;
            try {
              const pendingJobs = JSON.parse(localStorage.getItem('listit_pending_jobs') || '[]');
              hasPendingJobs = pendingJobs.some(j => j.sent && (Date.now() - j.timestamp) < 300000); // 5 min
            } catch (e) { /* ignore */ }

            await refreshListings();
            await reloadMineOnly();

            // If there were pending jobs, do a delayed second refresh
            // This catches jobs that complete after our initial refresh
            if (hasPendingJobs) {
              setTimeout(async () => {
                try {
                  console.log('[Resume] Delayed refresh for pending jobs');
                  await refreshListings();
                  await reloadMineOnly();
                } catch (e) { console.warn('[Resume] Delayed refresh failed:', e); }
              }, 5000); // Refresh again after 5 seconds
            }
          } catch (err) {
            console.error('Error refreshing on resume:', err);
          } finally {
            // Ensure overlay shows for at least 2 seconds (reduced from 3 for snappier feel)
            const elapsed = Date.now() - overlayStartTime;
            const remainingTime = Math.max(0, 2000 - elapsed);
            if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
            resumeTimerRef.current = setTimeout(() => setIsResuming(false), remainingTime);
          }
        };

        const handleVisibilityChange = async () => {
          if (document.hidden) {
            // App going to background - record timestamp
            backgroundTimestampRef.current = Date.now();
          } else {
            // App coming to foreground
            const backgroundTime = backgroundTimestampRef.current;
            backgroundTimestampRef.current = null;

            if (backgroundTime) {
              await handleResume(backgroundTime);
            }
          }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Also try Capacitor App plugin if available (for native mobile)
        let capacitorUnlisten = null;
        if (window.Capacitor?.Plugins?.App) {
          const App = window.Capacitor.Plugins.App;
          App.addListener?.('appStateChange', async (state) => {
            if (!state.isActive) {
              backgroundTimestampRef.current = Date.now();
            } else {
              const backgroundTime = backgroundTimestampRef.current;
              backgroundTimestampRef.current = null;

              if (backgroundTime) {
                await handleResume(backgroundTime);
              }
            }
          }).then(handle => { capacitorUnlisten = handle; }).catch((err) => {
            console.warn('Failed to register Capacitor app state listener:', err);
          });
        }

        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
          capacitorUnlisten?.remove?.();
        };
      }, [refreshListings, reloadMineOnly]);

      useEffect(() => {
        if (supporterQueryHandledRef.current) return;
        if (typeof window === 'undefined') return;

        const url = new URL(window.location.href);
        const supporterParam = url.searchParams.get('supporter');
        if (!supporterParam) {
          supporterQueryHandledRef.current = true;
          return;
        }

        supporterQueryHandledRef.current = true;

        const cleanParams = () => {
          url.searchParams.delete('supporter');
          url.searchParams.delete('session_id');
          const nextSearch = url.searchParams.toString();
          const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
          window.history.replaceState({}, document.title, nextUrl);
        };

        if (supporterParam === 'thanks') {
          const sessionId = url.searchParams.get('session_id') || '';
          cleanParams();
          setSupporterUpsellState((prev) => ({
            ...prev,
            open: true,
            mode: 'success',
            busy: true,
            error: '',
            notice: ''
          }));
          setSupporterPromptSeen();
          if (!sessionId) {
            setSupporterUpsellState((prev) => ({
              ...prev,
              busy: false,
              mode: 'success',
              error: 'We could not verify your supporter badge. Please contact support.',
              notice: ''
            }));
            return;
          }
          (async () => {
            try {
              const updated = await api.confirmSupporterCheckout(sessionId);
              if (updated && typeof setUser === 'function') {
                setUser(updated);
              }
              setSupporterUpsellState((prev) => ({
                ...prev,
                busy: false,
                mode: 'success',
                error: '',
                notice: ''
              }));
            } catch (err) {
              const message = err?.message || 'We could not confirm your supporter badge. Please try again.';
              setSupporterUpsellState((prev) => ({
                ...prev,
                busy: false,
                mode: 'success',
                error: message,
                notice: ''
              }));
            }
          })();
        } else if (supporterParam === 'remind-me-later') {
          cleanParams();
          setSupporterPromptSeen();
        } else {
          cleanParams();
        }
      }, [api, setSupporterPromptSeen, setUser]);

      // Supporter prompt auto-popup removed - users can access it via profile icon

      const mineById = useMemo(() => {
        const map = Object.create(null);
        (mine || []).forEach(m => { map[m.id] = m; });
        return map;
      }, [mine]);

      const isEditingScreen = tab === 'listing-edit' && editorState.isOpen;

      const resetEditorState = useCallback(() => {
        setEditorState(createEditorState());
        setEditing(null);
        setInitialListingFiles([]);
      }, [setEditorState, setEditing, setInitialListingFiles]);

      const closeEditor = useCallback(() => {
        if (!editorState.isOpen) {
          resetEditorState();
          if (tab === 'listing-edit') {
            onTabChange('browse');
          }
          return;
        }

        const origin = editorState.originTab || 'browse';
        const reopenId = editorState.reopenListingId;
        const fallbackListing = editorState.draftSnapshot;

        resetEditorState();

        onTabChange(origin);

        if (origin === 'browse' && reopenId) {
          const listingArray = Array.isArray(items) ? items : [];
          const listing = mineById[reopenId] || listingArray.find((it) => it?.id === reopenId) || fallbackListing;
          if (listing) {
            setSelectedListing(listing);
          }
        }
      }, [editorState, onTabChange, items, mineById, resetEditorState, setSelectedListing, tab]);

      // Edit toast functions
      // DISABLED: "Edit recent listing?" toast - uncomment to re-enable
      const showRecentListingToast = useCallback((/* listing */) => {
        // if (!listing?.id) return;
        // setRecentlyCreatedListing(listing);
        // setShowEditToast(true);

        // // Clear any existing timeout
        // if (editToastTimeoutRef.current) {
        //   clearTimeout(editToastTimeoutRef.current);
        // }

        // // Auto-hide after 5 seconds (matches CSS animation duration)
        // editToastTimeoutRef.current = setTimeout(() => {
        //   setShowEditToast(false);
        // }, 5000);
      }, []);

      // Stable callback for when a listing is created/saved
      // This is used by both inline and background queue creation
      const handleListingSaved = useCallback(async (listing, options = {}) => {
        if (listing?.id) {
          addListing(listing);
          // Only show "Edit recent listing?" toast for new listings, not updates
          if (!options.isUpdate) {
            showRecentListingToast(listing);
          }
        }
        // Note: reloadMine/reloadAll are now called directly in the background queue job
        // (similar to how MassList works) to ensure they use stable function references
        await reloadMineOnly();
        await refreshListings({ preserveExisting: true });
      }, [addListing, reloadMineOnly, refreshListings, showRecentListingToast]);

      const dismissEditToast = useCallback(() => {
        setShowEditToast(false);
        if (editToastTimeoutRef.current) {
          clearTimeout(editToastTimeoutRef.current);
        }
      }, []);

      // Note: openListingEditor is defined later, so we access it directly (it will be hoisted as a function reference)
      const handleEditToastClick = useCallback(() => {
        dismissEditToast();
        if (recentlyCreatedListing?.id) {
          openListingEditor({ draft: recentlyCreatedListing, originTab: 'browse' });
        }
      }, [recentlyCreatedListing, dismissEditToast]);

      // Swipe-to-dismiss handlers for edit toast
      const handleEditToastTouchStart = useCallback((e) => {
        const touch = e.touches[0];
        editToastStartXRef.current = touch.clientX;
        editToastCurrentXRef.current = touch.clientX;
        if (editToastSwipeRef.current) {
          editToastSwipeRef.current.style.transition = 'none';
        }
      }, []);

      const handleEditToastTouchMove = useCallback((e) => {
        const touch = e.touches[0];
        editToastCurrentXRef.current = touch.clientX;
        const deltaX = editToastCurrentXRef.current - editToastStartXRef.current;
        if (editToastSwipeRef.current) {
          editToastSwipeRef.current.style.transform = `translateX(${deltaX}px)`;
        }
      }, []);

      const handleEditToastTouchEnd = useCallback(() => {
        const deltaX = editToastCurrentXRef.current - editToastStartXRef.current;
        const threshold = 80; // Swipe threshold in pixels

        if (editToastSwipeRef.current) {
          editToastSwipeRef.current.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        }

        if (Math.abs(deltaX) > threshold) {
          // Swipe was far enough - dismiss
          if (editToastSwipeRef.current) {
            const direction = deltaX > 0 ? 1 : -1;
            editToastSwipeRef.current.style.transform = `translateX(${direction * 400}px)`;
            editToastSwipeRef.current.style.opacity = '0';
          }
          setTimeout(dismissEditToast, 300);
        } else {
          // Snap back
          if (editToastSwipeRef.current) {
            editToastSwipeRef.current.style.transform = 'translateX(0)';
          }
        }
      }, [dismissEditToast]);

      // Cleanup timeout on unmount
      useEffect(() => {
        return () => {
          if (editToastTimeoutRef.current) {
            clearTimeout(editToastTimeoutRef.current);
          }
        };
      }, []);

      const openListingEditor = useCallback(({ draft = null, files = [], originTab: origin, reopenListingId } = {}) => {
        const normalizedFiles = Array.isArray(files) ? files.slice() : [];
        const originValue = origin || tab || 'browse';

        setViewingSeller(null);
        setEditing(draft);
        setInitialListingFiles(normalizedFiles);
        setEditorState(createEditorState({
          isOpen: true,
          originTab: originValue,
          reopenListingId: reopenListingId ?? (draft?.id ?? null),
          draftSnapshot: draft || null
        }));
        onTabChange('listing-edit');
      }, [setEditing, setEditorState, setInitialListingFiles, onTabChange, setViewingSeller, tab]);

      const handleNavigate = useCallback((target) => {
        if (isEditingScreen) {
          resetEditorState();
        }
        onTabChange(target);
      }, [onTabChange, isEditingScreen, resetEditorState]);

      function handleViewSeller(userId, username) {
        setViewingSeller({ id: userId, username });
        setSelectedListing(null);
        if (isMobile) {
          const container = document.querySelector('main.container');
          if (container) container.scrollTop = 0;
        } else {
          window.scrollTo(0, 0);
        }
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

      async function logoutFromProfile() {
        await removePushSubscription();
        await api.logout();
        setUser(null);
        onTabChange('browse');
      }

      function ensureCanCreate() {
        if (!user) {
          handleAuthClick('login');
          return false;
        }
        if (user.account_status === 'locked') {
          showLockedBanner();
          return false;
        }
        return true;
      }

      const handleMobileCaptureClick = useCallback((kind) => {
        if (!isMobile) return;
        if (!ensureCanCreate()) return;
        const ref = kind === 'camera' ? cameraInputRef.current : galleryInputRef.current;
        if (ref) {
          ref.click();
        }
      }, [user, isMobile, ensureCanCreate, cameraInputRef, galleryInputRef]);

      function normalizeFiles(fileList) {
        const MAX_MB = 20;
        const arr = Array.from(fileList || []);
        const valid = [];
        for (const file of arr) {
          if (!file?.type?.startsWith?.('image/')) {
            continue;
          }
          if (file.size > MAX_MB * 1024 * 1024) {
            alert(`Each image must be under ${MAX_MB}MB.`);
            continue;
          }
          valid.push(file);
        }
        return valid;
      }

      async function handleMobileFilesSelected(fileList) {
        if (!fileList || fileList.length === 0) {
          return;
        }
        const files = normalizeFiles(fileList);
        if (!files.length) {
          return;
        }
        if (mobileCreateMode === 'masslist') {
          setInitialMassListFiles(files);
          setShowMassList(true);
          return;
        }
        if (autoListEnabled) {
          // Show "Keep app open" toast immediately - stays visible until server confirms
          if (typeof showUploadingToast === 'function') {
            try { showUploadingToast(); } catch (e) { /* ignore */ }
          }

          const jobId = 'pending-' + Date.now();

          // BLOCKING: Wait for upload + API call to complete before returning
          // This ensures server has all data before user can lock phone
          try {
            console.log('[Mobile AutoList] Starting job', jobId, 'with', files.length, 'files');
            const result = await runAutoList({
              files,
              location: '',
              autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled),
              autoInquiryEnabled,
              backgroundQueueEnabled,
              enqueueListingJob,
              reloadMine: reloadMineOnly,
              reloadAll: refreshListings,
              onJobQueued: () => {
                // Server confirmed receipt - safe to close app now
                if (typeof hideUploadingToast === 'function') {
                  try { hideUploadingToast(); } catch (e) { /* ignore */ }
                }
              },
              onCreated: (createdListing) => {
                try {
                  if (createdListing?.id) {
                    // Add to local state immediately so it appears in both views
                    addListing(createdListing);
                    showRecentListingToast(createdListing);
                  }
                } catch (e) {
                  console.warn('[Mobile AutoList] onCreated error:', e);
                }
              },
              onError: (err) => {
                // Hide toast on error too
                if (typeof hideUploadingToast === 'function') {
                  try { hideUploadingToast(); } catch (e) { /* ignore */ }
                }
                console.error('[Mobile AutoList] Job error:', err);
                const msg = err?.message || String(err);
                if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
                  setShowModerationModal(true);
                }
              }
            });
            console.log('[Mobile AutoList] Result:', result);
          } catch (err) {
            // Hide toast on error
            if (typeof hideUploadingToast === 'function') {
              try { hideUploadingToast(); } catch (e) { /* ignore */ }
            }
            console.error('[Mobile AutoList] Failed:', err);
          }
          return;
        }
        openListingEditor({ draft: null, files, originTab: tab });
      }

      function handleGalleryChange(evt) {
        handleMobileFilesSelected(evt?.target?.files);
        if (evt?.target) {
          evt.target.value = '';
        }
      }

      function handleCameraChange(evt) {
        handleMobileFilesSelected(evt?.target?.files);
        if (evt?.target) {
          evt.target.value = '';
        }
      }

      function handleMobileNav(target) {
        if (target === 'messages' && !user) {
          handleAuthClick('login');
          return;
        }
        if (target === 'profile' && !user) {
          handleAuthClick('login');
          return;
        }
        handleNavigate(target);
      }

      const handlePlusButtonStart = useCallback((e) => {
        // Prevent default to avoid highlighting other buttons during long-press
        e.preventDefault();
        isLongPressRef.current = false;
        plusButtonTimerRef.current = setTimeout(() => {
          isLongPressRef.current = true;
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
          setMobileCreateMode('masslist');
          setShowMassList(true);
        }, 500);
      }, [setShowMassList]);

      const handlePlusButtonEnd = useCallback((e) => {
        if (plusButtonTimerRef.current) {
          clearTimeout(plusButtonTimerRef.current);
          plusButtonTimerRef.current = null;
        }

        if (isLongPressRef.current) {
          e.preventDefault();
          return;
        }
      }, []);

      const handlePlusClick = useCallback((e) => {
        if (isLongPressRef.current) return;
        handleMobileCaptureClick('camera');
      }, [handleMobileCaptureClick]);

      const mobileNavIcons = {
        browse: () => H('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        },
          H('path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }),
          H('polyline', { points: '9 22 9 12 15 12 15 22' })
        ),
        messages: () => H('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        },
          H('path', { d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' })
        ),
        profile: () => H('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        },
          H('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
          H('circle', { cx: 12, cy: 7, r: 4 })
        )
      };

      const mobileCreateIcons = {
        gallery: () => H('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.6,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        },
          H('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
          H('circle', { cx: 9, cy: 10, r: 2.2 }),
          H('path', { d: 'M21 16l-4.8-4.8-3.8 3.9-2.2-2.2L3 18' })
        ),
        camera: () => H('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.6,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        },
          H('path', { d: 'M5.5 7h3l1.4-2.2h4.2L15.5 7H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z' }),
          H('circle', { cx: 12, cy: 13, r: 3.5 })
        )
      };

      const mobileNavLabels = {
        browse: 'Home',
        nearby: 'Nearby',
        messages: 'Messages',
        profile: 'Profile'
      };

      // Sign in icon for unauthenticated users
      const signInIcon = () => H('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      },
        H('path', { d: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4' }),
        H('polyline', { points: '10 17 15 12 10 7' }),
        H('line', { x1: 15, y1: 12, x2: 3, y2: 12 })
      );

      return H(ListingsProvider, { value: listings },
        H(NotificationsProvider, { value: notifications },
          H(React.Fragment, null,
            H(Header, { user, setUser, onNav: handleNavigate, active: tab, unreadCount, hasAdminUnread, onAdminDeleteAll: handleAdminDeleteAll, isMobile, onAuthClick: handleAuthClick }),
            banner && H('div', { className: 'global-banner', role: 'status' },
              H('span', { className: 'banner-text' }, banner.message),
              H('button', {
                type: 'button',
                className: 'banner-dismiss',
                onClick: dismissBanner,
                'aria-label': 'Dismiss locked account notice'
              }, 'Dismiss')
            ),
            H(GlobalLoader, { active: loadingCount > 0 }),
            H(ResumeOverlay, { active: isResuming }),
            H(SupporterInfoModal, {
              open: supporterInfoState.open,
              onClose: handleSupporterInfoClose,
              username: supporterInfoState.username,
              since: supporterInfoState.since,
              tier: supporterInfoState.tier,
              isSelf: supporterInfoState.isSelf,
              onJoin: handleSupporterInfoJoin,
              paymentsDisabled: premiumFreeForAll,
              isIOS: iapService && typeof iapService.isIOSNative === 'function' && iapService.isIOSNative()
            }),
            H(SupporterUpsellModal, {
              open: supporterUpsellState.open,
              mode: supporterUpsellState.mode,
              onClose: closeSupporterUpsell,
              onJoin: handleJoinSupporterProgram,
              busy: supporterUpsellState.busy,
              error: supporterUpsellState.error,
              amount: supporterUpsellState.amount,
              currency: supporterUpsellState.currency,
              premiumAmount: SUPPORTER_PREMIUM_AMOUNT,
              selectedTier: supporterUpsellState.selectedTier,
              onTierChange: handleTierChange,
              paymentsDisabled: premiumFreeForAll,
              notice: supporterUpsellState.notice
            }),

            H(SelectBuyerModal, {
              open: karmaModalOpen,
              onClose: handleKarmaModalClose,
              listingId: karmaListingId,
              onBuyerSelected: handleKarmaBuyerSelected,
              onSkip: handleKarmaSkip,
              premiumFreeForAll
            }),

            LegalAcceptanceModal && H(LegalAcceptanceModal, {
              open: showLegalModal,
              onAccepted: handleLegalAccepted,
              user
            }),

            blockedUserModal,

            H('main', { className: isEditingScreen ? 'container listing-editor-container' : 'container' },
              isEditingScreen
                ? H(ListingFormModal, {
                  isOpen: editorState.isOpen,
                  draft: editing,
                  onClose: closeEditor,
                  onSaved: handleListingSaved,
                  autoListEnabled,
                  autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled),
                  autoInquiryEnabled,
                  backgroundQueueEnabled,
                  enqueueListingJob,
                  reloadMine: reloadMineOnly,
                  reloadAll: refreshListings,
                  initialFiles: initialListingFiles,
                  onModerationError: () => setShowModerationModal(true),
                  isPremium: hasPremiumAccess,
                  onOpenPremiumModal: () => setSupporterUpsellState(s => ({ ...s, open: true, mode: 'prompt' }))
                })
                : (
                  viewingSeller
                    ? H(SellerProfile, {
                      sellerId: viewingSeller.id,
                      sellerUsername: viewingSeller.username,
                      onBack: handleBackFromSeller,
                      user,
                      onMessage: startMessage,
                      onAdminDelete: handleAdminDelete,
                      onSupporterClick: handleSupporterBadgeClick
                    })
                    : H(React.Fragment, null,
                      tab === 'browse' && H(React.Fragment, null,
                        // Mobile-only Trovelr branding above search
                        isMobile && H('h1', {
                          className: 'mobile-home-title',
                          style: {
                            margin: '0 0 12px 0',
                            fontSize: '0.7rem',
                            fontWeight: 400,
                            letterSpacing: '0.25em',
                            textAlign: 'center',
                            color: '#94a3b8',
                            opacity: 0.8
                          }
                        }, 'Trovelr'),
                        H('div', { className: 'row', style: { justifyContent: 'space-between', margin: '12px 0 18px', flexWrap: 'wrap' } },
                          H('div', {
                            style: {
                              display: 'grid',
                              gridTemplateColumns: isMobile ? '1fr 1fr' : 'minmax(200px, 1.5fr) minmax(140px, 1fr) auto',
                              gap: 10,
                              width: isMobile ? '100%' : 'auto',
                              alignItems: 'center'
                            }
                          },
                            H('div', {
                              style: {
                                display: 'flex',
                                gap: 8,
                                gridColumn: isMobile ? '1 / -1' : 'auto',
                                width: '100%',
                                alignItems: 'center'
                              }
                            },
                              H('div', {
                                style: {
                                  position: 'relative',
                                  flex: 1,
                                  minWidth: 0
                                }
                              },
                                H('input', {
                                  ref: searchInputRef,
                                  placeholder: 'Search...',
                                  enterKeyHint: 'search',
                                  value: query,
                                  onChange: e => setQuery(e.target.value),
                                  onFocus: () => setSearchDropdownOpen(true),
                                  onKeyDown: e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      e.target.blur();
                                      handleSearchSubmit();
                                    } else if (e.key === 'Escape') {
                                      setSearchDropdownOpen(false);
                                      e.target.blur();
                                    }
                                  },
                                  style: {
                                    width: '100%',
                                    paddingRight: query && query.trim() ? 68 : 36
                                  }
                                }),
                                // Clear button - only show when there's text
                                query && query.trim() && H('button', {
                                  type: 'button',
                                  onClick: () => { setQuery(''); handleSearchSubmit(''); },
                                  title: 'Clear search',
                                  style: {
                                    position: 'absolute', right: 32, top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', padding: 6, cursor: 'pointer',
                                    color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                  }
                                },
                                  H('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                                    H('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
                                    H('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
                                  )
                                ),
                                // Search button
                                H('button', {
                                  type: 'button',
                                  onClick: () => handleSearchSubmit(),
                                  title: 'Search',
                                  style: {
                                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', padding: 6, cursor: 'pointer',
                                    color: query && query.trim() ? '#2563eb' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'color 0.15s ease'
                                  }
                                },
                                  H('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                                    H('circle', { cx: 11, cy: 11, r: 8 }),
                                    H('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
                                  )
                                ),
                              // Search dropdown
                              searchDropdownOpen && H('div', {
                                ref: searchDropdownRef,
                                className: 'search-dropdown',
                                onMouseDown: (e) => e.stopPropagation(),
                                onClick: (e) => e.stopPropagation(),
                                onTouchStart: (e) => e.stopPropagation(),
                                onTouchEnd: (e) => e.stopPropagation(),
                                style: {
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  right: 0,
                                  marginTop: 4,
                                  background: 'var(--card-bg, #fff)',
                                  borderRadius: 12,
                                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                                  zIndex: 10000,
                                  overflow: 'hidden',
                                  border: '1px solid var(--border-color, #e5e7eb)'
                                }
                              },
                                // Recent searches section
                                (() => {
                                  if (!recentSearches.length) return null;
                                  return H('div', { style: { padding: '8px 12px', borderBottom: '2px solid var(--border-color, #e5e7eb)' } },
                                    H('div', { style: { fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Recent'),
                                    H('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                                      ...recentSearches.map(s => H('button', {
                                        key: s.term,
                                        onClick: () => handleSearchSuggestionClick(s.term),
                                        style: {
                                          background: 'none',
                                          border: 'none',
                                          padding: '6px 8px',
                                          textAlign: 'left',
                                          cursor: 'pointer',
                                          borderRadius: 6,
                                          fontSize: 14,
                                          color: 'var(--text-color, #1f2937)',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 8
                                        },
                                        onMouseEnter: e => e.target.style.background = 'var(--hover-bg, #f3f4f6)',
                                        onMouseLeave: e => e.target.style.background = 'none'
                                      },
                                        H('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: '#9ca3af', strokeWidth: 2 },
                                          H('circle', { cx: 12, cy: 12, r: 10 }),
                                          H('polyline', { points: '12 6 12 12 16 14' })
                                        ),
                                        s.term
                                      ))
                                    )
                                  );
                                })(),
                                // Categories section
                                H('div', { style: { padding: '8px 12px' } },
                                  H('div', { style: { fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Categories'),
                                  H('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                                    ...searchCategories.map(cat => H('button', {
                                      key: cat,
                                      onClick: () => handleSearchSuggestionClick(cat),
                                      className: 'search-category-pill',
                                      style: {
                                        background: 'var(--pill-bg, #f3f4f6)',
                                        border: 'none',
                                        padding: '5px 12px',
                                        borderRadius: 999,
                                        fontSize: 13,
                                        fontWeight: 500,
                                        color: 'var(--text-color, #374151)',
                                        cursor: 'pointer',
                                        transition: 'background 0.15s ease'
                                      }
                                    }, cat))
                                  )
                                )
                              )
                              )
                            ),
                            H(CityAutocomplete, {
                              value: locationQuery,
                              onChange: setLocationQuery,
                              options: cityOptions,
                              onUseMyLocation: async () => {
                                try {
                                  let lat, lon;
                                  // Use Capacitor Geolocation on native, browser API on web
                                  const isNative = window.Capacitor?.isNativePlatform?.();
                                  if (isNative && window.Capacitor?.Plugins?.Geolocation) {
                                    const { Geolocation } = window.Capacitor.Plugins;
                                    const position = await Geolocation.getCurrentPosition({
                                      enableHighAccuracy: true,
                                      timeout: 8000,
                                      maximumAge: 60000
                                    });
                                    lat = position.coords.latitude;
                                    lon = position.coords.longitude;
                                  } else {
                                    if (!('geolocation' in navigator)) { alert('Geolocation not supported'); return; }
                                    const { coords } = await new Promise((res, rej) =>
                                      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
                                    );
                                    lat = coords.latitude;
                                    lon = coords.longitude;
                                  }
                                  const r = await api.reverseGeocode(lat, lon);
                                  const city = r?.city || (r?.display || '').split(',')[0];
                                  if (city) setLocationQuery(city);
                                } catch { alert('Could not determine your location'); }
                              }
                            }),
                            H(CustomDropdown, {
                              value: sort,
                              onChange: e => {
                                const newSort = e.target.value;
                                // Clear GPS cache when switching to nearest to get fresh coordinates
                                if (newSort === 'nearest' && typeof helpers?.clearCoordsCache === 'function') {
                                  helpers.clearCoordsCache();
                                }
                                setSort(newSort);
                              },
                              options: [
                                { value: 'new', label: 'Newest' },
                                { value: 'nearest', label: 'Nearest' },
                                { value: 'price_asc', label: 'Price: Low' },
                                { value: 'price_desc', label: 'Price: High' },
                                { value: 'free', label: 'Free Items' }
                              ],
                              style: { width: '100%' }
                            })
                          ),
                          !isMobile && H('div', { className: 'row', style: { gap: 8 } },
                            H('button', {
                              className: 'btn primary', onClick: () => {
                                if (!user) { handleAuthClick('login'); return; }
                                if (user.account_status === 'locked') { showLockedBanner(); return; }
                                // Use DesktopNewListingModal for consistent desktop experience
                                setShowDesktopNewListingModal(true);
                              }
                            }, 'New listing'),
                            H('button', {
                              className: 'btn', onClick: () => {
                                if (!user) { handleAuthClick('login'); return; }
                                if (user.account_status === 'locked') { showLockedBanner(); return; }
                                setShowMassList(true);
                              }
                            }, 'MassList')
                          )
                        ),



                        // Return to top toast
                        H('button', {
                          className: showReturnToTop ? 'return-to-top-toast visible' : 'return-to-top-toast',
                          onClick: handleReturnToTop,
                          'aria-label': 'Return to top'
                        },
                          H('svg', {
                            width: 18,
                            height: 18,
                            viewBox: '0 0 24 24',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeWidth: 2.5,
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round'
                          },
                          H('polyline', { points: '18 15 12 9 6 15' })
                        )
                      ),

                      listingError && H('div', {
                        className: 'alert warning',
                        style: {
                          margin: '12px 0',
                          display: 'flex',
                          gap: 12,
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }
                      },
                        H('span', { style: { flex: 1 } }, listingError),
                        H('button', {
                          className: 'btn',
                          onClick: () => refreshListings({ preserveExisting: true })
                        }, 'Retry')
                      ),

                      H(ListingsGrid, {
                        items,
                        ads,
                        isMobile,
                        onEnsureCover: ensureCover,
                          onSelect: handleListingTileEvent,
                        isLoading: isFetchingListings,
                        hasMore: hasNext,
                        sentinelRef
                      }),

                      // Empty state message when no listings
                      !items.length && !isFetchingListings && !listingError && H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, 'No listings yet.'),

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
                              setSelectedListing(null);
                              openListingEditor({ draft: rich, originTab: 'browse', reopenListingId: rich?.id });
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
                            showDistance: sort === 'nearest',
                            onViewSeller: handleViewSeller,
                            onToggleSold: mineById[selectedListing?.id] ? toggleSoldWithKarma : undefined,
                            onSupporterClick: handleSupporterBadgeClick,
                            isSaved: !!savedListingIds[selectedListing?.id],
                            onToggleSave: toggleSaveListing
                          }
                        })
                      ),

                      (tab === 'messages') &&
                      (user
                        ? H(MessagesPanel, {
                          user,
                          initialActiveId: activeConvoId,
                          onSeenChange: handleSeen,
                          onConversationsUpdate: handleConversationsUpdate,
                          onViewProfile: (userId) => {
                            if (userId && userId !== user?.id) {
                              handleViewSeller(userId, null);
                            }
                          }
                        })
                        : H('div', { className: 'muted', style: { padding: '16px 0' } }, 'Please log in to view messages.')
                      ),

                      (tab === 'profile') &&
                      H(ProfilePanel, {
                        isMobile,
                        user,
                        items: mine,
                        onEnsureCover: ensureCover,
                        onNewListing: () => {
                          console.log('[NewListing] clicked, isMobile:', isMobile, 'DesktopNewListingModal:', typeof DesktopNewListingModal);
                          if (!user) { handleAuthClick('login'); return; }
                          if (user.account_status === 'locked') { showLockedBanner(); return; }
                          if (isMobile) {
                            openListingEditor({ draft: null, originTab: 'profile' });
                          } else {
                            setShowDesktopNewListingModal(true);
                          }
                        },
                        onEdit: (it) => {
                          if (user?.account_status === 'locked') { showLockedBanner(); return; }
                          const rich = mineById[it.id] || it;
                          openListingEditor({ draft: rich, originTab: 'profile', reopenListingId: rich?.id });
                        },
                        onDelete: async (it) => { if (confirm('Remove this listing? (Your past messages will remain)')) { await api.deleteListing(it.id); await reloadMineOnly(); await refreshListings(); } },
                        onLogout: logoutFromProfile,
                        onAdminDelete: handleAdminDelete,
                        autoListEnabled,
                        autoPostNearbyEnabled,
                        setAutoPostNearbyEnabled,
                        autoInquiryEnabled,
                        setAutoInquiryEnabled,
                        onViewSeller: handleViewSeller,
                        onToggleSold: toggleSoldWithKarma,
                        onSupporterClick: handleSupporterBadgeClick,
                        onJoinSupporterProgram: handleSupporterPromptCta,
                        onListingsChanged: reloadMineOnly,
                        onMessage: startMessage,
                        onToggleSave: toggleSaveListing,
                        savedListingIds
                      }),

                      (tab === 'admin') &&
                      (user?.is_admin
                        ? H(AdminDashboard, { onViewSeller: handleViewSeller, onMessageUser: startDirectMessage, onAdsUpdated: refreshAds })
                        : H('section', { className: 'card', style: { padding: 16 } }, 'Admin access only.'))
                    )
                )
            ),

            showMassList && H(MassListModal, {
              onClose: () => { setShowMassList(false); setInitialMassListFiles([]); setMobileCreateMode('list'); },
              onDone: () => { setInitialMassListFiles([]); setMobileCreateMode('list'); },
              reloadAll: refreshListings,
              reloadMine: reloadMineOnly,
              addListing,
              user,
              onLockedAction: showLockedBanner,
              onAuthClick: handleAuthClick,
              autoPostNearbyEnabled,
              autoInquiryEnabled,
              backgroundQueueEnabled,
              enqueueListingJob,
              initialFiles: initialMassListFiles,
              onModerationError: () => setShowModerationModal(true)
            }),

            showDesktopNewListingModal && H(DesktopNewListingModal, {
              isOpen: showDesktopNewListingModal,
              onClose: () => setShowDesktopNewListingModal(false),
              onListingCreated: () => {
                setShowDesktopNewListingModal(false);
                // Just reload listings - don't open editor (avoids confusing flash)
                reloadMineOnly();
                refreshListings();
              },
              autoPostNearbyEnabled,
              autoInquiryEnabled,
              backgroundQueueEnabled,
              enqueueListingJob,
              reloadMine: reloadMineOnly,
              reloadAll: refreshListings,
              onModerationError: () => setShowModerationModal(true)
            }),

            H(AuthModal, {
              isOpen: authModal.isOpen,
              onClose: () => setAuthModal({ ...authModal, isOpen: false }),
              initialMode: authModal.mode,
              onSuccess: handleAuthSuccess
            }),

            H(ListingQueueToast, null),

            // Desktop location accuracy warning toast
            showDesktopAccuracyToast && H('div', {
              className: 'desktop-accuracy-toast',
              onClick: () => setShowDesktopAccuracyToast(false),
              style: {
                position: 'fixed',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(30, 41, 59, 0.95)',
                color: '#fff',
                padding: '14px 20px',
                borderRadius: 12,
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                maxWidth: 400,
                cursor: 'pointer',
                animation: 'fadeInUp 0.3s ease'
              }
            },
              H('svg', {
                width: 20,
                height: 20,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: '#fbbf24',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                style: { flexShrink: 0 }
              },
                H('circle', { cx: 12, cy: 12, r: 10 }),
                H('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
                H('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 })
              ),
              H('span', { style: { fontSize: 14, lineHeight: 1.4 } },
                'Distance estimates will be less accurate on desktop. For best results, use your phone.'
              )
            ),

            // Moderation flagged modal
            showModerationModal && H('div', {
              className: 'modal-backdrop',
              style: {
                position: 'fixed',
                inset: 0,
                background: 'rgba(17,24,39,0.7)',
                display: 'grid',
                placeItems: 'center',
                zIndex: 10001
              },
              onClick: (e) => { if (e.target === e.currentTarget) setShowModerationModal(false); }
            },
              H('div', {
                style: {
                  background: '#fff',
                  borderRadius: 16,
                  padding: 24,
                  width: 'min(360px, 90vw)',
                  boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
                  textAlign: 'center'
                }
              },
                H('div', {
                  style: {
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: '#fef3c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px'
                  }
                },
                  H('svg', {
                    width: 28,
                    height: 28,
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: '#d97706',
                    strokeWidth: 2,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round'
                  },
                    H('circle', { cx: 12, cy: 12, r: 10 }),
                    H('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
                    H('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 })
                  )
                ),
                H('h3', { style: { margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: '#0f172a' } }, 'Content Under Review'),
                H('p', { style: { margin: '0 0 20px', fontSize: 14, lineHeight: 1.6, color: '#64748b' } },
                  'Your submission has been flagged and is being reviewed by our administrators. This helps us keep the platform safe for everyone.'
                ),
                H('button', {
                  type: 'button',
                  className: 'btn primary',
                  style: { width: '100%', padding: '14px 20px', fontSize: 16 },
                  onClick: () => setShowModerationModal(false)
                }, 'I Understand')
              )
            ),

            // Edit listing toast with rotating cog
            showEditToast && H('div', {
              ref: editToastSwipeRef,
              className: 'edit-listing-toast',
              onClick: handleEditToastClick,
              onTouchStart: handleEditToastTouchStart,
              onTouchMove: handleEditToastTouchMove,
              onTouchEnd: handleEditToastTouchEnd,
              role: 'button',
              tabIndex: 0,
              'aria-label': 'Edit recent listing'
            },
              H('div', { className: 'edit-listing-toast__cog' },
                H('svg', {
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round'
                },
                  H('circle', { cx: 12, cy: 12, r: 3 }),
                  H('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' })
                )
              ),
              H('span', { className: 'edit-listing-toast__text' }, 'Edit recent listing?')
            ),

            // Hidden inputs for camera/gallery
            H('input', {
              key: `gallery-hidden`,
              ref: galleryInputRef,
              type: 'file',
              accept: 'image/*',
              style: { display: 'none' },
              onChange: handleGalleryChange
            }),
            H('input', {
              key: `camera-hidden`,
              ref: cameraInputRef,
              type: 'file',
              accept: 'image/*',
              capture: 'environment',
              style: { display: 'none' },
              onChange: handleCameraChange
            }),

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
            ),

            isMobile && !isEditingScreen && !supporterUpsellState.open && H('nav', {
              className: 'mobile-dashboard',
              role: 'navigation',
              'aria-label': 'Primary'
            },
              // Browse
              H('button', {
                type: 'button',
                className: ['mobile-dashboard__button', tab === 'browse' ? 'is-active' : ''].filter(Boolean).join(' '),
                onClick: () => handleMobileNav('browse'),
                'aria-label': 'Home'
              },
                H('span', { className: 'mobile-dashboard__icon' }, mobileNavIcons.browse())
              ),
              // Plus Button
              H('div', { className: 'mobile-dashboard__plus-container' },
                H('button', {
                  type: 'button',
                  className: 'mobile-dashboard__plus-btn',
                  onMouseDown: handlePlusButtonStart,
                  onMouseUp: handlePlusButtonEnd,
                  onMouseLeave: handlePlusButtonEnd,
                  onTouchStart: handlePlusButtonStart,
                  onTouchEnd: handlePlusButtonEnd,
                  onClick: handlePlusClick,
                  'aria-label': 'Create Listing'
                },
                  H('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'white', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    H('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
                    H('line', { x1: 5, y1: 12, x2: 19, y2: 12 })
                  )
                )
              ),
              // Messages
              H('button', {
                type: 'button',
                className: ['mobile-dashboard__button', tab === 'messages' ? 'is-active' : ''].filter(Boolean).join(' '),
                onClick: () => handleMobileNav('messages'),
                'aria-label': 'Messages'
              },
                H('span', { className: 'mobile-dashboard__icon' }, mobileNavIcons.messages()),
                unreadCount > 0 && H('span', { className: 'mobile-dashboard__badge' })
              ),
              // Profile / Sign In
              H('button', {
                type: 'button',
                className: ['mobile-dashboard__button', tab === 'profile' ? 'is-active' : ''].filter(Boolean).join(' '),
                onClick: () => user ? handleMobileNav('profile') : handleAuthClick('login'),
                'aria-label': user ? 'Profile' : 'Sign In'
              },
                H('span', { className: 'mobile-dashboard__icon' }, user ? mobileNavIcons.profile() : signInIcon())
              )
            )
          )
        )
      );
    });

    function Root() {
      // Apply dark mode on app mount and configure status bar
      useEffect(() => {
        try {
          const theme = localStorage.getItem('theme');
          const isDark = theme === 'dark';
          if (isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
          }
          // Configure iOS status bar based on theme
          console.log('Checking Capacitor...', window.Capacitor);
          console.log('isNativePlatform:', window.Capacitor?.isNativePlatform?.());
          console.log('Plugins:', window.Capacitor?.Plugins);
          if (window.Capacitor?.isNativePlatform?.()) {
            try {
              const { StatusBar } = window.Capacitor.Plugins;
              console.log('StatusBar plugin:', StatusBar);
              if (StatusBar) {
                // Capacitor StatusBar naming is counterintuitive:
                // 'Light' = light/white TEXT (use on dark backgrounds)
                // 'Dark' = dark/black TEXT (use on light backgrounds)
                const style = isDark ? 'Light' : 'Dark';
                console.log('Setting status bar style to:', style);
                StatusBar.setStyle({ style }).then(() => {
                  console.log('StatusBar style set successfully');
                }).catch(err => {
                  console.log('StatusBar setStyle error:', err);
                });
              }
            } catch (e) {
              console.log('StatusBar error:', e);
            }
          }
        } catch (e) {}
      }, []);

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


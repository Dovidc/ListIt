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

  // Resume overlay: show after 60 seconds of background inactivity (matches geolocation staleness)
  const RESUME_INACTIVITY_THRESHOLD_MS = 60 * 1000;

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

    const { LandingPage } = features?.landing || {};

    const {
      useListingsFeature,
      CityAutocomplete,
      useListingModal
    } = listingsFeature;

    const { useMessageCenter } = messageCenter;
    const { MessagesPanel, useMessageActions } = messagesFeature;
    const { AdminDashboard, useAdminListingActions } = adminFeature;
    const { ProfilePanel } = profileFeature;
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
    const supporterComponents = components?.supporter || {};

    const { Header, GlobalLoader, ResumeOverlay } = layoutComponents;
    const { ListingsGrid } = gridComponents;
    const {
      MassListModal,
      ListingModal,
      SellerProfile
    } = listingComponents;
    const { SupporterInfoModal, SupporterUpsellModal, SelectBuyerModal } = supporterComponents;

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
        return premiumFreeForAll || user?.supporter_tier === 'premium' || user?.subscription_status === 'active';
      }, [premiumFreeForAll, user?.supporter_tier, user?.subscription_status]);
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
        aiDescriptionEnabled,
        setAiDescriptionEnabled,
        autoPostNearbyEnabled,
        setAutoPostNearbyEnabled,
        autoInquiryEnabled,
        setAutoInquiryEnabled,
        askCreateActionEnabled,
        setAskCreateActionEnabled
      } = useAppPreferences();
      const [supporterInfoState, setSupporterInfoState] = useState({ open: false, username: '', since: null, isSelf: false });
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
      const [createChoiceModalOpen, setCreateChoiceModalOpen] = useState(false);
      const plusButtonTimerRef = useRef(null);
      const isLongPressRef = useRef(false);

      // Scroll preservation
      const browseScrollPos = useRef(0);
      const prevTabRef = useRef(tab);

      // Resume overlay state - tracks when app went to background and shows refresh screen
      const [isResuming, setIsResuming] = useState(false);
      const backgroundTimestampRef = useRef(null);
      const resumeTimerRef = useRef(null);

      // Wrapper for tab changes to save scroll position
      const onTabChange = useCallback((newTab) => {
        if (tab === 'browse') {
          browseScrollPos.current = window.scrollY;
        }
        handleTabChange(newTab);
      }, [tab, handleTabChange]);

      // Restore scroll position when returning to browse
      React.useLayoutEffect(() => {
        if (tab === 'browse' && prevTabRef.current !== 'browse') {
          window.scrollTo(0, browseScrollPos.current);
        } else if (tab !== 'browse') {
          window.scrollTo(0, 0);
        }
        prevTabRef.current = tab;
      }, [tab]);

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
        console.log('handleTierChange called with:', tier);
        setSupporterUpsellState((prev) => {
          console.log('Previous state:', prev.selectedTier, '→ New state:', tier);
          return { ...prev, selectedTier: tier };
        });
      }, []);

      const handleSupporterBadgeClick = useCallback((payload = {}) => {
        const usernameRaw = typeof payload?.username === 'string' ? payload.username.trim() : '';
        const username = usernameRaw || 'This user';
        const since = payload?.since || null;
        const isSelf = Boolean(payload?.isSelf);
        setSupporterInfoState({ open: true, username, since, isSelf });
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
      }, [api, premiumFreeForAll]);

      const { ads, refreshAds } = useAds();

      const listings = useListingsFeature({ user, currentTab: tab });
      const {
        query,
        setQuery,
        locationQuery,
        setLocationQuery,
        sort,
        setSort,
        hasNext,
        isFetchingListings,
        sentinelRef,
        reloadMineOnly,
        refreshListings,
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

      // Backward compatibility aliases
      const all = items;

      // Karma modal state
      const [karmaModalOpen, setKarmaModalOpen] = useState(false);
      const [karmaListingId, setKarmaListingId] = useState(null);

      // Wrap toggleSold with karma logic for premium users
      const toggleSoldWithKarma = useCallback(async (listing, makeSold) => {
        console.log('=== KARMA HANDLER (app-shell) START ===');
        console.log('Listing:', listing);
        console.log('Make sold?', makeSold);
        console.log('User:', user);
        console.log('User has premium access:', hasPremiumAccess);

        if (makeSold && hasPremiumAccess) {
          // Show karma modal for premium users when marking as sold
          console.log('Opening karma modal for listing:', listing.id);
          setKarmaListingId(listing.id);
          setKarmaModalOpen(true);
          // Don't mark as sold yet - wait for modal
        } else {
          // Non-premium users or unmarking sold - proceed normally
          console.log('Proceeding with normal toggle sold');
          await toggleSold?.(listing, makeSold);
        }
        console.log('=== KARMA HANDLER (app-shell) END ===');
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
        enqueueListingJob
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

      const { startMessage, startDirectMessage, handleSeen } = useMessageActions({
        user,
        onConversationOpened: setActiveConvoId,
        onTabChange: onTabChange,
        onSellerCleared: () => setViewingSeller(null),
        recomputeUnread
      });

      useEffect(() => {
        AppNav.setUser = setUser;
        AppNav.setTab = onTabChange;
        AppNav.notifyLocked = showLockedBanner;
        return () => {
          AppNav.setUser = () => { };
          AppNav.setTab = () => { };
          AppNav.notifyLocked = () => { };
        };
      }, [setUser, onTabChange, showLockedBanner]);
      useEffect(() => {
        AppNav.incLoad = () => setLoadingCount(c => c + 1);
        AppNav.decLoad = () => setLoadingCount(c => Math.max(0, c - 1));
      }, []);

      // Background/foreground detection - show resume overlay after extended inactivity
      useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        const handleVisibilityChange = async () => {
          if (document.hidden) {
            // App going to background - record timestamp
            backgroundTimestampRef.current = Date.now();
          } else {
            // App coming to foreground
            const backgroundTime = backgroundTimestampRef.current;
            backgroundTimestampRef.current = null;

            if (backgroundTime && (Date.now() - backgroundTime) >= RESUME_INACTIVITY_THRESHOLD_MS) {
              // Was in background for a while - show overlay and refresh
              const overlayStartTime = Date.now();
              setIsResuming(true);
              try {
                // Clear cached GPS coordinates so we get fresh location
                if (typeof helpers?.clearCoordsCache === 'function') {
                  helpers.clearCoordsCache();
                }
                await refreshListings();
                await reloadMineOnly();
              } catch (err) {
                console.error('Error refreshing on resume:', err);
              } finally {
                // Ensure overlay shows for at least 3 seconds
                const elapsed = Date.now() - overlayStartTime;
                const remainingTime = Math.max(0, 3000 - elapsed);
                if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
                resumeTimerRef.current = setTimeout(() => setIsResuming(false), remainingTime);
              }
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

              if (backgroundTime && (Date.now() - backgroundTime) >= RESUME_INACTIVITY_THRESHOLD_MS) {
                const overlayStartTime = Date.now();
                setIsResuming(true);
                try {
                  // Clear cached GPS coordinates so we get fresh location
                  if (typeof helpers?.clearCoordsCache === 'function') {
                    helpers.clearCoordsCache();
                  }
                  await refreshListings();
                  await reloadMineOnly();
                } catch (err) {
                  console.error('Error refreshing on resume:', err);
                } finally {
                  // Ensure overlay shows for at least 3 seconds
                  const elapsed = Date.now() - overlayStartTime;
                  const remainingTime = Math.max(0, 3000 - elapsed);
                  if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
                  resumeTimerRef.current = setTimeout(() => setIsResuming(false), remainingTime);
                }
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

      useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (!user || user.supporter_badge) return undefined;
        if (premiumFreeForAll) return undefined;
        if (supporterUpsellState.open || supporterInfoState.open) return undefined;
        if (tab !== 'browse') return undefined;

        try {
          const raw = window.localStorage?.getItem(SUPPORTER_PROMPT_KEY);
          const last = Number(raw || 0);
          if (Number.isFinite(last) && Date.now() - last < SUPPORTER_PROMPT_INTERVAL_MS) {
            return undefined;
          }
        } catch {
          // Ignore storage failures
        }

        const timer = window.setTimeout(() => {
          showSupporterPrompt();
        }, SUPPORTER_PROMPT_DELAY_MS);

        return () => {
          window.clearTimeout(timer);
        };
      }, [user, tab, supporterUpsellState.open, supporterInfoState.open, showSupporterPrompt, premiumFreeForAll]);

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
          alert('Log in to create a listing.');
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

      function handleMobileFilesSelected(fileList) {
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
          alert('Log in to view messages.');
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
        console.log('handlePlusButtonStart', e.type);
        isLongPressRef.current = false;
        plusButtonTimerRef.current = setTimeout(() => {
          console.log('Long press triggered');
          isLongPressRef.current = true;
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
          setMobileCreateMode('masslist');
          setShowMassList(true);
        }, 500);
      }, [setShowMassList]);

      const handlePlusButtonEnd = useCallback((e) => {
        console.log('handlePlusButtonEnd', e.type);
        if (plusButtonTimerRef.current) {
          clearTimeout(plusButtonTimerRef.current);
          plusButtonTimerRef.current = null;
        }

        if (isLongPressRef.current) {
          console.log('Preventing click due to long press');
          e.preventDefault();
          return;
        }
      }, []);

      const handlePlusClick = useCallback((e) => {
        console.log('handlePlusClick', { isLongPress: isLongPressRef.current, askCreateActionEnabled });
        if (isLongPressRef.current) return;

        if (askCreateActionEnabled) {
          console.log('Opening choice modal');
          setCreateChoiceModalOpen(true);
        } else {
          console.log('Opening camera directly');
          handleMobileCaptureClick('camera');
        }
      }, [askCreateActionEnabled, handleMobileCaptureClick]);

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

      // Show Landing Page for unauthenticated mobile users
      if (isMobile && !user && !loadingUser) {
        return H(LandingPage, {
          onLogin: (loggedInUser) => {
            setUser(loggedInUser);
          }
        });
      }

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
              isSelf: supporterInfoState.isSelf,
              onJoin: handleSupporterInfoJoin,
              paymentsDisabled: premiumFreeForAll
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

            H('main', { className: isEditingScreen ? 'container listing-editor-container' : 'container' },
              isEditingScreen
                ? H(ListingFormModal, {
                  isOpen: editorState.isOpen,
                  draft: editing,
                  onClose: closeEditor,
                  onSaved: async () => {
                    await refreshListings({ preserveExisting: true });
                    await reloadMineOnly();
                  },
                  autoListEnabled,
                  aiDescriptionEnabled,
                  autoPostNearbyEnabled: (isMobile && autoPostNearbyEnabled),
                  autoInquiryEnabled,
                  backgroundQueueEnabled,
                  enqueueListingJob,
                  initialFiles: initialListingFiles
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
                                position: 'relative',
                                gridColumn: isMobile ? '1 / -1' : 'auto',
                                width: '100%'
                              }
                            },
                              H('input', {
                                placeholder: 'Search...',
                                value: query,
                                onChange: e => setQuery(e.target.value),
                                style: {
                                  width: '100%',
                                  paddingRight: query && query.trim() ? 32 : 8
                                }
                              }),
                              query && query.trim() && H('button', {
                                type: 'button',
                                onClick: () => setQuery(''),
                                title: 'Clear search',
                                style: {
                                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                  background: 'none', border: 'none', padding: 6, cursor: 'pointer',
                                  color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }
                              },
                                H('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                                  H('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
                                  H('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
                                )
                              )
                            ),
                            H(CityAutocomplete, {
                              value: locationQuery,
                              onChange: setLocationQuery,
                              options: cityOptions,
                              onUseMyLocation: async () => {
                                try {
                                  if (!('geolocation' in navigator)) { alert('Geolocation not supported'); return; }
                                  const { coords } = await new Promise((res, rej) =>
                                    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
                                  );
                                  const r = await api.reverseGeocode(coords.latitude, coords.longitude);
                                  const city = r?.city || (r?.display || '').split(',')[0];
                                  if (city) setLocationQuery(city);
                                } catch { alert('Could not determine your location'); }
                              }
                            }),
                            H('select', {
                              value: sort,
                              onChange: e => {
                                const newSort = e.target.value;
                                // Clear GPS cache when switching to nearest to get fresh coordinates
                                if (newSort === 'nearest' && typeof helpers?.clearCoordsCache === 'function') {
                                  helpers.clearCoordsCache();
                                }
                                setSort(newSort);
                              },
                              style: { width: '100%' }
                            },
                              H('option', { value: 'new' }, 'Newest'),
                              H('option', { value: 'nearest' }, 'Nearest'),
                              H('option', { value: 'price_asc' }, 'Price: Low'),
                              H('option', { value: 'price_desc' }, 'Price: High'),
                              H('option', { value: 'city' }, 'City')
                            )
                          ),
                          !isMobile && H('div', { className: 'row', style: { gap: 8 } },
                            H('button', {
                              className: 'btn primary', onClick: () => {
                                if (!user) { alert('Log in to create a listing.'); return; }
                                if (user.account_status === 'locked') { showLockedBanner(); return; }
                                openListingEditor({ draft: null, originTab: 'browse' });
                              }
                            }, 'New listing'),
                            H('button', {
                              className: 'btn', onClick: () => {
                                if (!user) { alert('Log in to create listings.'); return; }
                                if (user.account_status === 'locked') { showLockedBanner(); return; }
                                setShowMassList(true);
                              }
                            }, 'MassList')
                          )
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

                        // "No more results" message shown below grid
                        !isFetchingListings && !hasNext && items.length > 0 && H('div', {
                          style: {
                            display: 'flex',
                            justifyContent: 'center',
                            padding: '16px 0',
                            minHeight: 40
                          }
                        },
                          H('span', { className: 'muted' }, 'No more results')
                        ),

                        !items.length && H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, 'No listings yet.'),

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
                            onSupporterClick: handleSupporterBadgeClick
                          }
                        })
                      ),

                      (tab === 'messages') &&
                      (user
                        ? H(MessagesPanel, {
                          user,
                          initialActiveId: activeConvoId,
                          onSeenChange: handleSeen,
                          onConversationsUpdate: handleConversationsUpdate
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
                          if (!user) { alert('Log in to create a listing.'); return; }
                          if (user.account_status === 'locked') { showLockedBanner(); return; }
                          openListingEditor({ draft: null, originTab: 'profile' });
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
                        aiDescriptionEnabled,
                        setAiDescriptionEnabled,
                        autoPostNearbyEnabled,
                        setAutoPostNearbyEnabled,
                        autoInquiryEnabled,
                        setAutoInquiryEnabled,
                        onViewSeller: handleViewSeller,
                        onToggleSold: toggleSoldWithKarma,
                        onSupporterClick: handleSupporterBadgeClick,
                        onJoinSupporterProgram: handleSupporterPromptCta,
                        askCreateActionEnabled,
                        setAskCreateActionEnabled
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
              user,
              onLockedAction: showLockedBanner,
              autoPostNearbyEnabled,
              aiDescriptionEnabled,
              autoInquiryEnabled,
              backgroundQueueEnabled,
              enqueueListingJob,
              initialFiles: initialMassListFiles
            }),

            H(AuthModal, {
              isOpen: authModal.isOpen,
              onClose: () => setAuthModal({ ...authModal, isOpen: false }),
              initialMode: authModal.mode,
              onSuccess: handleAuthSuccess
            }),

            H(ListingQueueToast, null),

            createChoiceModalOpen && H('div', {
              className: 'modal open',
              style: { zIndex: 9999 },
              onClick: (e) => { if (e.target === e.currentTarget) setCreateChoiceModalOpen(false); }
            },
              H('div', { className: 'modal-inner', style: { maxWidth: 300, padding: 24, textAlign: 'center', borderRadius: 16 } },
                H('h3', { style: { marginTop: 0, marginBottom: 20 } }, 'Create Listing'),
                H('div', { style: { display: 'grid', gap: 12 } },
                  H('button', {
                    className: 'btn primary',
                    style: { justifyContent: 'center' },
                    onClick: () => { setCreateChoiceModalOpen(false); handleMobileCaptureClick('camera'); }
                  }, 'Take Photo'),
                  H('button', {
                    className: 'btn',
                    style: { justifyContent: 'center' },
                    onClick: () => { setCreateChoiceModalOpen(false); handleMobileCaptureClick('gallery'); }
                  }, 'Choose from Gallery')
                ),
                H('button', {
                  className: 'btn',
                  style: { marginTop: 16, border: 'none', background: 'transparent', width: '100%', color: '#666' },
                  onClick: () => setCreateChoiceModalOpen(false)
                }, 'Cancel')
              )
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

            isMobile && !isEditingScreen && H('nav', {
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
              // Profile
              H('button', {
                type: 'button',
                className: ['mobile-dashboard__button', tab === 'profile' ? 'is-active' : ''].filter(Boolean).join(' '),
                onClick: () => handleMobileNav('profile'),
                'aria-label': 'Profile'
              },
                H('span', { className: 'mobile-dashboard__icon' }, mobileNavIcons.profile())
              )
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


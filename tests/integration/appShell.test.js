const path = require('path');

describe('app shell integration', () => {
  const appShellPath = path.join(__dirname, '..', '..', 'public', 'app', 'app-shell.js');
  let createAppShell;

  beforeEach(() => {
    jest.resetModules();
    global.window = { ListItApp: { app: {} } };
    global.alert = jest.fn();
    global.confirm = jest.fn(() => true);
    global.navigator = { geolocation: { getCurrentPosition: jest.fn() } };
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(appShellPath);
    createAppShell = global.window.ListItApp.app.createAppShell;
  });

  afterEach(() => {
    delete global.window;
    delete global.alert;
    delete global.confirm;
    delete global.navigator;
  });

  function createReact({ stateResults = [] } = {}) {
    const stateSetters = [];
    const effects = [];

    return {
      React: {
        memo: (component) => component,
        Fragment: Symbol('Fragment'),
        useState: jest.fn((initial) => {
          const index = stateSetters.length;
          const value = stateResults.length > index ? stateResults[index] : initial;
          const setter = jest.fn();
          stateSetters.push(setter);
          return [value, setter];
        }),
        useEffect: jest.fn((effect) => {
          effects.push(effect);
        }),
        useMemo: jest.fn((factory) => factory())
      },
      stateSetters,
      effects
    };
  }

  function createDependencies({
    stateResults = [true, 2],
    tab = 'browse',
    viewingSeller = null,
    isMobile = true
  } = {}) {
    const { React, stateSetters, effects } = createReact({ stateResults });

    const helpers = {
      H: jest.fn(() => 'element')
    };

    const setUser = jest.fn();
    const setTab = jest.fn();
    const showLockedBanner = jest.fn();
    const dismissBanner = jest.fn();
    const setViewingSeller = jest.fn();
    const setAuthModal = jest.fn();
    const handleTabChange = jest.fn();
    const openAuthModal = jest.fn();

    const useAuth = jest.fn(() => ({
      user: { id: 'user-1', account_status: 'active', is_admin: true },
      setUser,
      pushMeta: { token: 'push-token' }
    }));

    const useAppView = jest.fn(() => ({
      tab,
      setTab,
      banner: { message: 'Account locked' },
      showLockedBanner,
      dismissBanner,
      viewingSeller,
      setViewingSeller,
      authModal: { isOpen: true, mode: 'login' },
      setAuthModal,
      handleTabChange,
      openAuthModal,
      isMobile
    }));

    const preferences = {
      autoListEnabled: true,
      setAutoListEnabled: jest.fn(),
      aiDescriptionEnabled: true,
      setAiDescriptionEnabled: jest.fn(),
      autoPostNearbyEnabled: true,
      setAutoPostNearbyEnabled: jest.fn()
    };

    const useAppPreferences = jest.fn(() => preferences);

    const adsResult = { ads: [{ id: 'ad-1' }], refreshAds: jest.fn() };
    const useAds = jest.fn(() => adsResult);

    const listingsResult = {
      listings: [{ id: 'listing-1' }],
      setListings: jest.fn(),
      mine: [{ id: 'listing-1' }],
      setMine: jest.fn(),
      query: 'initial query',
      setQuery: jest.fn(),
      locationQuery: 'Initial City',
      setLocationQuery: jest.fn(),
      sort: 'new',
      setSort: jest.fn(),
      hasNext: false,
      isFetchingListings: false,
      sentinelRef: { current: null },
      selectedListing: { id: 'listing-1' },
      setSelectedListing: jest.fn(),
      editing: { id: 'listing-edit' },
      setEditing: jest.fn(),
      showMassList: true,
      setShowMassList: jest.fn(),
      reloadMineOnly: jest.fn(),
      refreshListings: jest.fn(() => Promise.resolve()),
      toggleSold: jest.fn(),
      cityOptions: ['City'],
      items: [{ id: 'listing-1' }],
      ensureCover: jest.fn()
    };

    const useListingsFeature = jest.fn(() => listingsResult);

    const notificationsValue = {
      messageToasts: [{ id: 'toast-1', title: 'Hello', preview: 'World' }],
      handleToastClick: jest.fn(),
      handleConversationsUpdate: jest.fn()
    };

    const messageCenterResult = {
      activeConvoId: 'convo-1',
      setActiveConvoId: jest.fn(),
      unreadCount: 7,
      hasAdminUnread: true,
      recomputeUnread: jest.fn(),
      notifications: notificationsValue
    };

    const useMessageCenter = jest.fn(() => messageCenterResult);

    const messageActions = {
      startMessage: jest.fn(),
      startDirectMessage: jest.fn(),
      handleSeen: jest.fn()
    };

    const useMessageActions = jest.fn(() => messageActions);

    const adminActions = {
      handleAdminDeleteAll: jest.fn(),
      handleAdminDelete: jest.fn()
    };

    const useAdminListingActions = jest.fn(() => adminActions);

    const listingModalHooks = {
      openListingModal: jest.fn(),
      handleListingTileEvent: jest.fn()
    };

    const useListingModal = jest.fn(() => listingModalHooks);

    const pushResult = {
      removePushSubscription: jest.fn(() => Promise.resolve())
    };

    const usePushNotifications = jest.fn(() => pushResult);

    const queueState = {
      backgroundQueueEnabled: true,
      enqueueListingJob: jest.fn()
    };

    const useListingQueueState = jest.fn(() => queueState);

    const features = {
      auth: { AuthProvider: jest.fn(), useAuth, AuthModal: jest.fn() },
      listings: { useListingsFeature, CityAutocomplete: jest.fn(), useListingModal },
      messageCenter: { useMessageCenter },
      messages: { MessagesPanel: jest.fn(), useMessageActions },
      admin: { AdminDashboard: jest.fn(), useAdminListingActions },
      profile: { ProfilePanel: jest.fn() },
      nearby: { NearbyPanel: jest.fn() },
      listingForms: { ListingFormModal: jest.fn() },
      preferences: { useAppPreferences },
      push: { usePushNotifications },
      ads: { useAds },
      appView: { useAppView }
    };

    const contexts = {
      listings: { ListingsProvider: jest.fn() },
      notifications: { NotificationsProvider: jest.fn() },
      listingQueue: { ListingQueueProvider: jest.fn(), ListingQueueToast: jest.fn(), useListingQueueState }
    };

    const components = {
      layout: { Header: jest.fn(), GlobalLoader: jest.fn() },
      grid: { ListingsGrid: jest.fn() },
      listing: { MassListModal: jest.fn(), ListingModal: jest.fn(), SellerProfile: jest.fn() }
    };

    const uploads = {
      prepareListingForModal: jest.fn(),
      warmListingImages: jest.fn()
    };

    const utilities = {
      price: jest.fn((value) => `price:${value}`),
      fmtDistance: jest.fn((value) => `distance:${value}`)
    };

    return {
      React,
      ReactDOM: {},
      api: {
        logout: jest.fn(() => Promise.resolve()),
        reverseGeocode: jest.fn(() => Promise.resolve()),
        deleteListing: jest.fn(() => Promise.resolve())
      },
      helpers,
      AppNav: {
        incLoad: jest.fn(),
        decLoad: jest.fn(),
        setUser: jest.fn(),
        setTab: jest.fn(),
        notifyLocked: jest.fn()
      },
      features,
      contexts,
      components,
      uploads,
      utilities,
      __mocks: {
        stateSetters,
        effects,
        runEffects: () => effects.map((effect) => (typeof effect === 'function' ? effect() : undefined)),
        setUser,
        setTab,
        showLockedBanner,
        dismissBanner,
        setViewingSeller,
        setAuthModal,
        handleTabChange,
        openAuthModal,
        listingsResult,
        notificationsValue,
        messageCenterResult,
        messageActions,
        adminActions,
        queueState,
        listingModalHooks,
        preferences,
        adsResult,
        pushResult,
        refreshListings: listingsResult.refreshListings,
        reloadMineOnly: listingsResult.reloadMineOnly,
        setSelectedListing: listingsResult.setSelectedListing,
        setEditing: listingsResult.setEditing
      }
    };
  }

  test('Root composes auth and listing queue providers', () => {
    const dependencies = createDependencies({ stateResults: [false, 0] });
    const { App, Root } = createAppShell(dependencies);

    dependencies.helpers.H.mockClear();
    Root();

    const calls = dependencies.helpers.H.mock.calls;

    expect(calls.find(([component]) => component === App)).toBeDefined();
    expect(calls.find(([component]) => component === dependencies.contexts.listingQueue.ListingQueueProvider)).toBeDefined();
    expect(calls.find(([component]) => component === dependencies.features.auth.AuthProvider)).toBeDefined();
  });

  test('App wires feature outputs into UI components and AppNav', async () => {
    const dependencies = createDependencies({ stateResults: [true, 2], tab: 'browse', isMobile: true });
    const { App } = createAppShell(dependencies);

    dependencies.helpers.H.mockClear();
    App();

    const calls = dependencies.helpers.H.mock.calls;

    const listingsProviderCall = calls.find(([component]) => component === dependencies.contexts.listings.ListingsProvider);
    expect(listingsProviderCall).toBeDefined();
    expect(listingsProviderCall[1].value).toBe(dependencies.__mocks.listingsResult);

    const notificationsProviderCall = calls.find(([component]) => component === dependencies.contexts.notifications.NotificationsProvider);
    expect(notificationsProviderCall).toBeDefined();
    expect(notificationsProviderCall[1].value).toBe(dependencies.__mocks.notificationsValue);

    const headerCall = calls.find(([component]) => component === dependencies.components.layout.Header);
    expect(headerCall).toBeDefined();
    expect(headerCall[1]).toMatchObject({
      user: { id: 'user-1', account_status: 'active', is_admin: true },
      onNav: dependencies.__mocks.handleTabChange,
      active: 'browse',
      unreadCount: dependencies.__mocks.messageCenterResult.unreadCount,
      hasAdminUnread: dependencies.__mocks.messageCenterResult.hasAdminUnread,
      onAdminDeleteAll: dependencies.__mocks.adminActions.handleAdminDeleteAll,
      isMobile: true
    });
    headerCall[1].onAuthClick('login');
    expect(dependencies.__mocks.openAuthModal).toHaveBeenCalledWith('login');

    const globalLoaderCall = calls.find(([component]) => component === dependencies.components.layout.GlobalLoader);
    expect(globalLoaderCall).toBeDefined();
    expect(globalLoaderCall[1].active).toBe(true);

    const listingsGridCall = calls.find(([component]) => component === dependencies.components.grid.ListingsGrid);
    expect(listingsGridCall).toBeDefined();
    expect(listingsGridCall[1]).toMatchObject({
      items: dependencies.__mocks.listingsResult.items,
      ads: dependencies.__mocks.adsResult.ads,
      onEnsureCover: dependencies.__mocks.listingsResult.ensureCover,
      onSelect: dependencies.__mocks.listingModalHooks.handleListingTileEvent
    });

    const massListCall = calls.find(([component]) => component === dependencies.components.listing.MassListModal);
    expect(massListCall).toBeDefined();
    expect(massListCall[1]).toMatchObject({
      reloadAll: dependencies.__mocks.refreshListings,
      reloadMine: dependencies.__mocks.listingsResult.reloadMineOnly,
      onLockedAction: dependencies.__mocks.showLockedBanner,
      backgroundQueueEnabled: dependencies.__mocks.queueState.backgroundQueueEnabled,
      enqueueListingJob: dependencies.__mocks.queueState.enqueueListingJob,
      autoPostNearbyEnabled: true
    });

    const listingFormCall = calls.find(([component]) => component === dependencies.features.listingForms.ListingFormModal);
    expect(listingFormCall).toBeDefined();
    expect(listingFormCall[1]).toMatchObject({
      isOpen: true,
      draft: dependencies.__mocks.listingsResult.editing,
      autoListEnabled: dependencies.__mocks.preferences.autoListEnabled,
      aiDescriptionEnabled: dependencies.__mocks.preferences.aiDescriptionEnabled,
      autoPostNearbyEnabled: true,
      backgroundQueueEnabled: dependencies.__mocks.queueState.backgroundQueueEnabled,
      enqueueListingJob: dependencies.__mocks.queueState.enqueueListingJob
    });
    listingFormCall[1].onClose();
    expect(dependencies.__mocks.stateSetters[0]).toHaveBeenCalledWith(false);
    expect(dependencies.__mocks.setEditing).toHaveBeenCalledWith(null);
    await listingFormCall[1].onSaved();
    expect(dependencies.__mocks.refreshListings).toHaveBeenCalledWith({ preserveExisting: true });

    const authModalCall = calls.find(([component]) => component === dependencies.features.auth.AuthModal);
    expect(authModalCall).toBeDefined();
    expect(authModalCall[1]).toMatchObject({ isOpen: true, initialMode: 'login' });
    authModalCall[1].onClose();
    expect(dependencies.__mocks.setAuthModal).toHaveBeenCalledWith({ isOpen: false, mode: 'login' });
    const authSuccessUser = { id: 'user-2' };
    authModalCall[1].onSuccess(authSuccessUser);
    expect(dependencies.__mocks.setUser).toHaveBeenCalledWith(authSuccessUser);
    expect(dependencies.__mocks.refreshListings).toHaveBeenCalled();
    expect(dependencies.__mocks.listingsResult.reloadMineOnly).toHaveBeenCalled();

    const listingModalCall = calls.find(([component]) => component === dependencies.components.listing.ListingModal);
    expect(listingModalCall).toBeDefined();
    expect(listingModalCall[1]).toMatchObject({
      open: true,
      item: dependencies.__mocks.listingsResult.selectedListing
    });
    listingModalCall[1].onClose();
    expect(dependencies.__mocks.setSelectedListing).toHaveBeenCalledWith(null);

    const { cardProps } = listingModalCall[1];
    expect(cardProps).toMatchObject({
      user: { id: 'user-1', account_status: 'active', is_admin: true },
      canEdit: true,
      onMessage: dependencies.__mocks.messageActions.startMessage,
      onAdminDelete: dependencies.__mocks.adminActions.handleAdminDelete,
      onViewSeller: expect.any(Function)
    });

    cardProps.onEdit({ id: 'listing-1' });
    expect(dependencies.__mocks.setEditing).toHaveBeenCalledWith(dependencies.__mocks.listingsResult.mine[0]);
    expect(dependencies.__mocks.stateSetters[0]).toHaveBeenCalledWith(true);
    expect(dependencies.__mocks.setSelectedListing).toHaveBeenCalledWith(null);

    await cardProps.onDelete({ id: 'listing-1' });
    expect(global.confirm).toHaveBeenCalled();
    expect(dependencies.api.deleteListing).toHaveBeenCalledWith('listing-1');
    expect(dependencies.__mocks.setSelectedListing).toHaveBeenCalledWith(null);
    expect(dependencies.__mocks.refreshListings).toHaveBeenCalled();

    cardProps.onViewSeller('seller-1', 'seller');
    expect(dependencies.__mocks.setViewingSeller).toHaveBeenCalledWith({ id: 'seller-1', username: 'seller' });
    expect(dependencies.__mocks.setSelectedListing).toHaveBeenCalledWith(null);

    expect(cardProps.onToggleSold).toBe(dependencies.__mocks.listingsResult.toggleSold);

    const listingQueueToastCall = calls.find(([component]) => component === dependencies.contexts.listingQueue.ListingQueueToast);
    expect(listingQueueToastCall).toBeDefined();

    const toastCalls = calls.filter(([component, props]) => component === 'div' && props && props.className === 'message-toast');
    expect(toastCalls).toHaveLength(dependencies.__mocks.notificationsValue.messageToasts.length);
    toastCalls[0][1].onClick();
    expect(dependencies.__mocks.notificationsValue.handleToastClick).toHaveBeenCalledWith(dependencies.__mocks.notificationsValue.messageToasts[0]);

    const cleanupResults = dependencies.__mocks.runEffects();
    expect(dependencies.AppNav.setUser).toBe(dependencies.__mocks.setUser);
    expect(dependencies.AppNav.setTab).toBe(dependencies.__mocks.setTab);
    expect(dependencies.AppNav.notifyLocked).toBe(dependencies.__mocks.showLockedBanner);

    const setLoadingCount = dependencies.__mocks.stateSetters[1];
    dependencies.AppNav.incLoad();
    expect(setLoadingCount).toHaveBeenCalledWith(expect.any(Function));
    const incUpdater = setLoadingCount.mock.calls[0][0];
    expect(incUpdater(2)).toBe(3);

    dependencies.AppNav.decLoad();
    const decUpdater = setLoadingCount.mock.calls[1][0];
    expect(decUpdater(0)).toBe(0);
    expect(decUpdater(5)).toBe(4);

    const cleanup = cleanupResults.find((fn) => typeof fn === 'function');
    if (cleanup) {
      cleanup();
    }

    const setUserCallCount = dependencies.__mocks.setUser.mock.calls.length;
    dependencies.AppNav.setUser('after-cleanup');
    expect(dependencies.__mocks.setUser.mock.calls.length).toBe(setUserCallCount);
  });
});


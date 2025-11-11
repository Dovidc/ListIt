const path = require('path');

describe('browser app integration', () => {
  const browserAppPath = path.join(__dirname, '..', '..', 'public', 'app', 'bootstrap', 'browser-app.js');
  let createBrowserApp;

  beforeEach(() => {
    jest.resetModules();
    global.window = { ListItApp: { app: {} } };
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(browserAppPath);
    createBrowserApp = global.window.ListItApp.bootstrap.createBrowserApp;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
  });

  function createCore() {
    const api = { marker: 'api-client' };
    return {
      api,
      createApiClient: jest.fn(() => api),
      formatCurrency: jest.fn((value) => `currency:${value}`),
      formatDistance: jest.fn((value) => `distance:${value}`),
      haversineMeters: jest.fn(() => 42)
    };
  }

  function createReactDOM() {
    const root = { render: jest.fn() };
    return {
      root,
      instance: {
        createRoot: jest.fn(() => root),
        render: jest.fn()
      }
    };
  }

  function stubHelpers() {
    const H = jest.fn(() => 'element');
    return {
      H,
      isMobileDevice: jest.fn(() => false),
      seenKey: jest.fn(() => 'seen'),
      loadSeen: jest.fn(),
      saveSeen: jest.fn(),
      urlToDataUrl: jest.fn(),
      base64UrlToUint8Array: jest.fn(),
      arrayBufferToBase64Url: jest.fn(),
      serializePushSubscription: jest.fn(),
      createConcurrencyLimiter: jest.fn(),
      getUserCoordsOnce: jest.fn(),
      interleaveByColumns: jest.fn(),
      useColumnCount: jest.fn(),
      useElementWidth: jest.fn(),
      useWindowScrollY: jest.fn(),
      useBodyScrollLock: jest.fn(),
      pageTop: jest.fn(),
      normalizeListingsResponse: jest.fn(),
      asArray: jest.fn((value) => (Array.isArray(value) ? value : value == null ? [] : [value])),
      useVirtualMasonry: jest.fn()
    };
  }

  function createAppBundles(helpers, appNav) {
    const uploads = {
      dedupeImageUrls: jest.fn(),
      collectListingImages: jest.fn(),
      selectPrimaryListingImage: jest.fn(),
      clearDraftCacheForFile: jest.fn(),
      uploadFileDraft: jest.fn(),
      fetchListingImagesCached: jest.fn(),
      prepareListingForModal: jest.fn(),
      warmListingImages: jest.fn(),
      uploadFilesForListing: jest.fn(),
      uploadOneMessageImage: jest.fn(),
      listingImageCache: {},
      listingImageInFlight: {},
      useFilePreviews: jest.fn(),
      filesToDataUrls: jest.fn(),
      fileToDataUrl: jest.fn(),
      AI_IMAGE_LIMIT: 3
    };

    const mediaComponents = {
      Lightbox: jest.fn(),
      ImageWithSkeleton: jest.fn(),
      ResponsiveImage: jest.fn()
    };

    const profilePictureUploadComponents = {
      ProfilePictureUploadModal: jest.fn()
    };

    const listingComponents = {
      MultiFilePicker: jest.fn(),
      InfoHelpModal: jest.fn(),
      AutoListHelpModal: jest.fn(),
      AiDescriptionHelpModal: jest.fn(),
      ListingForm: jest.fn(),
      MassListModal: jest.fn(),
      ReportSellerModal: jest.fn(),
      ListingModal: jest.fn(),
      ListingCard: jest.fn(),
      ListingGalleryModal: jest.fn(),
      SellerProfile: jest.fn()
    };

    const listingFormsFeature = {
      SmartImage: jest.fn(),
      ListingFormModal: jest.fn(),
      CompactListingForm: jest.fn()
    };

    const features = {
      auth: {
        createAuthFeature: jest.fn(() => ({
          AuthProvider: jest.fn(),
          useAuth: jest.fn(() => ({ user: null, setUser: jest.fn(), pushMeta: {} })),
          AuthModal: jest.fn()
        }))
      },
      uploads: {
        createUploadsFeature: jest.fn(() => uploads)
      },
      messageCenter: {
        createMessageCenterFeature: jest.fn(() => ({
          useMessageCenter: jest.fn()
        }))
      },
      messages: {
        createMessagesFeature: jest.fn(() => ({
          MessagesPanel: jest.fn(),
          useMessageActions: jest.fn()
        }))
      },
      admin: {
        createAdminFeature: jest.fn(() => ({
          AdminDashboard: jest.fn(),
          useAdminListingActions: jest.fn()
        }))
      },
      listingQueue: {
        createListingQueueFeature: jest.fn(() => ({
          useListingQueue: jest.fn(() => 'listingQueueHook')
        }))
      },
      listings: {
        createListingsFeature: jest.fn(() => ({
          useListingsFeature: jest.fn(),
          CityAutocomplete: jest.fn(),
          useListingModal: jest.fn()
        }))
      },
      notifications: {
        createNotificationsFeature: jest.fn(() => ({
          useMessageNotifications: jest.fn()
        }))
      },
      preferences: {
        createPreferencesFeature: jest.fn(() => ({
          useAppPreferences: jest.fn()
        }))
      },
      push: {
        createPushFeature: jest.fn(() => ({
          usePushNotifications: jest.fn()
        }))
      },
      ads: {
        createAdsFeature: jest.fn(() => ({
          useAds: jest.fn()
        }))
      },
      appView: {
        createAppViewFeature: jest.fn(() => ({
          useAppView: jest.fn(() => ({
            tab: 'browse',
            setTab: jest.fn(),
            banner: null,
            showLockedBanner: jest.fn(),
            dismissBanner: jest.fn(),
            viewingSeller: null,
            setViewingSeller: jest.fn(),
            authModal: null,
            setAuthModal: jest.fn(),
            handleTabChange: jest.fn(),
            openAuthModal: jest.fn(),
            isMobile: false
          }))
        }))
      },
      profile: {
        createProfileFeature: jest.fn(() => ({
          ProfilePanel: jest.fn()
        }))
      },
      nearby: {
        createNearbyFeature: jest.fn(() => ({
          NearbyPanel: jest.fn()
        }))
      },
      listingForms: {
        createListingFormsFeature: jest.fn(() => listingFormsFeature)
      }
    };

    const contexts = {
      listingQueue: {
        createListingQueueContext: jest.fn(() => ({
          ListingQueueProvider: jest.fn(),
          useListingQueueState: jest.fn(() => 'queueState'),
          ListingQueueToast: jest.fn()
        }))
      },
      listings: {
        createListingsContext: jest.fn(() => ({
          ListingsProvider: jest.fn(),
          useListings: jest.fn(() => 'listingsHook')
        }))
      },
      notifications: {
        createNotificationsContext: jest.fn(() => ({
          NotificationsProvider: jest.fn(),
          useNotifications: jest.fn(() => 'notificationsHook')
        }))
      }
    };

    const components = {
      media: {
        createMediaComponents: jest.fn(() => mediaComponents)
      },
      ads: {
        createAdsComponents: jest.fn(() => ({ AdTile: jest.fn() }))
      },
      grid: {
        createGridComponents: jest.fn(() => ({ ListingsGrid: jest.fn() }))
      },
      layout: {
        createLayoutComponents: jest.fn(() => ({
          Header: jest.fn(),
          GlobalLoader: jest.fn()
        }))
      },
      listings: {
        createListingComponents: jest.fn(() => listingComponents)
      },
      profilePictureUpload: {
        createProfilePictureUploadComponents: jest.fn(() => profilePictureUploadComponents)
      }
    };

    const locationHelpers = { fetchCoordsAndReverse: jest.fn(() => 'coords') };

    const bootstrap = {
      createAppNav: jest.fn(() => appNav),
      createLocationHelpers: jest.fn(() => locationHelpers)
    };

    const bundles = {
      bootstrap,
      helpers: {
        createHelpers: jest.fn(() => helpers)
      },
      components,
      features,
      contexts,
      app: {
        createAppShell: jest.fn(() => ({ Root: jest.fn() }))
      },
      legacy: {},
      hooks: {}
    };

    bundles.__stubs = {
      uploads,
      listingFormsFeature,
      locationHelpers,
      listingComponents,
      mediaComponents,
      profilePictureUploadComponents
    };

    return bundles;
  }

  function createAppNav() {
    return {
      incLoad: jest.fn(),
      decLoad: jest.fn(),
      setUser: jest.fn(),
      setTab: jest.fn(),
      notifyLocked: jest.fn()
    };
  }

  function createDependencies() {
    const helpers = stubHelpers();
    const appNav = createAppNav();
    const appBundles = createAppBundles(helpers, appNav);
    const core = createCore();
    const reactDOM = createReactDOM();

    return {
      React: {},
      ReactDOM: reactDOM.instance,
      core,
      appBundles,
      __mocks: {
        helpers,
        appNav,
        reactDOM
      }
    };
  }

  test('wires bundles into the app shell and exposes runtime utilities', () => {
    const helpers = stubHelpers();
    const appNav = createAppNav();
    const appBundles = createAppBundles(helpers, appNav);
    const core = createCore();
    const reactDOM = createReactDOM();

    const browserApp = createBrowserApp({
      React: {},
      ReactDOM: reactDOM.instance,
      core,
      appBundles
    });

    expect(appBundles.bootstrap.createAppNav).toHaveBeenCalledTimes(1);
    expect(appBundles.helpers.createHelpers).toHaveBeenCalledWith({ React: {} });
    expect(core.createApiClient).toHaveBeenCalledTimes(1);

    const appShellArgs = appBundles.app.createAppShell.mock.calls[0][0];
    expect(appShellArgs.api).toBe(core.api);
    expect(appShellArgs.AppNav).toBe(appNav);
    expect(appShellArgs.helpers.H).toBe(helpers.H);
    expect(appShellArgs.components.grid.ListingsGrid).toBeDefined();
    expect(appBundles.legacy.SmartImage).toBe(appBundles.__stubs.listingFormsFeature.SmartImage);

    const listingsFeature = appBundles.features.listings.createListingsFeature.mock.results[0].value;
    expect(appShellArgs.features.listings.useListingsFeature).toBe(listingsFeature.useListingsFeature);
    expect(appShellArgs.features.listings.CityAutocomplete).toBe(listingsFeature.CityAutocomplete);
    expect(appShellArgs.features.listings.useListingModal).toBe(listingsFeature.useListingModal);

    const messageCenterFeature = appBundles.features.messageCenter.createMessageCenterFeature.mock.results[0].value;
    expect(appShellArgs.features.messageCenter.useMessageCenter).toBe(messageCenterFeature.useMessageCenter);

    const messagesFeature = appBundles.features.messages.createMessagesFeature.mock.results[0].value;
    expect(appShellArgs.features.messages.MessagesPanel).toBe(messagesFeature.MessagesPanel);
    expect(appShellArgs.features.messages.useMessageActions).toBe(messagesFeature.useMessageActions);

    const adminFeature = appBundles.features.admin.createAdminFeature.mock.results[0].value;
    expect(appShellArgs.features.admin.AdminDashboard).toBe(adminFeature.AdminDashboard);
    expect(appShellArgs.features.admin.useAdminListingActions).toBe(adminFeature.useAdminListingActions);

    const profileFeature = appBundles.features.profile.createProfileFeature.mock.results[0].value;
    expect(appShellArgs.features.profile.ProfilePanel).toBe(profileFeature.ProfilePanel);

    const profilePictureUpload = appBundles.components.profilePictureUpload.createProfilePictureUploadComponents.mock.results[0].value;
    expect(appBundles.features.profile.createProfileFeature).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.objectContaining({
        ProfilePictureUploadModal: profilePictureUpload.ProfilePictureUploadModal
      })
    }));

    const nearbyFeature = appBundles.features.nearby.createNearbyFeature.mock.results[0].value;
    expect(appShellArgs.features.nearby.NearbyPanel).toBe(nearbyFeature.NearbyPanel);

    const listingFormsFeature = appBundles.features.listingForms.createListingFormsFeature.mock.results[0].value;
    expect(appShellArgs.features.listingForms.ListingFormModal).toBe(listingFormsFeature.ListingFormModal);

    const preferencesFeature = appBundles.features.preferences.createPreferencesFeature.mock.results[0].value;
    expect(appShellArgs.features.preferences.useAppPreferences).toBe(preferencesFeature.useAppPreferences);

    const pushFeature = appBundles.features.push.createPushFeature.mock.results[0].value;
    expect(appShellArgs.features.push.usePushNotifications).toBe(pushFeature.usePushNotifications);

    const adsFeature = appBundles.features.ads.createAdsFeature.mock.results[0].value;
    expect(appShellArgs.features.ads.useAds).toBe(adsFeature.useAds);

    const appViewFeature = appBundles.features.appView.createAppViewFeature.mock.results[0].value;
    expect(appShellArgs.features.appView.useAppView).toBe(appViewFeature.useAppView);

    const authFeature = appBundles.features.auth.createAuthFeature.mock.results[0].value;
    expect(appShellArgs.features.auth.AuthProvider).toBe(authFeature.AuthProvider);
    expect(appShellArgs.features.auth.useAuth).toBe(authFeature.useAuth);
    expect(appShellArgs.features.auth.AuthModal).toBe(authFeature.AuthModal);

    appShellArgs.utilities.price();
    expect(core.formatCurrency).toHaveBeenCalledWith(0);
    appShellArgs.utilities.fmtDistance(15);
    expect(core.formatDistance).toHaveBeenCalledWith(15);

    const apiOptions = core.createApiClient.mock.calls[0][0];
    apiOptions.onRequestStart();
    expect(appNav.incLoad).toHaveBeenCalledTimes(1);
    apiOptions.onRequestEnd();
    expect(appNav.decLoad).toHaveBeenCalledTimes(1);
    apiOptions.onUnauthorized();
    expect(appNav.setUser).toHaveBeenCalledWith(null);
    expect(appNav.setTab).toHaveBeenCalledWith('browse');
    apiOptions.onAccountLocked();
    expect(appNav.notifyLocked).toHaveBeenCalledTimes(1);

    const fetchMock = jest.fn().mockReturnValue('fetch-result');
    global.fetch = fetchMock;

    const fetchResult = apiOptions.fetchImpl('/api/test', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledWith('/api/test', { method: 'POST' });
    expect(fetchResult).toBe('fetch-result');

    delete global.fetch;

    expect(appBundles.hooks.useListings()).toBe('listingsHook');
    expect(appBundles.hooks.useNotifications()).toBe('notificationsHook');
    expect(appBundles.hooks.useListingQueue()).toBe('listingQueueHook');
    expect(appBundles.hooks.useListingQueueState()).toBe('queueState');

    const listingQueueContext = appBundles.contexts.listingQueue.createListingQueueContext.mock.results[0].value;
    expect(appShellArgs.contexts.listingQueue.ListingQueueProvider).toBe(listingQueueContext.ListingQueueProvider);
    expect(appShellArgs.contexts.listingQueue.ListingQueueToast).toBe(listingQueueContext.ListingQueueToast);
    expect(appShellArgs.contexts.listingQueue.useListingQueueState).toBe(listingQueueContext.useListingQueueState);

    const listingsContext = appBundles.contexts.listings.createListingsContext.mock.results[0].value;
    expect(appShellArgs.contexts.listings.ListingsProvider).toBe(listingsContext.ListingsProvider);

    const notificationsContext = appBundles.contexts.notifications.createNotificationsContext.mock.results[0].value;
    expect(appShellArgs.contexts.notifications.NotificationsProvider).toBe(notificationsContext.NotificationsProvider);

    const layoutComponents = appBundles.components.layout.createLayoutComponents.mock.results[0].value;
    expect(appShellArgs.components.layout.Header).toBe(layoutComponents.Header);
    expect(appShellArgs.components.layout.GlobalLoader).toBe(layoutComponents.GlobalLoader);

    const gridComponents = appBundles.components.grid.createGridComponents.mock.results[0].value;
    expect(appShellArgs.components.grid.ListingsGrid).toBe(gridComponents.ListingsGrid);

    const listingComponents = appBundles.__stubs.listingComponents;
    expect(appShellArgs.components.listing.MassListModal).toBe(listingComponents.MassListModal);
    expect(appShellArgs.components.listing.ListingModal).toBe(listingComponents.ListingModal);
    expect(appShellArgs.components.listing.SellerProfile).toBe(listingComponents.SellerProfile);

    expect(appShellArgs.uploads.prepareListingForModal).toBe(appBundles.__stubs.uploads.prepareListingForModal);
    expect(appShellArgs.uploads.warmListingImages).toBe(appBundles.__stubs.uploads.warmListingImages);

    expect(browserApp.AppNav).toBe(appNav);
    expect(browserApp.api).toBe(core.api);
    expect(browserApp.helpers.H).toBe(helpers.H);
    expect(browserApp.uploads.uploadFileDraft).toBe(appBundles.__stubs.uploads.uploadFileDraft);
    browserApp.utilities.haversineMeters(1, 2, 3, 4);
    expect(core.haversineMeters).toHaveBeenCalledWith(1, 2, 3, 4);
    expect(browserApp.utilities.price(7)).toBe('currency:7');
    expect(browserApp.utilities.fmtDistance(3)).toBe('distance:3');
    expect(browserApp.uploads.uploadFilesForListing).toBe(appBundles.__stubs.uploads.uploadFilesForListing);
    expect(browserApp.uploads.useFilePreviews).toBe(appBundles.__stubs.uploads.useFilePreviews);
    expect(browserApp.uploads.AI_IMAGE_LIMIT).toBe(appBundles.__stubs.uploads.AI_IMAGE_LIMIT);
    expect(browserApp.helpers.seenKey()).toBe('seen');
    expect(browserApp.helpers.urlToDataUrl).toBe(helpers.urlToDataUrl);
    expect(browserApp.helpers.arrayBufferToBase64Url).toBe(helpers.arrayBufferToBase64Url);
    expect(browserApp.helpers.createConcurrencyLimiter).toBe(helpers.createConcurrencyLimiter);
    expect(browserApp.helpers.getUserCoordsOnce).toBe(helpers.getUserCoordsOnce);
    expect(browserApp.helpers.interleaveByColumns).toBe(helpers.interleaveByColumns);
    expect(browserApp.helpers.useColumnCount).toBe(helpers.useColumnCount);
    expect(browserApp.helpers.useElementWidth).toBe(helpers.useElementWidth);
    expect(browserApp.helpers.useWindowScrollY).toBe(helpers.useWindowScrollY);
    expect(browserApp.helpers.useBodyScrollLock).toBe(helpers.useBodyScrollLock);
    expect(browserApp.helpers.pageTop).toBe(helpers.pageTop);
    expect(browserApp.helpers.normalizeListingsResponse).toBe(helpers.normalizeListingsResponse);
    expect(browserApp.helpers.useVirtualMasonry).toBe(helpers.useVirtualMasonry);
  });

  test('provides shared helpers and formatting to listing bundles', () => {
    const dependencies = createDependencies();
    const { appBundles, core } = dependencies;

    createBrowserApp(dependencies);

    const listingComponentArgs = appBundles.components.listings.createListingComponents.mock.calls[0][0];
    expect(listingComponentArgs.uploads.uploadFileDraft).toBe(appBundles.__stubs.uploads.uploadFileDraft);
    expect(listingComponentArgs.helpers.fetchCoordsAndReverse).toBe(appBundles.__stubs.locationHelpers.fetchCoordsAndReverse);

    listingComponentArgs.formatting.price(5);
    expect(core.formatCurrency).toHaveBeenCalledWith(5);
    listingComponentArgs.formatting.fmtDistance(12);
    expect(core.formatDistance).toHaveBeenCalledWith(12);
    listingComponentArgs.helpers.haversineMeters(1, 2, 3, 4);
    expect(core.haversineMeters).toHaveBeenCalledWith(1, 2, 3, 4);

    const listingFormsArgs = appBundles.features.listingForms.createListingFormsFeature.mock.calls[0][0];
    expect(listingFormsArgs.helpers.fetchCoordsAndReverse).toBe(appBundles.__stubs.locationHelpers.fetchCoordsAndReverse);
    expect(listingFormsArgs.uploads.uploadFileDraft).toBe(appBundles.__stubs.uploads.uploadFileDraft);
    expect(listingFormsArgs.components.ListingForm).toBe(appBundles.__stubs.listingComponents.ListingForm);
    expect(listingFormsArgs.components.ImageWithSkeleton).toBe(appBundles.__stubs.mediaComponents.ImageWithSkeleton);

    listingFormsArgs.formatting.price(9);
    expect(core.formatCurrency).toHaveBeenCalledWith(9);
  });

  test('passes shared modules into feature factories', () => {
    const dependencies = createDependencies();
    const { appBundles, core, __mocks } = dependencies;

    createBrowserApp(dependencies);

    const listingsArgs = appBundles.features.listings.createListingsFeature.mock.calls[0][0];
    expect(listingsArgs.api).toBe(core.api);
    expect(listingsArgs.helpers.normalizeListingsResponse).toBe(__mocks.helpers.normalizeListingsResponse);
    expect(listingsArgs.helpers.selectPrimaryListingImage).toBe(appBundles.__stubs.uploads.selectPrimaryListingImage);
    expect(listingsArgs.helpers.pageSize).toBe(75);
    expect(listingsArgs.uploads.prepareListingForModal).toBe(appBundles.__stubs.uploads.prepareListingForModal);

    const pushArgs = appBundles.features.push.createPushFeature.mock.calls[0][0];
    expect(pushArgs.api).toBe(core.api);
    pushArgs.helpers.serializePushSubscription('sub');
    expect(__mocks.helpers.serializePushSubscription).toHaveBeenCalledWith('sub');
    pushArgs.helpers.base64UrlToUint8Array('abc');
    expect(__mocks.helpers.base64UrlToUint8Array).toHaveBeenCalledWith('abc');

    const messageCenterArgs = appBundles.features.messageCenter.createMessageCenterFeature.mock.calls[0][0];
    messageCenterArgs.helpers.loadSeen();
    expect(__mocks.helpers.loadSeen).toHaveBeenCalledTimes(1);
    messageCenterArgs.helpers.saveSeen();
    expect(__mocks.helpers.saveSeen).toHaveBeenCalledTimes(1);
    const notificationsResult = appBundles.features.notifications.createNotificationsFeature.mock.results[0].value;
    expect(messageCenterArgs.notifications.useMessageNotifications).toBe(notificationsResult.useMessageNotifications);

    const messagesArgs = appBundles.features.messages.createMessagesFeature.mock.calls[0][0];
    messagesArgs.uploads.uploadOneMessageImage();
    expect(appBundles.__stubs.uploads.uploadOneMessageImage).toHaveBeenCalledTimes(1);
    expect(messagesArgs.helpers.loadSeen).toBe(__mocks.helpers.loadSeen);
    expect(messagesArgs.components.Lightbox).toBe(appBundles.__stubs.mediaComponents.Lightbox);

    const authArgs = appBundles.features.auth.createAuthFeature.mock.calls[0][0];
    expect(authArgs.api).toBe(core.api);
    expect(authArgs.ReactDOM).toBe(dependencies.ReactDOM);
  });

  test('mount renders using ReactDOM.createRoot with the app shell Root component', () => {
    const helpers = stubHelpers();
    const appNav = createAppNav();
    const appBundles = createAppBundles(helpers, appNav);
    const core = createCore();
    const reactDOM = createReactDOM();
    const rootComponent = jest.fn();

    appBundles.app.createAppShell.mockReturnValue({ Root: rootComponent });

    const browserApp = createBrowserApp({
      React: {},
      ReactDOM: reactDOM.instance,
      core,
      appBundles
    });

    const mountTarget = { id: 'target' };
    browserApp.mount(mountTarget);

    expect(reactDOM.instance.createRoot).toHaveBeenCalledWith(mountTarget);
    expect(helpers.H).toHaveBeenCalledWith(rootComponent);
    expect(reactDOM.root.render).toHaveBeenCalledWith('element');
  });

  test('mount falls back to ReactDOM.render when createRoot is unavailable', () => {
    const dependencies = createDependencies();
    const { helpers, reactDOM } = dependencies.__mocks;
    const rootComponent = jest.fn();

    delete reactDOM.instance.createRoot;
    reactDOM.instance.render = jest.fn();
    dependencies.appBundles.app.createAppShell.mockReturnValue({ Root: rootComponent });

    const browserApp = createBrowserApp(dependencies);

    const mountTarget = { id: 'target' };
    const mountResult = browserApp.mount(mountTarget);

    expect(reactDOM.instance.render).toHaveBeenCalledWith('element', mountTarget);
    expect(helpers.H).toHaveBeenCalledWith(rootComponent);
    expect(mountResult).toBeNull();
  });

  test('mount throws when no target element can be resolved', () => {
    const dependencies = createDependencies();
    const browserApp = createBrowserApp(dependencies);

    expect(() => browserApp.mount()).toThrow('Root element not found.');
  });

  test('throws helpful errors when critical bundles fail to load', () => {
    const dependencies = createDependencies();

    expect(() => createBrowserApp({
      ...dependencies,
      React: null
    })).toThrow('React bundle failed to load.');

    expect(() => createBrowserApp({
      ...dependencies,
      ReactDOM: null
    })).toThrow('ReactDOM bundle failed to load.');

    expect(() => createBrowserApp({
      ...dependencies,
      core: { ...dependencies.core, createApiClient: undefined }
    })).toThrow('ListIt core bundle failed to load.');

    expect(() => createBrowserApp({
      ...dependencies,
      appBundles: {
        ...dependencies.appBundles,
        bootstrap: { ...dependencies.appBundles.bootstrap, createAppNav: null }
      }
    })).toThrow('App nav bundle failed to load.');

    expect(() => createBrowserApp({
      ...dependencies,
      appBundles: {
        ...dependencies.appBundles,
        helpers: { ...dependencies.appBundles.helpers, createHelpers: null }
      }
    })).toThrow('Helpers bundle failed to load.');
  });

  describe('throws helpful errors when downstream bundles fail to load', () => {
    const scenarios = [
      {
        name: 'location helpers bundle',
        mutate: (deps) => {
          deps.appBundles.bootstrap.createLocationHelpers = null;
        },
        message: 'Location helpers bundle failed to load.'
      },
      {
        name: 'auth feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.auth.createAuthFeature = null;
        },
        message: 'Auth feature bundle failed to load.'
      },
      {
        name: 'uploads feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.uploads.createUploadsFeature = null;
        },
        message: 'Uploads feature bundle failed to load.'
      },
      {
        name: 'media components bundle',
        mutate: (deps) => {
          deps.appBundles.components.media.createMediaComponents = null;
        },
        message: 'Media components bundle failed to load.'
      },
      {
        name: 'ads components bundle',
        mutate: (deps) => {
          deps.appBundles.components.ads.createAdsComponents = null;
        },
        message: 'Ads components bundle failed to load.'
      },
      {
        name: 'grid components bundle',
        mutate: (deps) => {
          deps.appBundles.components.grid.createGridComponents = null;
        },
        message: 'Grid components bundle failed to load.'
      },
      {
        name: 'layout components bundle',
        mutate: (deps) => {
          deps.appBundles.components.layout.createLayoutComponents = null;
        },
        message: 'Layout components bundle failed to load.'
      },
      {
        name: 'app view feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.appView.createAppViewFeature = null;
        },
        message: 'App view feature bundle failed to load.'
      },
      {
        name: 'listings feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.listings.createListingsFeature = null;
        },
        message: 'Listings feature bundle failed to load.'
      },
      {
        name: 'notifications feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.notifications.createNotificationsFeature = null;
        },
        message: 'Notifications feature bundle failed to load.'
      },
      {
        name: 'preferences feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.preferences.createPreferencesFeature = null;
        },
        message: 'Preferences feature bundle failed to load.'
      },
      {
        name: 'push feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.push.createPushFeature = null;
        },
        message: 'Push feature bundle failed to load.'
      },
      {
        name: 'ads feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.ads.createAdsFeature = null;
        },
        message: 'Ads feature bundle failed to load.'
      },
      {
        name: 'message center feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.messageCenter.createMessageCenterFeature = null;
        },
        message: 'Message center feature bundle failed to load.'
      },
      {
        name: 'messages feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.messages.createMessagesFeature = null;
        },
        message: 'Messages feature bundle failed to load.'
      },
      {
        name: 'admin feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.admin.createAdminFeature = null;
        },
        message: 'Admin feature bundle failed to load.'
      },
      {
        name: 'listing queue feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.listingQueue.createListingQueueFeature = null;
        },
        message: 'Listing queue feature bundle failed to load.'
      },
      {
        name: 'listing queue context bundle',
        mutate: (deps) => {
          deps.appBundles.contexts.listingQueue.createListingQueueContext = null;
        },
        message: 'Listing queue context bundle failed to load.'
      },
      {
        name: 'listings context bundle',
        mutate: (deps) => {
          deps.appBundles.contexts.listings.createListingsContext = null;
        },
        message: 'Listings context bundle failed to load.'
      },
      {
        name: 'notifications context bundle',
        mutate: (deps) => {
          deps.appBundles.contexts.notifications.createNotificationsContext = null;
        },
        message: 'Notifications context bundle failed to load.'
      },
      {
        name: 'listing components bundle',
        mutate: (deps) => {
          deps.appBundles.components.listings.createListingComponents = null;
        },
        message: 'Listing components bundle failed to load.'
      },
      {
        name: 'listing forms feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.listingForms.createListingFormsFeature = null;
        },
        message: 'Listing forms feature bundle failed to load.'
      },
      {
        name: 'profile picture upload components bundle',
        mutate: (deps) => {
          deps.appBundles.components.profilePictureUpload.createProfilePictureUploadComponents = null;
        },
        message: 'Profile picture upload components bundle failed to load.'
      },
      {
        name: 'profile feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.profile.createProfileFeature = null;
        },
        message: 'Profile feature bundle failed to load.'
      },
      {
        name: 'nearby feature bundle',
        mutate: (deps) => {
          deps.appBundles.features.nearby.createNearbyFeature = null;
        },
        message: 'Nearby feature bundle failed to load.'
      },
      {
        name: 'app shell bundle',
        mutate: (deps) => {
          deps.appBundles.app.createAppShell = null;
        },
        message: 'App shell bundle failed to load.'
      }
    ];

    scenarios.forEach(({ name, mutate, message }) => {
      test(`throws when ${name}`, () => {
        const dependencies = createDependencies();
        mutate(dependencies);
        expect(() => createBrowserApp(dependencies)).toThrow(message);
      });
    });
  });
});

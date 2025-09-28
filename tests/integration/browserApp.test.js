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
      }
    };

    const bootstrap = {
      createAppNav: jest.fn(() => appNav),
      createLocationHelpers: jest.fn(() => ({ fetchCoordsAndReverse: jest.fn() }))
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
      listingFormsFeature
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

    expect(appBundles.hooks.useListings()).toBe('listingsHook');
    expect(appBundles.hooks.useNotifications()).toBe('notificationsHook');
    expect(appBundles.hooks.useListingQueue()).toBe('listingQueueHook');
    expect(appBundles.hooks.useListingQueueState()).toBe('queueState');

    expect(browserApp.AppNav).toBe(appNav);
    expect(browserApp.api).toBe(core.api);
    expect(browserApp.helpers.H).toBe(helpers.H);
    expect(browserApp.uploads.uploadFileDraft).toBe(appBundles.__stubs.uploads.uploadFileDraft);
    browserApp.utilities.haversineMeters(1, 2, 3, 4);
    expect(core.haversineMeters).toHaveBeenCalledWith(1, 2, 3, 4);
    expect(browserApp.utilities.price(7)).toBe('currency:7');
    expect(browserApp.utilities.fmtDistance(3)).toBe('distance:3');
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
});

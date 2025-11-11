(() => {
  function createBrowserApp({ React, ReactDOM, core, appBundles } = {}) {
    const runtimeReact = React || (typeof window !== 'undefined' ? window.React : null);
    const runtimeReactDOM = ReactDOM || (typeof window !== 'undefined' ? window.ReactDOM : null);
    const runtimeCore = core || (typeof window !== 'undefined' ? window.ListItCore : null) || {};
    const bundles = appBundles || (typeof window !== 'undefined' ? window.ListItApp : null) || {};

    if (!runtimeReact) {
      throw new Error('React bundle failed to load.');
    }

    if (!runtimeReactDOM) {
      throw new Error('ReactDOM bundle failed to load.');
    }

    const {
      createApiClient,
      formatCurrency,
      formatDistance,
      haversineMeters: coreHaversineMeters
    } = runtimeCore;

    if (typeof createApiClient !== 'function') {
      throw new Error('ListIt core bundle failed to load.');
    }

    const price = (n) => formatCurrency(n ?? 0);
    const fmtDistance = (m) => formatDistance(m);
    const haversineMeters = (...args) => coreHaversineMeters(...args);
    const PAGE_SIZE = 75;

    const appNavFactory = bundles?.bootstrap?.createAppNav;
    if (typeof appNavFactory !== 'function') {
      throw new Error('App nav bundle failed to load.');
    }
    const AppNav = appNavFactory();

    const helpersFactory = bundles?.helpers?.createHelpers;
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
    } = helpersFactory({ React: runtimeReact });

    const resolveApiBaseUrl = () => {
      if (typeof window === 'undefined') return '';

      const possibleGlobals = [
        window.ListItNativeApiBaseUrl,
        window.LISTIT_NATIVE_API_BASE_URL,
        window.LISTIT_API_BASE_URL
      ];
      for (const value of possibleGlobals) {
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }

      const meta = typeof document !== 'undefined'
        ? document.querySelector('meta[name="listit-api-base"]')
        : null;
      const metaContent = meta?.getAttribute('content')?.trim();
      if (metaContent) return metaContent;

      try {
        const stored = window.localStorage?.getItem?.('listit.nativeApiBaseUrl');
        if (typeof stored === 'string' && stored.trim()) {
          return stored.trim();
        }
      } catch (_) {
        // Access to localStorage can fail in some environments (Safari private mode, etc.)
      }

      return '';
    };

    const api = createApiClient({
      baseUrl: resolveApiBaseUrl(),
      onRequestStart: () => AppNav.incLoad(),
      onRequestEnd: () => AppNav.decLoad(),
      onUnauthorized: () => {
        AppNav.setUser(null);
        AppNav.setTab('browse');
      },
      onAccountLocked: () => AppNav.notifyLocked(),
      fetchImpl: (input, init) => fetch(input, init)
    });

    const locationHelpersFactory = bundles?.bootstrap?.createLocationHelpers;
    if (typeof locationHelpersFactory !== 'function') {
      throw new Error('Location helpers bundle failed to load.');
    }
    const { fetchCoordsAndReverse } = locationHelpersFactory({ api });

    const authFeatureFactory = bundles?.features?.auth?.createAuthFeature;
    if (typeof authFeatureFactory !== 'function') {
      throw new Error('Auth feature bundle failed to load.');
    }
    const { AuthProvider, useAuth, AuthModal } = authFeatureFactory({ api, ReactDOM: runtimeReactDOM });

    const uploadsFeatureFactory = bundles?.features?.uploads?.createUploadsFeature;
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
    } = uploadsFeatureFactory({ api, React: runtimeReact });

    const mediaComponentsFactory = bundles?.components?.media?.createMediaComponents;
    if (typeof mediaComponentsFactory !== 'function') {
      throw new Error('Media components bundle failed to load.');
    }
    const { Lightbox, ImageWithSkeleton, ResponsiveImage } = mediaComponentsFactory({ React: runtimeReact, ReactDOM: runtimeReactDOM });

    const adsComponentsFactory = bundles?.components?.ads?.createAdsComponents;
    if (typeof adsComponentsFactory !== 'function') {
      throw new Error('Ads components bundle failed to load.');
    }
    const { AdTile } = adsComponentsFactory({
      React: runtimeReact,
      components: { ImageWithSkeleton }
    });

    const gridComponentsFactory = bundles?.components?.grid?.createGridComponents;
    if (typeof gridComponentsFactory !== 'function') {
      throw new Error('Grid components bundle failed to load.');
    }
    const { ListingsGrid } = gridComponentsFactory({
      React: runtimeReact,
      components: { ImageWithSkeleton, AdTile },
      helpers: {
        useVirtualMasonry
      }
    });

    const layoutComponentsFactory = bundles?.components?.layout?.createLayoutComponents;
    if (typeof layoutComponentsFactory !== 'function') {
      throw new Error('Layout components bundle failed to load.');
    }
    const { Header, GlobalLoader } = layoutComponentsFactory({ React: runtimeReact });

    const appViewFeatureFactory = bundles?.features?.appView?.createAppViewFeature;
    if (typeof appViewFeatureFactory !== 'function') {
      throw new Error('App view feature bundle failed to load.');
    }
    const { useAppView } = appViewFeatureFactory({
      React: runtimeReact,
      helpers: { isMobileDevice }
    });

    const listingsFeatureFactory = bundles?.features?.listings?.createListingsFeature;
    if (typeof listingsFeatureFactory !== 'function') {
      throw new Error('Listings feature bundle failed to load.');
    }
    const { useListingsFeature, CityAutocomplete, useListingModal } = listingsFeatureFactory({
      React: runtimeReact,
      api,
      helpers: {
        normalizeListingsResponse,
        asArray,
        selectPrimaryListingImage,
        pageSize: PAGE_SIZE
      },
      uploads: {
        prepareListingForModal,
        warmListingImages
      }
    });

    const notificationsFeatureFactory = bundles?.features?.notifications?.createNotificationsFeature;
    if (typeof notificationsFeatureFactory !== 'function') {
      throw new Error('Notifications feature bundle failed to load.');
    }
    const { useMessageNotifications } = notificationsFeatureFactory({ React: runtimeReact });

    const preferencesFeatureFactory = bundles?.features?.preferences?.createPreferencesFeature;
    if (typeof preferencesFeatureFactory !== 'function') {
      throw new Error('Preferences feature bundle failed to load.');
    }
    const { useAppPreferences } = preferencesFeatureFactory({ React: runtimeReact });

    const pushFeatureFactory = bundles?.features?.push?.createPushFeature;
    if (typeof pushFeatureFactory !== 'function') {
      throw new Error('Push feature bundle failed to load.');
    }
    const { usePushNotifications } = pushFeatureFactory({
      React: runtimeReact,
      api,
      helpers: { serializePushSubscription, base64UrlToUint8Array }
    });

    const adsFeatureFactory = bundles?.features?.ads?.createAdsFeature;
    if (typeof adsFeatureFactory !== 'function') {
      throw new Error('Ads feature bundle failed to load.');
    }
    const { useAds } = adsFeatureFactory({ React: runtimeReact, api });

    const messageCenterFeatureFactory = bundles?.features?.messageCenter?.createMessageCenterFeature;
    if (typeof messageCenterFeatureFactory !== 'function') {
      throw new Error('Message center feature bundle failed to load.');
    }
    const { useMessageCenter } = messageCenterFeatureFactory({
      React: runtimeReact,
      api,
      helpers: { loadSeen, saveSeen },
      notifications: { useMessageNotifications }
    });

    const messagesFeatureFactory = bundles?.features?.messages?.createMessagesFeature;
    if (typeof messagesFeatureFactory !== 'function') {
      throw new Error('Messages feature bundle failed to load.');
    }
    const { MessagesPanel, useMessageActions } = messagesFeatureFactory({
      React: runtimeReact,
      ReactDOM: runtimeReactDOM,
      api,
      uploads: {
        uploadOneMessageImage,
        useFilePreviews
      },
      helpers: {
        loadSeen,
        saveSeen
      },
      components: {
        Lightbox,
        ImageWithSkeleton
      }
    });

    const adminFeatureFactory = bundles?.features?.admin?.createAdminFeature;
    if (typeof adminFeatureFactory !== 'function') {
      throw new Error('Admin feature bundle failed to load.');
    }
    const { AdminDashboard, useAdminListingActions } = adminFeatureFactory({
      React: runtimeReact,
      ReactDOM: runtimeReactDOM,
      api,
      components: {
        AdTile
      }
    });

    const listingQueueFeatureFactory = bundles?.features?.listingQueue?.createListingQueueFeature;
    if (typeof listingQueueFeatureFactory !== 'function') {
      throw new Error('Listing queue feature bundle failed to load.');
    }
    const { useListingQueue } = listingQueueFeatureFactory({ React: runtimeReact });

    const listingQueueContextFactory = bundles?.contexts?.listingQueue?.createListingQueueContext;
    if (typeof listingQueueContextFactory !== 'function') {
      throw new Error('Listing queue context bundle failed to load.');
    }
    const { ListingQueueProvider, useListingQueueState, ListingQueueToast } = listingQueueContextFactory({
      React: runtimeReact,
      useListingQueue
    });

    const listingsContextFactory = bundles?.contexts?.listings?.createListingsContext;
    if (typeof listingsContextFactory !== 'function') {
      throw new Error('Listings context bundle failed to load.');
    }
    const { ListingsProvider, useListings } = listingsContextFactory({ React: runtimeReact });

    const notificationsContextFactory = bundles?.contexts?.notifications?.createNotificationsContext;
    if (typeof notificationsContextFactory !== 'function') {
      throw new Error('Notifications context bundle failed to load.');
    }
    const { NotificationsProvider, useNotifications } = notificationsContextFactory({ React: runtimeReact });

    bundles.hooks = bundles.hooks || {};
    bundles.hooks.useListings = useListings;
    bundles.hooks.useNotifications = useNotifications;
    bundles.hooks.useListingQueue = useListingQueue;
    bundles.hooks.useListingQueueState = useListingQueueState;

    const listingComponentsFactory = bundles?.components?.listings?.createListingComponents;
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
      ListingGalleryModal,
      SellerProfile
    } = listingComponentsFactory({
      React: runtimeReact,
      ReactDOM: runtimeReactDOM,
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
        haversineMeters,
        asArray,
        selectPrimaryListingImage
      },
      components: {
        ImageWithSkeleton,
        ResponsiveImage,
        ListingsGrid
      },
      formatting: {
        price,
        fmtDistance
      }
    });

    const listingFormsFeatureFactory = bundles?.features?.listingForms?.createListingFormsFeature;
    if (typeof listingFormsFeatureFactory !== 'function') {
      throw new Error('Listing forms feature bundle failed to load.');
    }
    const {
      SmartImage,
      ListingFormModal,
      CompactListingForm
    } = listingFormsFeatureFactory({
      React: runtimeReact,
      ReactDOM: runtimeReactDOM,
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

    bundles.legacy = bundles.legacy || {};
    bundles.legacy.SmartImage = SmartImage;

    const profilePictureUploadFactory = bundles?.components?.profilePictureUpload?.createProfilePictureUploadComponents;
    if (typeof profilePictureUploadFactory !== 'function') {
      throw new Error('Profile picture upload components bundle failed to load.');
    }
    const { ProfilePictureUploadModal } = profilePictureUploadFactory({
      React: runtimeReact,
      ReactDOM: runtimeReactDOM,
      api,
      uploads: {
        uploadOneMessageImage
      }
    });

    const profileFeatureFactory = bundles?.features?.profile?.createProfileFeature;
    if (typeof profileFeatureFactory !== 'function') {
      throw new Error('Profile feature bundle failed to load.');
    }
    console.log('ListingsGrid before passing to profile:', ListingsGrid, typeof ListingsGrid);
    const { ProfilePanel } = profileFeatureFactory({
      React: runtimeReact,
      ReactDOM: runtimeReactDOM,
      api,
      helpers: { asArray },
      components: {
        ImageWithSkeleton,
        InfoHelpModal,
        AutoListHelpModal,
        AiDescriptionHelpModal,
        ListingModal,
        ProfilePictureUploadModal,
        ListingsGrid
      },
      appNav: AppNav
    });

    const nearbyFeatureFactory = bundles?.features?.nearby?.createNearbyFeature;
    if (typeof nearbyFeatureFactory !== 'function') {
      throw new Error('Nearby feature bundle failed to load.');
    }
    const { NearbyPanel } = nearbyFeatureFactory({
      React: runtimeReact,
      api,
      helpers: {
        asArray,
        selectPrimaryListingImage,
        fetchCoordsAndReverse
      },
      components: {
        ListingCard,
        ListingsGrid
      }
    });

    const appShellFactory = bundles?.app?.createAppShell;
    if (typeof appShellFactory !== 'function') {
      throw new Error('App shell bundle failed to load.');
    }

    const { Root } = appShellFactory({
      React: runtimeReact,
      ReactDOM: runtimeReactDOM,
      api,
      helpers: {
        H,
        isMobileDevice,
        loadSeen,
        saveSeen,
        serializePushSubscription,
        base64UrlToUint8Array,
        asArray
      },
      AppNav,
      features: {
        auth: { AuthProvider, useAuth, AuthModal },
        listings: { useListingsFeature, CityAutocomplete, useListingModal },
        messageCenter: { useMessageCenter },
        messages: { MessagesPanel, useMessageActions },
        admin: { AdminDashboard, useAdminListingActions },
        profile: { ProfilePanel },
        nearby: { NearbyPanel },
        listingForms: { ListingFormModal },
        preferences: { useAppPreferences },
        push: { usePushNotifications },
        ads: { useAds },
        appView: { useAppView }
      },
      contexts: {
        listings: { ListingsProvider },
        notifications: { NotificationsProvider },
        listingQueue: { ListingQueueProvider, ListingQueueToast, useListingQueueState }
      },
      components: {
        layout: { Header, GlobalLoader },
        grid: { ListingsGrid },
        listing: {
          MassListModal,
          ListingModal,
          SellerProfile
        }
      },
      uploads: {
        prepareListingForModal,
        warmListingImages
      },
      utilities: { price, fmtDistance }
    });

    function mount(target) {
      const rootEl = target || (typeof document !== 'undefined' ? document.getElementById('root') : null);
      if (!rootEl) {
        throw new Error('Root element not found.');
      }

      if (runtimeReactDOM.createRoot) {
        const root = runtimeReactDOM.createRoot(rootEl);
        root.render(H(Root));
        return root;
      }

      runtimeReactDOM.render(H(Root), rootEl);
      return null;
    }

    return {
      mount,
      AppNav,
      api,
      helpers: {
        H,
        isMobileDevice,
        loadSeen,
        saveSeen,
        serializePushSubscription,
        base64UrlToUint8Array,
        asArray,
        seenKey,
        urlToDataUrl,
        arrayBufferToBase64Url,
        createConcurrencyLimiter,
        getUserCoordsOnce,
        interleaveByColumns,
        useColumnCount,
        useElementWidth,
        useWindowScrollY,
        useBodyScrollLock,
        pageTop,
        normalizeListingsResponse,
        useVirtualMasonry
      },
      uploads: {
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
      },
      utilities: {
        price,
        fmtDistance,
        haversineMeters
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.ListItApp = window.ListItApp || {};
    window.ListItApp.bootstrap = window.ListItApp.bootstrap || {};
    window.ListItApp.bootstrap.createBrowserApp = createBrowserApp;
  }
})();

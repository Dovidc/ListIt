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
  const ReactDOM = window.ReactDOM;

  if (!ReactDOM) {
    throw new Error('ReactDOM bundle failed to load.');
  }

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
  const { ListingsGrid } = gridComponentsFactory({
    React,
    components: { ImageWithSkeleton, AdTile },
    helpers: {
      useVirtualMasonry
    }
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

  const preferencesFeatureFactory = window.ListItApp?.features?.preferences?.createPreferencesFeature;
  if (typeof preferencesFeatureFactory !== 'function') {
    throw new Error('Preferences feature bundle failed to load.');
  }
  const { useAppPreferences } = preferencesFeatureFactory({ React });

  const pushFeatureFactory = window.ListItApp?.features?.push?.createPushFeature;
  if (typeof pushFeatureFactory !== 'function') {
    throw new Error('Push feature bundle failed to load.');
  }
  const { usePushNotifications } = pushFeatureFactory({
    React,
    api,
    helpers: { serializePushSubscription, base64UrlToUint8Array }
  });

  const adsFeatureFactory = window.ListItApp?.features?.ads?.createAdsFeature;
  if (typeof adsFeatureFactory !== 'function') {
    throw new Error('Ads feature bundle failed to load.');
  }
  const { useAds } = adsFeatureFactory({ React, api });

  const messageCenterFeatureFactory = window.ListItApp?.features?.messageCenter?.createMessageCenterFeature;
  if (typeof messageCenterFeatureFactory !== 'function') {
    throw new Error('Message center feature bundle failed to load.');
  }
  const { useMessageCenter } = messageCenterFeatureFactory({
    React,
    api,
    helpers: { loadSeen, saveSeen },
    notifications: { useMessageNotifications }
  });

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
    ListingGalleryModal,
    SellerProfile
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
      haversineMeters,
      asArray
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

  const nearbyFeatureFactory = window.ListItApp?.features?.nearby?.createNearbyFeature;
  if (typeof nearbyFeatureFactory !== 'function') {
    throw new Error('Nearby feature bundle failed to load.');
  }
  const { NearbyPanel } = nearbyFeatureFactory({
    React,
    api,
    helpers: {
      asArray,
      selectPrimaryListingImage,
      fetchCoordsAndReverse,
      interleaveByColumns,
      useColumnCount
    },
    components: {
      ListingCard
    }
  });

  const appShellFactory = window.ListItApp?.app?.createAppShell;
  if (typeof appShellFactory !== 'function') {
    throw new Error('App shell bundle failed to load.');
  }

  const { Root } = appShellFactory({
    React,
    ReactDOM,
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
      listings: { useListingsFeature, CityAutocomplete },
      messageCenter: { useMessageCenter },
      messages: { MessagesPanel },
      admin: { AdminDashboard },
      profile: { ProfilePanel },
      nearby: { NearbyPanel },
      listingForms: { ListingFormModal },
      preferences: { useAppPreferences },
      push: { usePushNotifications },
      ads: { useAds }
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

  // Robust mount (React 18+ or older)
  const rootEl = document.getElementById('root');
  if (ReactDOM.createRoot) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(H(Root));
  } else {
    ReactDOM.render(H(Root), rootEl);
  }

})();
















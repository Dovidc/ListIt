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

  function AdTile({ ad, cols = 4, className, preview = false }) {
    if (!ad) return null;
    const spanCols = Math.max(1, Math.min(3, Number(cols) || 1));
    const hasImage = !!ad.image_url;
    const href = ad.target_url || '#';
    const ctaLabel = (ad.cta_label || 'Visit site').slice(0, 40);
    const style = { gridColumn: `span ${spanCols}` };
    if (ad.background) style.background = ad.background;
    if (preview) style.cursor = 'default';
    const cardClass = `card ad-card${hasImage ? '' : ' no-art'}${className ? ` ${className}` : ''}`;
    const anchorProps = {
      className: cardClass,
      href,
      target: '_blank',
      rel: 'noopener noreferrer',
      style
    };
    if (preview) {
      anchorProps.onClick = (e) => e.preventDefault();
      anchorProps.target = '_self';
      anchorProps.rel = 'noopener';
      anchorProps.tabIndex = -1;
    }
    return H('a', anchorProps,
      H('div', { className: 'ad-card__content' },
        H('span', { className: 'ad-card__tag' }, 'Sponsored'),
        H('div', { className: 'ad-card__title' }, ad.title || 'Advertisement'),
        ad.subtitle && H('div', { className: 'ad-card__subtitle' }, ad.subtitle),
        H('div', { className: 'ad-card__ctaRow' },
          H('span', { className: 'ad-card__cta' }, ctaLabel),
          H('span', { className: 'ad-card__arrow' }, '>')
        )
      ),
      hasImage && H('div', { className: 'ad-card__art' },
        H(ImageWithSkeleton, {
          src: ad.image_url,
          alt: ad.title ? `${ad.title} artwork` : 'Advertisement art',
          loading: 'lazy',
          decoding: 'async'
        })
      )
    );
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

  const GridTile = React.memo(function GridTile({ item, onEnsureCover, onSelect }) {
    const ref = useRef(null);

    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      if (!item?.id) return;

      const observer = new IntersectionObserver((entries) => {
        if (!Array.isArray(entries)) return;
        const intersecting = entries.some((entry) => entry.isIntersecting);
        if (intersecting) {
          if (!item.__cover && typeof onEnsureCover === 'function') {
            onEnsureCover(item.id);
          }
          observer.disconnect();
        }
      }, { rootMargin: '800px 0px' });

      observer.observe(el);
      return () => observer.disconnect();
    }, [item?.id, item?.__cover, onEnsureCover]);

    const src = item?.__cover;

    return H('div', { ref, className: 'card', style: { padding: 0, overflow: 'hidden', borderRadius: 8 } },
      H('div', { style: { position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#f3f4f6' } },
        src && H(ImageWithSkeleton, {
          src,
          alt: item?.title || 'Item',
          loading: 'lazy',
          decoding: 'async',
          fetchPriority: 'low',
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' },
          disableSkeleton: true,
          onClick: (evt) => typeof onSelect === 'function' ? onSelect(evt, item, src) : undefined
        })
      )
    );
  });

  const AutoPostNearbyHelpModal = React.memo(function AutoPostNearbyHelpModal({ onClose }) {
    return H(InfoHelpModal, {
      onClose,
      title: 'Auto-post to Nearby',
      intro: 'When enabled, Auto-List will also publish your item to the Nearby feed.',
      bullets: [
        'Uses your latest saved location to set latitude and longitude.',
        'Marks the new listing as available to nearby shoppers.',
        'Requires Auto-List to be turned on and is best used from your phone.'
      ],
      footer: 'You can always edit the listing afterwards to adjust its location or disable Nearby.'
    });
  });

  const ProfilePanel = React.memo(function ProfilePanel({
    isMobile,
    user,
    items,
    onNewListing,
    onEdit,
    onDelete,
    onLogout,
    onAdminDelete,
    autoListEnabled,
    setAutoListEnabled,
    aiDescriptionEnabled,
    setAiDescriptionEnabled,
    autoPostNearbyEnabled,
    setAutoPostNearbyEnabled,
    onViewSeller,
    onToggleSold
  }) {
    const [showAutoHelp, setShowAutoHelp] = useState(false);
    const [showAiHelp, setShowAiHelp] = useState(false);
    const [showNearbyHelp, setShowNearbyHelp] = useState(false);

    const myListings = useMemo(() => {
      const arr = Array.isArray(items) ? items.slice() : [];
      const getTs = (item) => {
        if (!item || typeof item !== 'object') return 0;
        const candidates = [
          item.updated_at,
          item.updatedAt,
          item.created_at,
          item.createdAt,
          item.posted_at
        ];
        for (const value of candidates) {
          if (typeof value === 'number' && Number.isFinite(value)) return value;
          if (typeof value === 'string' && value) {
            const ts = Date.parse(value);
            if (!Number.isNaN(ts)) return ts;
          }
        }
        return 0;
      };
      arr.sort((a, b) => {
        const diff = getTs(b) - getTs(a);
        if (diff !== 0) return diff;
        const idA = Number.isFinite(Number(a?.id)) ? Number(a.id) : 0;
        const idB = Number.isFinite(Number(b?.id)) ? Number(b.id) : 0;
        return idB - idA;
      });
      return arr;
    }, [items]);

    const renderToggle = ({
      key,
      label,
      description,
      value,
      onChange,
      disabled,
      onHelp,
      helpLabel
    }) => {
      const inputId = `profile-toggle-${key}`;
      const handleHelpClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onHelp?.();
      };
      const handleChange = (event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onChange?.(!!event.target.checked);
      };
      return H('label', {
        key,
        className: 'toggle-card',
        htmlFor: inputId,
        'data-disabled': disabled ? 'true' : 'false',
        style: {
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          width: '100%'
        }
      },
      H('input', {
        id: inputId,
        type: 'checkbox',
        className: 'toggle-input',
        checked: !!value,
        onChange: handleChange,
        disabled
      }),
      H('span', {
        className: 'toggle-copy',
        style: { flex: 1 }
      },
        H('span', {
          style: {
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8
          }
        },
          label,
          onHelp && H('button', {
            type: 'button',
            onClick: handleHelpClick,
            className: 'btn',
            style: {
              width: 26,
              height: 26,
              padding: 0,
              borderRadius: 13,
              fontSize: 14,
              lineHeight: '24px'
            },
            title: helpLabel || 'Learn more'
          }, '?')
        ),
        description && H('span', {
          className: 'muted',
          style: { fontSize: 12 }
        }, description)
      ),
      H('span', {
        className: 'toggle-slider',
        'aria-hidden': 'true'
      }));
    };

    if (!user) {
      return H('section', {
        className: 'card',
        style: { padding: 24, display: 'grid', gap: 12 }
      },
      H('h2', { style: { margin: 0, fontSize: 20 } }, 'Profile'),
      H('p', { className: 'muted', style: { margin: 0 } }, 'Log in to manage your profile and listings.')
      );
    }

    const nearbyDisabled = !isMobile || !autoListEnabled;

    return H('div', {
      className: 'profile-panel',
      style: {
        display: 'grid',
        gap: 24,
        alignContent: 'start'
      }
    },
    H('section', {
      className: 'card',
      style: {
        padding: isMobile ? 16 : 24,
        display: 'grid',
        gap: 16
      }
    },
      H('div', {
        style: {
          display: 'grid',
          gap: 4
        }
      },
        H('h2', { style: { margin: 0, fontSize: 20 } }, 'Profile & settings'),
        user.username && H('div', { className: 'muted', style: { fontWeight: 600 } }, `@${user.username}`),
        user.email && H('div', { className: 'muted' }, user.email),
        user.paypal_email && H('div', { className: 'muted' }, `PayPal: ${user.paypal_email}`)
      ),
      H('div', {
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8
        }
      },
        H('button', {
          type: 'button',
          className: 'btn primary',
          onClick: () => onNewListing?.()
        }, 'New listing'),
        H('button', {
          type: 'button',
          className: 'btn',
          onClick: () => onLogout?.()
        }, 'Log out')
      ),
      H('div', {
        style: {
          display: 'grid',
          gap: 12
        }
      },
        renderToggle({
          key: 'auto',
          label: 'Auto-list new photos',
          description: 'Automatically create listings after you attach photos.',
          value: !!autoListEnabled,
          onChange: (next) => setAutoListEnabled?.(next),
          onHelp: () => setShowAutoHelp(true),
          helpLabel: 'About Auto-list'
        }),
        renderToggle({
          key: 'ai-desc',
          label: 'AI descriptions',
          description: 'Let AI draft descriptions for you when you upload photos.',
          value: !!aiDescriptionEnabled,
          onChange: (next) => setAiDescriptionEnabled?.(next),
          onHelp: () => setShowAiHelp(true),
          helpLabel: 'About AI descriptions'
        }),
        renderToggle({
          key: 'nearby',
          label: 'Also post to Nearby',
          description: nearbyDisabled
            ? 'Requires Auto-list and is available from mobile devices.'
            : 'Auto-listings will be shared to the Nearby feed with your location.',
          value: !!autoPostNearbyEnabled,
          onChange: (next) => setAutoPostNearbyEnabled?.(next),
          disabled: nearbyDisabled,
          onHelp: () => setShowNearbyHelp(true),
          helpLabel: 'About Nearby posting'
        })
      )
    ),
    H('section', {
      style: {
        display: 'grid',
        gap: 16
      }
    },
      H('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12
        }
      },
        H('h2', { style: { margin: 0, fontSize: 20 } }, 'Your listings'),
        H('span', { className: 'muted', style: { fontSize: 13 } }, `${myListings.length} total`)
      ),
      myListings.length === 0
        ? H('p', { className: 'muted', style: { margin: 0 } }, 'You have not created any listings yet.')
        : H('div', {
            style: {
              display: 'grid',
              gap: 16
            }
          },
          myListings.map((item, idx) => H(ListingCard, {
            key: item?.id ?? item?.slug ?? `listing-${idx}`,
            item,
            user,
            canEdit: true,
            onEdit,
            onDelete,
            onAdminDelete,
            onViewSeller,
            onToggleSold
          }))
        )
    ),
    showAutoHelp && H(AutoListHelpModal, { onClose: () => setShowAutoHelp(false) }),
    showAiHelp && H(AiDescriptionHelpModal, { onClose: () => setShowAiHelp(false) }),
    showNearbyHelp && H(AutoPostNearbyHelpModal, { onClose: () => setShowNearbyHelp(false) })
    );
  });

  // SmartImage v2.1 (kept; not used in main grid now)
  function SmartImage({
    src,
    alt = '',
    br = 8,
    onClick,
    dropFar = true,
    initialAR = 4 / 3,
    lockAR = true,
    fetchPriority = 'auto'
  }) {
    const wrapRef = React.useRef(null);
    const imgRef  = React.useRef(null);

    const [activeSrc, setActiveSrc] = React.useState('');
    const [ratio, setRatio]         = React.useState(initialAR);
    const [loaded, setLoaded]       = React.useState(false);

    React.useEffect(() => {
      const el = wrapRef.current; if (!el) return;
      let clearTo = null;

      const io = new IntersectionObserver((entries) => {
        const e = entries[0]; if (!e) return;

        if (e.isIntersecting) {
          setActiveSrc(src);
        } else if (dropFar) {
          const top = e.boundingClientRect.top;
          const bottom = e.boundingClientRect.bottom;
          const dist = top > 0 ? top : -bottom; // positive px from viewport
          if (dist > window.innerHeight * 3.5) {
            clearTimeout(clearTo);
            clearTo = setTimeout(() => setActiveSrc(''), 120);
          }
        }
      }, { root: null, rootMargin: '600px 0px' });

      io.observe(el);
      return () => { clearTimeout(clearTo); io.disconnect(); };
    }, [src, dropFar]);

    React.useEffect(() => {
      setLoaded(false);
    }, [activeSrc]);

    function onLoad(e) {
      setLoaded(true);
      if (lockAR) return;
      const w = e.currentTarget.naturalWidth || 0;
      const h = e.currentTarget.naturalHeight || 0;
      if (w && h) setRatio(w / h);
    }

    return H('div', {
      ref: wrapRef,
      style: {
        position: 'relative',
        width: '100%',
        aspectRatio: `${ratio} / 1`,
        borderRadius: br,
        overflow: 'hidden',
        background: '#f3f4f6'
      }
    },
      !loaded && activeSrc && H('div', {
        style: {
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(120deg, #f3f4f6 15%, #e5e7eb 35%, #f3f4f6 55%)',
          backgroundSize: '200% 200%',
          animation: 'img-shimmer 1s ease-in-out infinite'
        }
      }),
      activeSrc && H('img', {
        ref: imgRef,
        src: activeSrc,
        alt,
        loading: 'lazy',
        decoding: 'async',
        fetchpriority: fetchPriority,
        onLoad,
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          cursor: onClick ? 'pointer' : 'default',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 180ms ease'
        },
        onClick
      })
    );
  }

function ListingFormModal({ isOpen, draft, onClose, onSaved, autoListEnabled, aiDescriptionEnabled, autoPostNearbyEnabled, backgroundQueueEnabled, enqueueListingJob }) {
  if (!isOpen) return null;
  
  const isMobile = isMobileDevice();
  const [showTags, setShowTags] = useState(false);

  const modal = H('div', { 
    className: 'modal open', 
    onClick: (e) => { if (e.target.classList.contains('modal')) onClose(); }
  },
    H('div', { 
      className: 'modal-inner', 
      style: isMobile ? {
        // Mobile: Compact centered modal
        width: '90vw',
        maxWidth: '380px',
        maxHeight: '80vh',
        background: '#fff',
        borderRadius: 16,
        overflow: 'auto',
        margin: 'auto',
        position: 'relative'
      } : {
        // Desktop: unchanged
        width: 'min(680px, 92vw)',
        background: '#fff',
        borderRadius: 24,
        overflow: 'auto',
        maxHeight: '90vh',
        marginTop: '5vh',
        marginBottom: '5vh'
      }
    },
      H('button', { 
        className: 'close', 
        onClick: onClose,
        style: isMobile ? {
          position: 'absolute',
          top: '6px',
          right: '6px',
          zIndex: 10,
          width: '26px',
          height: '26px',
          padding: '0',
          fontSize: '16px',
          lineHeight: '24px',
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(255,255,255,0.9)',
          borderRadius: '13px'
        } : {}
      }, 'x'),
      
      H('div', { style: { padding: isMobile ? '10px' : '16px' } },
        H('div', { style: { 
          fontWeight: 800, 
          fontSize: isMobile ? 15 : 18, 
          marginBottom: isMobile ? 6 : 12
        } }, 
          draft ? 'Edit Listing' : 'New Listing'
        ),
        
        !isMobile && H('div', { className: 'muted', style: { marginBottom: 12 } }, 
          'Add photos and details for your listing. Only images are required - AI can suggest the rest.'
        ),
        
        isMobile ? H(CompactListingForm, {
          draft,
          onCancel: onClose,
          onSaved: () => { onSaved?.(); onClose(); },
          autoListEnabled,
          aiDescriptionEnabled,
          autoPostNearbyEnabled,
          backgroundQueueEnabled,
          enqueueListingJob,
          showTags,
          setShowTags
        }) : H(ListingForm, {
          draft,
          onCancel: onClose,
          onSaved: () => { onSaved?.(); onClose(); },
          autoListEnabled,
          aiDescriptionEnabled,
          autoPostNearbyEnabled,
          backgroundQueueEnabled,
          enqueueListingJob
        })
      )
    )
  );

  return ReactDOM.createPortal(modal, document.body);
}

// --- Compact Listing Form for Mobile ---
function CompactListingForm({ draft, onCancel, onSaved, autoListEnabled, aiDescriptionEnabled, autoPostNearbyEnabled, backgroundQueueEnabled, enqueueListingJob, showTags, setShowTags }) {
  const fileRef = useRef();
  const [files, setFiles] = useState([]);
  const [existingUrls, setExistingUrls] = useState([]);
  const [originalUrls, setOriginalUrls] = useState([]);
  const filePreviews = useFilePreviews(files);
  
  const [title, setTitle] = useState(draft?.title || '');
  const [description, setDescription] = useState(draft?.description || '');
  const [location, setLocation] = useState(draft?.location || '');
  const [priceVal, setPriceVal] = useState(draft?.price?.toString?.() || '');
  const [tags, setTags] = useState(() => {
    if (!draft?.tags) return '';
    if (Array.isArray(draft.tags)) return draft.tags.join(', ');
    return String(draft.tags);
  });
  
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const autoRunning = useRef(false);
  const [autoBusy, setAutoBusy] = useState(false);
  
  const hasFixedGps = !!draft?.lat;
  const [enableNearby, setEnableNearby] = useState(!!draft?.enable_nearby);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const [lat, setLat] = useState(draft?.lat ?? null);
  const [lon, setLon] = useState(draft?.lon ?? null);

  // File picker handler
  function pickFiles(e) {
    const MAX_MB = 20;
    const selected = Array.from(e.target.files || []);
    const next = [...files];
    for (const f of selected) {
      if (f.size > MAX_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_MB}MB`); continue; }
      if (!f.type.startsWith('image/')) { alert('Only images are allowed'); continue; }
      next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeFile(i) {
    const next = [...files];
    const [removed] = next.splice(i, 1);
    if (removed) clearDraftCacheForFile(removed);
    setFiles(next);
  }

  // Load current images
  useEffect(() => {
    (async () => {
      if (draft?.id) {
        try { 
          const arr = await api.getListingImages(draft.id); 
          setExistingUrls(arr || []);
          setOriginalUrls(arr || []);
        }
        catch { 
          setExistingUrls([]); 
          setOriginalUrls([]);
        }
      } else {
        setExistingUrls([]);
        setOriginalUrls([]);
      }
    })();
  }, [draft?.id]);

  async function runAI(){
    setAiErr('');
    setAiBusy(true);
    try {
      const sources = [];

      if (files.length) {
        for (const file of files) {
          if (sources.length >= AI_IMAGE_LIMIT) break;
          try {
            const upload = await uploadFileDraft(file);
            if (upload?.publicUrl) sources.push(upload.publicUrl);
          } catch (err) {
            console.error('AI draft upload failed:', err);
          }
        }
      }

      if (sources.length < AI_IMAGE_LIMIT && existingUrls.length) {
        for (const url of existingUrls) {
          if (sources.length >= AI_IMAGE_LIMIT) break;
          if (typeof url === 'string' && url.trim()) {
            sources.push(url);
          }
        }
      }

      if (!sources.length) {
        alert('No images available for AI analysis.');
        return;
      }

      const res = await api.aiAnalyze({
        images: sources.slice(0, AI_IMAGE_LIMIT),
        hint: `${title} ${description}`.trim()
      });

      if (res.title) setTitle(res.title);
      if (Array.isArray(res.tags)) setTags(res.tags.join(', '));
      if (typeof res.suggested_price === 'number' && !Number.isNaN(res.suggested_price)) {
        setPriceVal(String(res.suggested_price));
      }
      if (typeof res.description === 'string' && res.description.trim()) {
        if (aiDescriptionEnabled) {
          setDescription(res.description.trim().slice(0, 400));
        } else {
          setAiErr('Enable AI descriptions in your profile to apply AI-written descriptions.');
        }
      }
    } catch (e) { 
      setAiErr(e.message || 'AI failed'); 
    } finally { 
      setAiBusy(false); 
    }
  }

  async function useMyLocation() {
    setGeoErr('');
    if (!('geolocation' in navigator)) { setGeoErr('Geolocation not supported'); return; }
    setGeoBusy(true);
    try {
      const coords = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
          err => rej(err),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        )
      );
      const r = await api.reverseGeocode(coords.lat, coords.lon);
      setLocation(r?.display || `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
      setLat(r?.lat ?? coords.lat);
      setLon(r?.lon ?? coords.lon);
    } catch { setGeoErr('Could not get your location'); }
    finally { setGeoBusy(false); }
  }

  // Auto-list effect
  useEffect(() => {
    if (!autoListEnabled) return;
    if (draft) return;
    if (!files || files.length === 0) return;
    if (autoRunning.current) return;

    autoRunning.current = true;

    const runAutoListJob = async () => {
      const uploads = await Promise.all(files.map(uploadFileDraft));
      if (!uploads.length) throw new Error('No images to upload');

      let ai = {};
      let aiDescription = '';
      try {
        const aiSources = uploads.map((u) => u.publicUrl).filter(Boolean).slice(0, AI_IMAGE_LIMIT);
        if (aiSources.length) {
          ai = await api.aiAnalyze({ images: aiSources, hint: '' }, { silent:true }) || {};
        }
      } catch (_) {}

      const parsedPrice = Number(ai.suggested_price);
      const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

      const rawDescription = (typeof ai.description === 'string' ? ai.description.trim() : '');
      if (rawDescription && aiDescriptionEnabled) {
        aiDescription = rawDescription.slice(0, 400);
      }

      let enableNearbyAuto = 0, latAuto = null, lonAuto = null, locAuto = '';
      if (autoPostNearbyEnabled) {
        try {
          const c = await fetchCoordsAndReverse();
          enableNearbyAuto = 1;
          latAuto = c.lat; lonAuto = c.lon; locAuto = c.display;
        } catch (_) {
          enableNearbyAuto = 0;
        }
      }

      const payload = {
        title: (ai.title || 'Item for sale').toString().slice(0, 80),
        description: aiDescription || 'No description',
        location: locAuto || '',
        price: safePrice,
        tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
        enable_nearby: enableNearbyAuto,
        upload_tokens: uploads.map((u) => u.uploadToken)
      };
      if (enableNearbyAuto) { payload.lat = latAuto; payload.lon = lonAuto; }

      const created = await api.createListing(payload);
      if (!created?.id) throw new Error('Create failed');
    };

    if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
      enqueueListingJob(async () => {
        try {
          await runAutoListJob();
          onSaved?.();
        } catch (err) {
          console.error('Auto-list failed:', err);
          alert(`Auto-list failed: ${err?.message || err}`);
        } finally {
          autoRunning.current = false;
        }
      });
      onCancel?.();
      return;
    }

    setAutoBusy(true);
    (async () => {
      try {
        await runAutoListJob();
        onSaved?.();
      } catch (err) {
        console.error('Auto-list failed:', err);
        alert(`Auto-list failed: ${err?.message || err}`);
      } finally {
        setAutoBusy(false);
        autoRunning.current = false;
      }
    })();
  }, [autoListEnabled, autoPostNearbyEnabled, aiDescriptionEnabled, backgroundQueueEnabled, draft, enqueueListingJob, files, onCancel, onSaved]);

  async function submit(e){
    e.preventDefault();
    try {
      const totalImages = existingUrls.length + files.length;
      if (totalImages === 0) {
        alert('Please add at least one image.');
        return;
      }

      const parsedPrice = Number(priceVal);
      const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

      const basePayload = {
        title: String(title || '').trim(),
        description: String(description || 'No description').trim(),
        location: String(location || '').trim(),
        price: safePrice,
        tags: String(tags || '').trim(),
        enable_nearby: enableNearby ? 1 : 0,
      };

      if (enableNearby && !hasFixedGps) {
        basePayload.lat = lat;
        basePayload.lon = lon;
      }

      if (basePayload.enable_nearby && !hasFixedGps && (basePayload.lat == null || basePayload.lon == null)) {
        alert('Enable Nearby requires using your location.');
        return;
      }

      if (draft) {
        const payload = { ...basePayload };
        const deletedImages = originalUrls.filter(url => !existingUrls.includes(url));
        if (deletedImages.length > 0) {
          payload.deletedImages = deletedImages;
        }
        await api.updateListing(draft.id, payload);
        if (files.length) await uploadFilesForListing(draft.id, files);
        onSaved?.();
        return;
      }

      const filesSnapshot = files.slice();
      const runCreate = async () => {
        const payload = { ...basePayload };
        if (filesSnapshot.length) {
          const uploads = await Promise.all(filesSnapshot.map(uploadFileDraft));
          const tokens = uploads.map((u) => u.uploadToken).filter(Boolean);
          if (!tokens.length) {
            throw new Error('Image upload failed');
          }
          payload.upload_tokens = tokens;
        }

        const created = await api.createListing(payload);
        if (!created?.id) { throw new Error('Create failed'); }
      };

      if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
        enqueueListingJob(async () => {
          try {
            await runCreate();
            onSaved?.();
          } catch (err) {
            console.error('Create/save failed:', err);
            alert(`Create/save failed: ${err?.message || err}`);
          }
        });
        onCancel?.();
        return;
      }

      await runCreate();
      onSaved?.();
    } catch (err) {
      console.error('Create/save failed:', err);
      alert(`Create/save failed: ${err?.message || err}`);
    }
  }

  const isFree = !priceVal || !Number.isFinite(Number(priceVal)) || Number(priceVal) === 0;

  return H('form', { 
    onSubmit: submit, 
    className:'row', 
    style:{
      flexDirection:'column', 
      gap: 5,
      position:'relative'
    }
  },
    autoBusy && H('div', {
      style:{
        position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
        display:'grid', placeItems:'center', zIndex:5, borderRadius:12
      }
    }, H('div', null, H('div', {className:'spinner'}), H('div', {style:{marginTop:6, fontWeight:700}}, 'Auto-listing...'))),

    // Compact file picker
    H('div', null,
      H('input', { 
        type:'file', 
        accept:'image/*', 
        multiple:true, 
        ref:fileRef, 
        onChange: pickFiles,
        style: { fontSize: '13px' }
      }),
      filePreviews.length > 0 && H('div', { 
        className:'row', 
        style:{ gap:3, flexWrap:'wrap', marginTop:3 } 
      },
        ...filePreviews.map(({ url },i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H(ImageWithSkeleton, {
              src: url,
              style:{ width:44, height:44, objectFit:'cover', borderRadius:6, border:'1px solid #ddd' }
            }),
            H('button', {
              className:'btn danger',
              type:'button',
              style:{ position:'absolute', top:-2, right:-2, padding:'0px 3px', fontSize:9, lineHeight:'12px' }, 
              onClick:()=>removeFile(i) 
            }, 'x')
          )
        )
      )
    ),

    (existingUrls.length > 0) && H('div', null,
      H('div', { className:'muted', style:{ fontSize:11, marginBottom:2 } }, 'Current:'),
      H('div', { className:'row', style:{ gap:3, flexWrap:'wrap' } },
        ...existingUrls.map((src, i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H(ImageWithSkeleton, { src, style:{ width:44, height:44, objectFit:'cover', borderRadius:6, border:'1px solid #ddd' } }),
            H('button', {
              className:'btn danger',
              type:'button',
              style:{ position:'absolute', top:-2, right:-2, padding:'0px 3px', fontSize:9, lineHeight:'12px' }, 
              onClick:() => {
                const next = [...existingUrls];
                next.splice(i, 1);
                setExistingUrls(next);
              }
            }, 'x')
          )
        )
      )
    ),

    H('button', { 
      type:'button', 
      className:`btn ${aiBusy?'':'primary'}`, 
      disabled:aiBusy, 
      onClick:runAI,
      style: { width: '100%', padding: '8px', fontSize: '13px' }
    }, aiBusy ? 'Analyzing...' : 'Run AI analysis'),
    
    aiErr && H('span', { className:'muted', style:{ color:'#b91c1c', fontSize:11 } }, aiErr),

    H('input', { 
      value:title, 
      maxLength:80, 
      onChange:e=>setTitle(e.target.value), 
      placeholder:'Title (optional)',
      style: { fontSize: '13px', padding: '7px' }
    }),
    
    H('textarea', { 
      value:description, 
      maxLength:400, 
      rows: 2,
      onChange:e=>setDescription(e.target.value), 
      placeholder:'Description (optional)',
      style: { fontSize: '13px', padding: '7px', resize: 'none' }
    }),
    
    H('input', { 
      value:location, 
      maxLength:80, 
      onChange:e=>setLocation(e.target.value), 
      placeholder:'Location (optional)',
      style: { fontSize: '13px', padding: '7px' }
    }),
    
    H('button', { 
      type:'button', 
      className:'btn', 
      onClick:useMyLocation, 
      disabled:geoBusy, 
      style: { width: '100%', padding: '7px', fontSize: '13px' } 
    }, 
      geoBusy ? 'Locating...' : 'Use my location'
    ),
    geoErr && H('span', { className:'muted', style:{ color:'#b91c1c', fontSize:11 } }, geoErr),
    
    H('label', {
      className:'toggle-card',
      style:{ marginTop:4, gap:6, alignItems:'flex-start', fontSize:12, padding:'6px 8px' }
    },
      H('input', {
        type:'checkbox',
        className:'toggle-input',
        checked:enableNearby,
        onChange:e=>{
          const checked = e.target.checked;
          setEnableNearby(checked);
          if (checked && !hasFixedGps) useMyLocation();
        }
      }),
      H('span', { className:'toggle-slider', 'aria-hidden': true }),
      H('div', { className:'toggle-copy' },
        H('div', { style:{ fontWeight:700, fontSize:12 } }, 'Enable Nearby searches'),
        H('div', { className:'muted', style:{ fontSize:11 } }, 'Shows distance in feet/miles to buyers.')
      )
    ),
    
    H('div', { className:'row', style: { alignItems: 'center', gap: 6 } },
      H('input', {
        value:priceVal,
        inputMode:'decimal',
        onChange:e=>setPriceVal(e.target.value.replace(/[^0-9.]/g,'')),
        placeholder:'Price (empty = $0.00)',
        style: { fontSize: '13px', padding: '7px', flex: 1 }
      }),
      isFree && H('span', { style:{ fontSize:11, color:'#16a34a', fontWeight:700 } }, price(0))
    ),
    
    H('button', {
      type: 'button',
      onClick: () => setShowTags(!showTags),
      style: {
        width: '100%',
        padding: '6px',
        background: '#f9f9f9',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        textAlign: 'left',
        fontSize: 11,
        color: '#6b7280'
      }
    }, showTags ? 'v Hide search tags' : '> Show search tags (optional)'),
    
    showTags && H('input', { 
      placeholder:'e.g. car, suv, 4x4', 
      value:tags, 
      onChange:e=>setTags(e.target.value),
      style: { fontSize: '13px', padding: '7px' }
    }),

    H('div', { className:'row', style: { gap: 6, marginTop: 6 } },
      H('button', { 
        className:'btn primary', 
        type:'submit', 
        disabled:autoBusy, 
        style: { flex: 1, padding: '9px', fontSize: '13px', fontWeight: 600 } 
      }, 
        draft ? 'Save' : 'Create'
      ),
      H('button', { 
        className:'btn', 
        type:'button', 
        onClick:onCancel, 
        disabled:autoBusy, 
        style: { flex: 1, padding: '9px', fontSize: '13px' } 
      }, 
        'Cancel'
      )
    )
  );
}

// Then your existing ListingForm component stays the same...

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
















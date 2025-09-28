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
    MassListModal
  } = listingComponentsFactory({
    React,
    ReactDOM,
    api,
    uploads: {
      clearDraftCacheForFile,
      uploadFileDraft,
      uploadFilesForListing,
      useFilePreviews,
      AI_IMAGE_LIMIT
    },
    helpers: {
      isMobileDevice,
      createConcurrencyLimiter
    },
    components: {
      ImageWithSkeleton
    },
    formatting: {
      price
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

  const REPORT_REASON_OPTIONS = [
    { value: 'fraud', label: 'Fraud or scam' },
    { value: 'spam', label: 'Spam or advertising' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'harassment', label: 'Harassment or abusive behavior' },
    { value: 'other', label: 'Other' }
  ];

  function makeReportCaptcha() {
    return {
      a: 2 + Math.floor(Math.random() * 7),
      b: 2 + Math.floor(Math.random() * 7)
    };
  }

  function ReportSellerModal({ open, listing, onClose, onReported }) {
    const [selected, setSelected] = useState(() => new Set());
    const [details, setDetails] = useState('');
    const [captcha, setCaptcha] = useState(() => makeReportCaptcha());
    const [answer, setAnswer] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    useEffect(() => {
      if (!open) return;
      setSelected(new Set());
      setDetails('');
      setCaptcha(makeReportCaptcha());
      setAnswer('');
      setError('');
      setSubmitted(false);
    }, [open, listing?.id]);

    useEffect(() => {
      if (!open) return;
      const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const toggleReason = (value) => {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (submitting || submitted) return;
      setError('');
      const reasons = Array.from(selected);
      if (!reasons.length) {
        setError('Select at least one reason.');
        return;
      }
      if (reasons.includes('other') && !details.trim()) {
        setError('Please include details for "Other".');
        return;
      }
      const expected = captcha.a + captcha.b;
      if (Number(answer) !== expected) {
        setError('Captcha answer is incorrect.');
        setCaptcha(makeReportCaptcha());
        setAnswer('');
        return;
      }
      setSubmitting(true);
      try {
        await api.reportSeller({
          reported_user_id: listing?.user_id,
          listing_id: listing?.id,
          reasons,
          details: details.trim() || undefined,
          captcha: { a: captcha.a, b: captcha.b, answer: Number(answer) }
        });
        setSubmitted(true);
        onReported?.();
      } catch (err) {
        setError(err.message || 'Unable to submit report.');
        setCaptcha(makeReportCaptcha());
        setAnswer('');
      } finally {
        setSubmitting(false);
      }
    };

    if (!open) return null;

    const sellerName = listing?.owner_username ? `@${listing.owner_username}` : 'this seller';

    const modal = H('div', {
      className: 'modal open',
      onClick: (e) => { if (e.target.classList.contains('modal')) onClose?.(); }
    },
      H('div', { className: 'modal-inner', style: { maxWidth: '520px', padding: '24px', background: '#fff', color: '#111' } },
        H('button', { className: 'close', onClick: onClose, disabled: submitting && !submitted }, 'X'),
        H('h2', { style: { margin: '0 0 16px', fontSize: 24, fontWeight: 700 } }, `Report ${sellerName}`),
        submitted ?
          H('div', { className: 'muted', style: { marginBottom: 16 } }, 'Thank you. We will review this report shortly.') :
          H('form', { onSubmit: handleSubmit, style: { display: 'grid', gap: 12 } },
            H('div', { style: { fontWeight: 600 } }, 'Why are you reporting this seller?'),
            REPORT_REASON_OPTIONS.map(opt => H('label', {
              key: opt.value,
              style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }
            },
              H('input', {
                type: 'checkbox',
                checked: selected.has(opt.value),
                disabled: submitting,
                onChange: () => toggleReason(opt.value)
              }),
              opt.label
            )),
            H('textarea', {
              placeholder: 'Additional details (optional)',
              value: details,
              onChange: (e) => setDetails(e.target.value),
              disabled: submitting,
              rows: 3,
              style: { width: '100%', fontSize: 13, padding: 8 }
            }),
            H('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              H('span', null, `What is ${captcha.a} + ${captcha.b}?`),
              H('input', {
                type: 'number',
                value: answer,
                onChange: (e) => setAnswer(e.target.value),
                disabled: submitting,
                style: { width: 80 }
              })
            ),
            error && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, error),
            H('div', { className: 'row', style: { gap: 8, marginTop: 4 } },
              H('button', { className: 'btn primary', type: 'submit', disabled: submitting, style: { flex: 1 } }, submitting ? 'Submitting...' : 'Submit report'),
              H('button', { className: 'btn', type: 'button', onClick: onClose, disabled: submitting, style: { flex: 1 } }, 'Cancel')
            )
          ),
        submitted && H('div', { style: { marginTop: 16 } },
          H('button', { className: 'btn primary', onClick: onClose }, 'Close')
        )
      )
    );

    return ReactDOM.createPortal(modal, document.body);
  }


  function FlaggedDetailsModal({ open, detail, item, onClose }) {
    const isImage = (detail?.type || '').toLowerCase() === 'image';
    const target = typeof detail?.target === 'string' ? detail.target : '';
    const categories = useMemo(() => {
      if (!detail || !Array.isArray(detail.categories)) return [];
      return detail.categories.filter(Boolean);
    }, [detail]);
    const scores = detail && detail.category_scores && typeof detail.category_scores === 'object'
      ? detail.category_scores
      : null;

    useEffect(() => {
      if (!open) return;
      const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open || !detail) return null;

    const typeLabel = detail?.type ? detail.type.charAt(0).toUpperCase() + detail.type.slice(1) : 'Content';
    let flaggedAt = '';
    if (item?.flagged_at) {
      const dt = new Date(item.flagged_at);
      flaggedAt = Number.isFinite(dt.getTime()) ? dt.toLocaleString() : item.flagged_at;
    }

    const handleOuterClick = (event) => {
      if (event.target.classList?.contains('modal')) onClose?.();
    };

    const scoreEntries = scores ? Object.entries(scores).filter(([key, value]) => key && value != null) : [];

    return ReactDOM.createPortal(
      H('div', {
        className: 'modal open',
        onClick: handleOuterClick
      },
        H('div', {
          className: 'modal-inner',
          style: {
            maxWidth: isImage ? '720px' : '520px',
            width: '90%',
            padding: '24px',
            background: '#fff',
            color: '#111',
            display: 'grid',
            gap: 16
          }
        },
          H('button', { className: 'close', onClick: onClose }, '×'),
          H('div', { style: { display: 'grid', gap: 4 } },
            H('h3', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, 'Flagged content'),
            item?.username && H('div', { className: 'muted', style: { fontSize: 13 } }, `User: ${item.username}`),
            item?.listing_title && H('div', { className: 'muted', style: { fontSize: 13 } }, `Listing: ${item.listing_title}`),
            flaggedAt && H('div', { className: 'muted', style: { fontSize: 12 } }, `Flagged: ${flaggedAt}`),
            H('div', { className: 'muted', style: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 } }, typeLabel)
          ),
          categories.length ? H('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            categories.map((category) => H('span', {
              key: category,
              style: {
                padding: '4px 10px',
                borderRadius: 999,
                background: '#fee2e2',
                color: '#b91c1c',
                fontSize: 12,
                fontWeight: 600
              }
            }, category))
          ) : null,
          isImage
            ? (target
              ? H('div', {
                  style: {
                    display: 'grid',
                    gap: 8
                  }
                },
                  H('img', {
                    src: target,
                    alt: 'Flagged content preview',
                    style: {
                      maxWidth: '100%',
                      borderRadius: 12,
                      border: '1px solid #e5e7eb',
                      background: '#f8fafc'
                    }
                  }),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'Right-click or long-press to save this image if needed.')
                )
              : H('div', { className: 'muted', style: { fontSize: 13 } }, 'No image preview available.'))
            : H('div', {
                style: {
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  fontSize: 14,
                  lineHeight: 1.5,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid #e5e7eb',
                  background: '#f8fafc'
                }
              }, target ? target : 'No text was captured for this entry.'),
          scoreEntries.length ? H('div', { style: { display: 'grid', gap: 6 } },
            H('div', { style: { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#111' } }, 'Confidence scores'),
            H('div', { style: { display: 'grid', gap: 4 } },
              scoreEntries.map(([category, value]) => {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return null;
                return H('div', { key: category, className: 'muted', style: { fontSize: 12 } }, `${category}: ${(numeric * 100).toFixed(1)}%`);
              }).filter(Boolean)
            )
          ) : null
        )
      ),
      document.body
    );
  }



// --- Listing Gallery Modal ---
  function ListingGalleryModal({ open, images, index, onClose, onIndex, loading = false }) {
    useBodyScrollLock(open);

    const list = Array.isArray(images) ? images.filter(Boolean) : [];
    const len = list.length;
    const safeIndex = len ? Math.min(Math.max(Number(index) || 0, 0), len - 1) : 0;
    const canNavigate = len > 1 && typeof onIndex === 'function';
    const currentSrc = len ? list[safeIndex] : '';

    const [stageLoaded, setStageLoaded] = React.useState(false);

    React.useEffect(() => {
      if (!open) {
        setStageLoaded(false);
        return;
      }
      setStageLoaded(false);
    }, [open, currentSrc]);

    const handleStageSettled = React.useCallback(() => {
      setStageLoaded(true);
    }, []);

    React.useEffect(() => {
      if (!open) return;
      if (index !== safeIndex) {
        onIndex?.(safeIndex);
      }
    }, [open, safeIndex, index, onIndex]);

    React.useEffect(() => {
      if (!open) return;
      const handler = (evt) => {
        if (evt.key === 'Escape') {
          evt.preventDefault();
          onClose?.();
          return;
        }
        if (!canNavigate) return;
        if (evt.key === 'ArrowRight') {
          evt.preventDefault();
          onIndex?.((safeIndex + 1) % len);
        } else if (evt.key === 'ArrowLeft') {
          evt.preventDefault();
          onIndex?.((safeIndex - 1 + len) % len);
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [open, canNavigate, safeIndex, len, onClose, onIndex]);

    if (!open) return null;

    const stageOverlay = (!stageLoaded && currentSrc) || (loading && !len)
      ? H('div', { className: 'lightbox-stage-skeleton', 'aria-hidden': true })
      : null;

    const imageContent = len
      ? H('div', { className: 'lightbox-main' },
          H(ResponsiveImage, {
            src: currentSrc,
            alt: `Listing image ${safeIndex + 1}`,
            widths: [480, 720, 1080, 1440],
            sizes: '100vw',
            loading: 'eager',
            fetchPriority: 'high',
            className: 'lightbox-img',
            onLoad: handleStageSettled,
            onError: handleStageSettled,
            style: { opacity: stageLoaded ? 1 : 0, transition: 'opacity 180ms ease' }
          })
        )
      : H('div', { className: 'lightbox-empty' }, loading ? null : 'No images available');

    const thumbsContent = len
      ? H('div', { className: 'lightbox-thumbs' },
          ...list.map((img, i) => H(ImageWithSkeleton, {
            key: String(i),
            src: img,
            alt: `Thumbnail ${i + 1}`,
            className: i === safeIndex ? 'active' : '',
            onClick: () => onIndex?.(i)
          }))
        )
      : (loading
          ? H('div', { className: 'lightbox-thumbs loading', 'aria-hidden': true },
              ...Array.from({ length: 4 }).map((_, i) =>
                H('div', { key: `s-${i}`, className: 'lightbox-thumb-skeleton' })
              )
            )
          : H('div', { className: 'lightbox-thumbs empty' },
              H('span', null, 'No photos yet')
            )
        );

    const overlayContent = H('div', { className: 'lightbox-content', role: 'dialog', 'aria-modal': true },
      H('button', { className: 'lightbox-close', onClick: onClose, 'aria-label': 'Close gallery' }, 'X'),
      H('div', { className: 'lightbox-body' },
        H('div', { className: 'lightbox-stage' },
          stageOverlay,
          canNavigate ? H('button', { className: 'lightbox-arrow left', onClick: () => onIndex?.((safeIndex - 1 + len) % len), 'aria-label': 'Previous image' }, '<') : null,
          imageContent,
          canNavigate ? H('button', { className: 'lightbox-arrow right', onClick: () => onIndex?.((safeIndex + 1) % len), 'aria-label': 'Next image' }, '>') : null
        ),
        H('div', { className: 'lightbox-footer' }, thumbsContent)
      )
    );

    return ReactDOM.createPortal(
      H('div', {
        className: 'lightbox-overlay',
        onClick: (evt) => { if (evt.target === evt.currentTarget) onClose?.(); }
      }, overlayContent),
      document.body
    );
  }

// --- Listing Modal (portal shell) ---
  function ListingModal({ open, item, onClose, cardProps = {} }) {
    useBodyScrollLock(open);

    React.useEffect(() => {
      if (!open) return;
      const handler = (evt) => {
        if (evt.key === 'Escape') {
          evt.preventDefault();
          onClose?.();
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open || !item) return null;

    return ReactDOM.createPortal(
      H('div', {
        className: 'modal open',
        onClick: (evt) => {
          if (evt.target === evt.currentTarget || evt.target.classList.contains('modal')) {
            onClose?.();
          }
        }
      },
        H('div', {
          className: 'modal-inner listing-modal',
          onClick: (evt) => evt.stopPropagation()
        },
          H('button', { className: 'close', onClick: onClose }, 'x'),
          H(ListingCard, { item, viewContext: 'modal', ...cardProps })
        )
      ),
      document.body
    );
  }

// --- Listing Card ---
function ListingCard({
  item,
  canEdit,
  onEdit,
  onDelete,
  user,
  onMessage,
  onAdminDelete,
  onViewSeller,
  onToggleSold,
  showDistance = false,
  viewContext = 'grid'
}) {

  const fallbackImages = useMemo(() => collectListingImages(item, item?.__cover), [item, item?.__cover]);
  const baseGallery = useMemo(() => {
    const fallbackList = Array.isArray(fallbackImages) ? fallbackImages : [];
    const inlineList = Array.isArray(item?.images) ? item.images : [];
    return dedupeImageUrls([...fallbackList, ...inlineList]);
  }, [item?.images, fallbackImages]);

  const [galleryImages, setGalleryImages] = useState(baseGallery);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [derivedMeters, setDerivedMeters] = React.useState(null);

  const isModalView = viewContext === 'modal';

  const normalizedBaseGallery = useMemo(() => {
    if (Array.isArray(baseGallery) && baseGallery.length) return baseGallery;
    const fallbackCover = item.image_data || item.__cover || item.thumb_url || '';
    return fallbackCover ? [fallbackCover] : [];
  }, [baseGallery, item.image_data, item.__cover, item.thumb_url]);

  const sameList = useCallback((a, b) => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }, []);

  const baseImageCount = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery.length : 0;

  const prefetchImages = useCallback(() => {
    if (!item?.id) return;
    if (listingImageInFlight.has(item.id)) return;
    const minCount = baseImageCount + 1;
    const cached = listingImageCache.get(item.id);
    if (Array.isArray(cached) && cached.length >= minCount) return;
    fetchListingImagesCached(item.id, { minCount });
  }, [item?.id, baseImageCount]);

  React.useEffect(() => {
    const baseList = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery : [];
    setGalleryImages(prev => {
      const prevList = Array.isArray(prev) ? prev : [];
      return sameList(prevList, baseList) ? prevList : baseList;
    });
  }, [normalizedBaseGallery, sameList]);

  React.useEffect(() => {
    if (!item?.id) return;
    const cached = listingImageCache.get(item.id);
    if (Array.isArray(cached) && cached.length) {
      const cachedList = dedupeImageUrls(cached);
      setGalleryImages(prev => sameList(prev, cachedList) ? prev : cachedList);
    }
  }, [item?.id, sameList]);

  const handleOpenGallery = useCallback(async (start = 0) => {
    const baseList = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery : [];
    setGalleryIndex(Number.isFinite(start) ? start : 0);
    setGalleryImages(prev => {
      const prevList = Array.isArray(prev) ? prev : [];
      return sameList(prevList, baseList) ? prevList : baseList;
    });
    setGalleryOpen(true);
    prefetchImages();

    if (!item?.id) return;

    setGalleryLoading(true);
    try {
      const fetched = await fetchListingImagesCached(item.id, { minCount: baseList.length + 1 });
      const merged = dedupeImageUrls([...baseList, ...(Array.isArray(fetched) ? fetched : [])]);
      if (merged.length) {
        listingImageCache.set(item.id, merged);
      }
      setGalleryImages(prev => sameList(prev, merged) ? prev : merged);
    } catch (err) {
      console.warn('Failed to load gallery images for listing', item?.id, err);
    } finally {
      setGalleryLoading(false);
    }
  }, [item?.id, normalizedBaseGallery, sameList, prefetchImages]);

  React.useEffect(() => {
    if (!item?.id) return;
    if (!Array.isArray(galleryImages) || !galleryImages.length) return;
    const baseLen = baseImageCount;
    if (galleryImages.length <= baseLen) return;
    listingImageCache.set(item.id, galleryImages);
  }, [galleryImages, item?.id, baseImageCount]);

  React.useEffect(() => {
    if (!galleryOpen) return;
    const len = Array.isArray(galleryImages) ? galleryImages.length : 0;
    if (!len) {
      if (galleryIndex !== 0) setGalleryIndex(0);
      return;
    }
    if (galleryIndex >= len) {
      setGalleryIndex(len - 1);
    } else if (galleryIndex < 0) {
      setGalleryIndex(0);
    }
  }, [galleryOpen, galleryImages, galleryIndex]);

  React.useEffect(() => {
    if (!showDistance) {
      setDerivedMeters(null);
      return;
    }
    let fromServer = null;
    if (Number.isFinite(item?.distance_m)) fromServer = item.distance_m;
    if (Number.isFinite(item?.distance_ft)) fromServer = item.distance_ft / 3.28084;
    if (fromServer != null) {
      setDerivedMeters(fromServer);
      return;
    }

    if (Number.isFinite(item?.lat) && Number.isFinite(item?.lon)) {
      getUserCoordsOnce().then(coords => {
        if (!coords) return;
        const m = haversineMeters(coords.lat, coords.lon, item.lat, item.lon);
        setDerivedMeters(m);
      });
    } else {
      setDerivedMeters(null);
    }
  }, [showDistance, item?.id, item?.lat, item?.lon]);

  const isFree = Number(item?.price ?? 0) === 0;
  const [soldBusy, setSoldBusy] = useState(false);
  const galleryCount = Array.isArray(galleryImages) ? galleryImages.length : 0;
  const coverSrc = item.image_data || (galleryCount ? galleryImages[0] : '');

  const controls = [];
  if (!user || user.id !== item.user_id) {
    controls.push(H('button', {
      key: 'm',
      className: 'btn primary',
      onClick: () => onMessage?.(item)
    }, 'Message seller'));
  }
  if (user && user.id !== item.user_id) {
    controls.push(H('button', {
      key: 'report',
      className: 'btn',
      onClick: () => setShowReport(true)
    }, 'Report seller'));
  }
  if (canEdit) {
    controls.push(H('button', {
      key: 'e',
      className: 'btn',
      onClick: () => onEdit?.(item)
    }, 'Edit'));
    if (onToggleSold) {
      const isSold = !!item?.sold;
      controls.push(H('button', {
        key: 'sold-toggle',
        className: 'btn',
        onClick: async () => {
          if (soldBusy) return;
          try {
            setSoldBusy(true);
            await onToggleSold(item, !isSold);
          } finally {
            setSoldBusy(false);
          }
        },
        disabled: soldBusy,
        style: {
          background: isSold ? '#D1FAE5' : '#059669',
          color: isSold ? '#047857' : '#fff',
          borderColor: '#059669'
        }
      }, isSold ? 'Mark as unsold' : 'Mark as sold'));
    }
    controls.push(H('button', {
      key: 'd',
      className: 'btn danger',
      onClick: () => onDelete?.(item)
    }, 'Remove Listing'));
  }
  if (user?.is_admin) {
    controls.push(H('button', {
      key: 'admin-del',
      className: 'btn danger',
      onClick: async () => {
        if (!confirm('Admin: Delete this listing?')) return;
        await api.adminDeleteListing(item.id);
        onAdminDelete?.(item.id);
      }
    }, 'Admin Delete'));
  }

  const renderSellerInfo = () => {
    if (!item.owner_username) {
      return '--';
    }

    if (onViewSeller) {
      return H('button', {
        onClick: () => onViewSeller(item.user_id, item.owner_username),
        style: {
          background: 'none',
          border: 'none',
          color: '#111',
          fontWeight: 600,
          textDecoration: 'underline',
          cursor: 'pointer',
          padding: 0,
          font: 'inherit'
        }
      }, `@${item.owner_username}`);
    }

    return H('span', null, `@${item.owner_username}`);
  };

  const openGalleryFromEvent = useCallback((evt) => {
    if (evt && typeof evt.preventDefault === 'function') {
      evt.preventDefault();
    }
    if (evt && typeof evt.stopPropagation === 'function') {
      evt.stopPropagation();
    }
    handleOpenGallery(0);
  }, [handleOpenGallery]);

  const cardEventProps = isModalView ? {} : {
    onMouseEnter: prefetchImages,
    onFocus: prefetchImages,
    onPointerDown: prefetchImages,
    onTouchStart: prefetchImages
  };

  return H('div', { className: 'card', ...cardEventProps, tabIndex: -1 },
    H('div', {
      className: 'aspect',
      onClick: openGalleryFromEvent,
      style: {
        cursor: 'zoom-in',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 8
      }
    },
      coverSrc
        ? H(ResponsiveImage, {
            src: coverSrc,
            alt: item.title || 'Listing image',
            style: { width: '100%', height: '100%', objectFit: 'cover' },
            sizes: '(min-width: 1024px) 280px, (min-width: 640px) 45vw, 90vw',
            loading: isModalView ? 'eager' : 'lazy',
            fetchPriority: isModalView ? 'high' : 'auto',
            onClick: openGalleryFromEvent
          })
        : H('div', {
            style: {
              width: '100%',
              height: '100%',
              background: '#f3f4f6',
              display: 'grid',
              placeItems: 'center',
              color: '#6b7280',
              fontWeight: 600
            }
          }, 'No image'),
      item.sold ? H('div', {
        style: {
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }
      },
        H('div', {
          style: {
            transform: 'rotate(-18deg)',
            padding: '6px 18px',
            textTransform: 'uppercase',
            letterSpacing: '6px',
            fontWeight: 800,
            fontSize: 26,
            color: 'rgba(4, 120, 87, 0.85)',
            border: '3px solid rgba(16, 185, 129, 0.55)',
            background: 'rgba(229, 255, 244, 0.82)',
            borderRadius: 999
          }
        }, 'Sold')
      ) : null
    ),
    H('div', { style: { padding: 16 } },
      H('div', {
        className: 'row',
        style: { justifyContent: 'space-between', alignItems: 'start' }
      },
        H('div', null,
          H('div', { style: { fontWeight: 800 } }, item.title || 'Item for sale'),
          H('div', { className: 'muted' }, item.description)
        ),
        H('div', {
          style: {
            fontWeight: 800,
            textAlign: 'right',
            color: isFree ? '#16a34a' : '#111'
          }
        }, price(item.price))
      ),

      H('div', { className: 'muted' }, item.location || 'No location'),

      (showDistance && derivedMeters != null) &&
        H('div', { className: 'distance' }, fmtDistance(derivedMeters) + ' away'),

      H('div', { className: 'muted' },
        'Seller: ',
        renderSellerInfo()
      ),

      H('div', {
        className: 'row',
        style: { marginTop: 8, justifyContent: 'flex-start', gap: 8 }
      }, ...controls)
    ),

    showReport && H(ReportSellerModal, {
      open: showReport,
      listing: item,
      onClose: () => setShowReport(false)
    }),

    H(ListingGalleryModal, {
      open: galleryOpen,
      images: galleryImages,
      index: galleryIndex,
      onClose: () => setGalleryOpen(false),
      onIndex: setGalleryIndex,
      loading: galleryLoading
    })
  );
}
function createEmptyAdForm() {
  return {
    title: '',
    subtitle: '',
    target_url: '',
    image_url: '',
    cta_label: '',
    background: '',
    position: 0,
    is_active: true
  };
}

function AdminDashboard({ onViewSeller, onMessageUser, onAdsUpdated }) {
  const [tab, setTab] = useState('users');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState('');
  const [userReports, setUserReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [topReports, setTopReports] = useState([]);
  const [clearingUserId, setClearingUserId] = useState(null);
  const [topLoading, setTopLoading] = useState(false);
  const [topError, setTopError] = useState('');
  const [topDays, setTopDays] = useState(7);
  const [topMin, setTopMin] = useState(1);

  const [flaggedList, setFlaggedList] = useState([]);
  const [flaggedLoading, setFlaggedLoading] = useState(false);
  const [flaggedError, setFlaggedError] = useState('');
  const [dismissingFlaggedId, setDismissingFlaggedId] = useState(null);
  const [flaggedDetailModal, setFlaggedDetailModal] = useState(null);

  const [adsList, setAdsList] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState('');
  const [adSaving, setAdSaving] = useState(false);
  const [editingAdId, setEditingAdId] = useState(null);
  const [adForm, setAdForm] = useState(() => createEmptyAdForm());
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedDeleteBusy, setSeedDeleteBusy] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [seedError, setSeedError] = useState('');
  const [seedCount, setSeedCount] = useState('');

  const searchTimer = useRef(null);

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);
  useEffect(() => { loadTopReports(topDays, topMin); }, [topDays, topMin]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = searchTerm.trim();
    if (!term) {
      setSearchResults([]);
      setSearchError('');
      return;
    }
    searchTimer.current = setTimeout(() => { fetchSearch(term); }, 300);
  }, [searchTerm]);

  const loadFlagged = useCallback(async () => {
    setFlaggedLoading(true);
    setFlaggedError('');
    try {
      const rows = await api.adminListFlagged({ silent: true });
      setFlaggedList(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setFlaggedError(err?.message || 'Failed to load flagged uploads');
      setFlaggedList([]);
    } finally {
      setFlaggedLoading(false);
    }
  }, []);

  const openFlaggedDetail = useCallback((item, detail) => {
    if (!detail || typeof detail !== 'object') return;
    setFlaggedDetailModal({ item, detail });
  }, []);

  const closeFlaggedDetail = useCallback(() => {
    setFlaggedDetailModal(null);
  }, []);

  const loadAds = useCallback(async () => {
    setAdsLoading(true);
    setAdsError('');
    try {
      const rows = await api.adminListAds({ silent: true });
      setAdsList(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setAdsError(err?.message || 'Failed to load ads');
      setAdsList([]);
    } finally {
      setAdsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'ads') {
      loadAds();
    }
  }, [tab, loadAds]);

  useEffect(() => {
    if (tab === 'flagged') {
      loadFlagged();
    }
  }, [tab, loadFlagged]);

  async function handleSeedListings() {
    if (seedBusy || seedDeleteBusy) return;
    setSeedError('');
    setSeedMessage('');
    const trimmed = typeof seedCount === 'string' ? seedCount.trim() : '';
    let desiredCount = null;
    if (trimmed) {
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setSeedError('Enter a valid number of images to seed (minimum 1).');
        return;
      }
      desiredCount = parsed;
    }
    setSeedBusy(true);
    try {
      const result = await api.adminSeedListings(desiredCount ? { count: desiredCount } : undefined);
      const count = Number(result?.created || 0);
      setSeedMessage(count
        ? `Created ${count} test listing${count === 1 ? '' : 's'}.`
        : 'No listings were created.');
    } catch (err) {
      setSeedError(err?.message || 'Failed to seed test listings.');
    } finally {
      setSeedBusy(false);
    }
  }

  async function handleDeleteSeedListings() {
    if (seedBusy || seedDeleteBusy) return;
    setSeedError('');
    setSeedMessage('');
    setSeedDeleteBusy(true);
    try {
      const result = await api.adminDeleteSeedListings();
      const count = Number(result?.deleted || 0);
      setSeedMessage(count
        ? `Deleted ${count} test listing${count === 1 ? '' : 's'}.`
        : 'No test listings to delete.');
    } catch (err) {
      setSeedError(err?.message || 'Failed to delete test listings.');
    } finally {
      setSeedDeleteBusy(false);
    }
  }

  const seedActionsDisabled = seedBusy || seedDeleteBusy;

  function formatDate(value) {
    if (!value) return '--';
    const dt = new Date(value);
    return Number.isFinite(dt.getTime()) ? dt.toLocaleDateString() : value;
  }

  function formatDateTime(value) {
    if (!value) return '--';
    const dt = new Date(value);
    return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : value;
  }

  function statusBadge(status) {
    const color = status === 'banned' ? '#fee2e2' : status === 'locked' ? '#fef3c7' : '#d1fae5';
    const textColor = status === 'banned' ? '#b91c1c' : status === 'locked' ? '#92400e' : '#047857';
    return H('span', {
      style: {
        padding: '3px 10px',
        borderRadius: 999,
        background: color,
        color: textColor,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase'
      }
    }, status || 'active');
  }

  async function fetchSearch(term) {
    setSearchLoading(true);
    setSearchError('');
    try {
      const results = await api.adminSearchUsers({ q: term, limit: 25 });
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (err) {
      setSearchError(err.message || 'Search failed');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadUser(userId) {
    setSelectedUserId(userId);
    setUserLoading(true);
    setUserError('');
    try {
      const data = await api.adminGetUser(userId);
      setSelectedUser(data || null);
      await loadUserReports(userId);
    } catch (err) {
      setUserError(err.message || 'Failed to load user');
      setSelectedUser(null);
      setUserReports([]);
    } finally {
      setUserLoading(false);
    }
  }

  async function loadUserReports(userId, limit = 50) {
    setReportsLoading(true);
    setReportsError('');
    try {
      const items = await api.adminGetUserReports(userId, { limit });
      setUserReports(Array.isArray(items) ? items : []);
    } catch (err) {
      setReportsError(err.message || 'Failed to load reports');
      setUserReports([]);
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadTopReports(daysValue = topDays, minValue = topMin) {
    setTopLoading(true);
    setTopError('');
    try {
      const payload = await api.adminTopReports({ limit: 20, days: daysValue, min: minValue });
      const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
      setTopReports(items);
    } catch (err) {
      setTopError(err.message || 'Failed to load report summary');
      setTopReports([]);
    } finally {
      setTopLoading(false);
    }
  }

  async function handleStatusChange(status) {
    if (!selectedUser) return;
    if (status === selectedUser.account_status) return;
    const confirmMsg = status === 'active' ? 'Restore account access?' : status === 'locked' ? 'Lock this account?' : 'Ban this account?';
    if (!window.confirm(confirmMsg)) return;
    let note = '';
    if (status !== 'active') {
      note = window.prompt('Add an optional note for this action:', selectedUser.status_note || '') || '';
    } else if (selectedUser.status_note) {
      note = window.prompt('Update note (leave blank to clear):', selectedUser.status_note || '') || '';
    }
    try {
      await api.adminUpdateUserStatus(selectedUser.id, { status, note: note.trim() });
      await loadUser(selectedUser.id);
      await loadTopReports(topDays, topMin);
      if (searchTerm.trim()) await fetchSearch(searchTerm.trim());
    } catch (err) {
      alert(err.message || 'Failed to update status');
    }
  }

  function handleViewUserFromTop(userId) {
    setTab('users');
    loadUser(userId);
  }

  async function handleClearReportsForUser(user) {
    if (!user || !Number.isFinite(Number(user.user_id))) return;
    const name = user.username || 'this user';
    if (!window.confirm(`Clear reports for ${name}?`)) return;
    const noteInput = window.prompt('Optional note for this action:', '') || '';
    try {
      setClearingUserId(Number(user.user_id));
      const payload = noteInput.trim() ? { note: noteInput.trim() } : {};
      await api.adminClearUserReports(Number(user.user_id), payload);
      if (selectedUser?.id === Number(user.user_id)) {
        await loadUser(Number(user.user_id));
      }
      await loadTopReports(topDays, topMin);
      if (searchTerm.trim()) await fetchSearch(searchTerm.trim());
    } catch (err) {
      alert(err.message || 'Failed to clear reports');
    } finally {
      setClearingUserId(null);
    }
  }

  function buildAdPayload(source) {
    const payload = {
      title: String(source.title || '').trim(),
      subtitle: String(source.subtitle || '').trim(),
      target_url: String(source.target_url || '').trim(),
      image_url: String(source.image_url || '').trim(),
      cta_label: String(source.cta_label || '').trim(),
      background: String(source.background || '').trim(),
      position: Number.isFinite(Number(source.position)) ? Math.round(Number(source.position)) : 0,
      is_active: source.is_active ? 1 : 0
    };
    if (payload.position > 9999) payload.position = 9999;
    if (payload.position < -9999) payload.position = -9999;
    return payload;
  }

  function resetAdForm() {
    setEditingAdId(null);
    setAdForm(createEmptyAdForm());
    setAdsError('');
  }

  function handleEditAd(ad) {
    if (!ad) return;
    setAdsError('');
    setEditingAdId(ad.id);
    setAdForm({
      title: ad.title || '',
      subtitle: ad.subtitle || '',
      target_url: ad.target_url || '',
      image_url: ad.image_url || '',
      cta_label: ad.cta_label || '',
      background: ad.background || '',
      position: Number.isFinite(Number(ad.position)) ? Number(ad.position) : 0,
      is_active: !!ad.is_active
    });
  }

  async function handleAdSubmit(e) {
    e.preventDefault();
    setAdSaving(true);
    setAdsError('');
    try {
      const payload = buildAdPayload(adForm);
      if (!payload.title || !payload.target_url) {
        setAdsError('Title and target URL are required.');
        setAdSaving(false);
        return;
      }
      if (editingAdId) {
        await api.adminUpdateAd(editingAdId, payload);
      } else {
        await api.adminCreateAd(payload);
      }
      await loadAds();
      resetAdForm();
      onAdsUpdated?.();
    } catch (err) {
      setAdsError(err?.message || 'Failed to save ad');
    } finally {
      setAdSaving(false);
    }
  }

  async function handleDeleteAd(id) {
    if (!Number.isFinite(Number(id))) return;
    if (!window.confirm('Delete this ad?')) return;
    try {
      await api.adminDeleteAd(id);
      if (editingAdId === id) resetAdForm();
      await loadAds();
      onAdsUpdated?.();
    } catch (err) {
      alert(err?.message || 'Failed to delete ad');
    }
  }

  async function handleToggleAdActive(ad) {
    if (!ad) return;
    try {
      const payload = buildAdPayload({ ...ad, is_active: ad.is_active ? 0 : 1 });
      await api.adminUpdateAd(ad.id, payload);
      await loadAds();
      onAdsUpdated?.();
    } catch (err) {
      alert(err?.message || 'Failed to update ad');
    }
  }

  const lockToggleLabel = selectedUser?.account_status === 'locked' ? 'Unlock account' : 'Lock account';
  const lockToggleTarget = selectedUser?.account_status === 'locked' ? 'active' : 'locked';
  const showRestore = selectedUser?.account_status === 'banned';

  const userSummary = selectedUser ? H('div', { style: { display: 'grid', gap: 8 } },
    H('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
      H('div', { style: { fontSize: 20, fontWeight: 700 } }, selectedUser.username || '(no username)'),
      statusBadge(selectedUser.account_status || 'active')
    ),
    H('div', { className: 'muted' }, selectedUser.email || 'No email on file'),
    H('div', { className: 'muted', style: { fontSize: 13 } }, `Joined: ${formatDate(selectedUser.created_at)}`),
    H('div', { className: 'muted', style: { fontSize: 13 } }, `Last login: ${formatDateTime(selectedUser.last_login_at)}`),
    H('div', { className: 'muted', style: { fontSize: 13 } }, `Listings: ${Number(selectedUser.listing_count || 0)} | Reports: ${Number(selectedUser.report_count || 0)} | Open reports: ${Number(selectedUser.open_report_count || 0)}`),
    selectedUser.status_note && H('div', { style: { fontSize: 13, background: '#fef3c7', padding: 8, borderRadius: 8, color: '#92400e' } }, `Note: ${selectedUser.status_note}`),
    H('div', { className: 'row', style: { gap: 8, marginTop: 8, flexWrap: 'wrap' } },
      onViewSeller && H('button', { className: 'btn', onClick: handleViewProfile }, 'View profile'),
      onMessageUser && H('button', { className: 'btn', onClick: handleMessageUser }, 'Message user'),
      H('button', { className: 'btn', onClick: () => handleStatusChange(lockToggleTarget) }, lockToggleLabel),
      H('button', { className: 'btn danger', onClick: () => handleStatusChange('banned') }, 'Ban account'),
      showRestore && H('button', { className: 'btn', onClick: () => handleStatusChange('active') }, 'Restore account'),
      H('button', { className: 'btn', onClick: () => loadUser(selectedUser.id) }, 'Refresh')
    )
  ) : H('div', { className: 'muted' }, userError || 'Select a user to view details.');


  function handleViewProfile() {
    if (!selectedUser || !onViewSeller) return;
    const label = selectedUser.username || selectedUser.email || `User #${selectedUser.id}`;
    onViewSeller(selectedUser.id, label);
  }

  async function handleMessageUser() {
    if (!selectedUser || !onMessageUser) return;
    try {
      await onMessageUser(selectedUser.id);
    } catch (err) {
      alert(err?.message || 'Failed to open conversation.');
    }
  }

  async function handleMessageFlagged(userId) {
    if (!onMessageUser) return;
    const targetId = Number(userId);
    if (!Number.isFinite(targetId)) return;
    try {
      await onMessageUser(targetId);
    } catch (err) {
      alert(err?.message || 'Failed to open conversation.');
    }
  }

  async function handleDismissFlagged(id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return;
    if (dismissingFlaggedId === numericId) return;
    try {
      setDismissingFlaggedId(numericId);
      await api.adminDeleteFlagged(numericId);
      setFlaggedList(list => list.filter(item => Number(item.id) !== numericId));
    } catch (err) {
      alert(err?.message || 'Failed to dismiss flagged attempt.');
    } finally {
      setDismissingFlaggedId(null);
    }
  }

  const reportsList = userReports.length
    ? H('div', { style: { display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto', marginTop: 12 } },
        userReports.map(r => H('div', {
          key: r.id,
          className: 'card',
          style: { padding: 12, border: '1px solid #e5e7eb' }
        },
          H('div', { style: { fontSize: 13, fontWeight: 600 } }, `Report #${r.id}`),
          H('div', { className: 'muted', style: { fontSize: 12 } }, `Filed: ${formatDateTime(r.created_at)}`),
          H('div', { className: 'muted', style: { fontSize: 12 } }, `Reporter: ${r.reporter?.username || 'anonymous'} (${r.reporter?.email || 'no email'})`),
          Array.isArray(r.reasons) && r.reasons.length
            ? H('div', { style: { fontSize: 12, marginTop: 4 } }, `Reasons: ${r.reasons.join(', ')}`)
            : null,
          r.details && H('div', { style: { fontSize: 12, marginTop: 4 } }, r.details)
        ))
      )
    : H('div', { className: 'muted', style: { marginTop: 12 } }, reportsError || (reportsLoading ? 'Loading reports...' : 'No reports for this user.'));

  const topList = topReports.length
    ? H('div', { style: { display: 'grid', gap: 8, marginTop: 12 } },
        topReports.map(item => H('div', {
          key: item.user_id,
          className: 'card',
          style: { padding: 12, border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }
        },
          H('div', { style: { display: 'grid', gap: 4 } },
            H('div', { style: { fontWeight: 600 } }, item.username || '(no username)'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, item.email || 'No email'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, `Reports: ${Number(item.total_reports || 0)} | Open: ${Number(item.open_reports || 0)} | Recent: ${Number(item.recent_reports || 0)}`),
            H('div', { className: 'muted', style: { fontSize: 12 } }, `Last report: ${formatDateTime(item.last_report_at)}`)
          ),
          H('div', { className: 'row', style: { gap: 8, alignItems: 'center' } },
            statusBadge(item.account_status || 'active'),
            H('button', {
              className: 'btn danger',
              onClick: () => handleClearReportsForUser(item),
              disabled: clearingUserId === Number(item.user_id)
            }, clearingUserId === Number(item.user_id) ? 'Clearing...' : 'Clear'),
            H('button', { className: 'btn', onClick: () => handleViewUserFromTop(item.user_id) }, 'View')
          )
        ))
      )
    : H('div', { className: 'muted', style: { marginTop: 12 } }, topError || (topLoading ? 'Loading...' : 'No reported accounts yet.'));

  return H('div', { className: 'admin-dashboard', style: { display: 'grid', gap: 16 } },
    H('div', { className: 'row', style: { gap: 8 } },
      H('button', { className: `btn ${tab === 'users' ? 'primary' : ''}`, onClick: () => setTab('users') }, 'Users'),
      H('button', { className: `btn ${tab === 'reports' ? 'primary' : ''}`, onClick: () => setTab('reports') }, 'Reports'),
      H('button', { className: `btn ${tab === 'flagged' ? 'primary' : ''}`, onClick: () => setTab('flagged') }, 'Flagged'),
      H('button', { className: `btn ${tab === 'ads' ? 'primary' : ''}`, onClick: () => setTab('ads') }, 'Ads'),
      H('button', { className: `btn ${tab === 'testing' ? 'primary' : ''}`, onClick: () => setTab('testing') }, 'Testing')
    ),

    tab === 'users' && H('div', { style: { display: 'grid', gap: 16 } },
      H('section', { className: 'card', style: { padding: 16 } },
        H('h3', { style: { margin: '0 0 12px', fontSize: 18 } }, 'Search users'),
        H('div', { className: 'row', style: { gap: 8, marginBottom: 8 } },
          H('input', {
            value: searchTerm,
            onChange: (e) => setSearchTerm(e.target.value),
            placeholder: 'Search by email or username',
            style: { flex: 1, padding: 8, fontSize: 14 },
            disabled: searchLoading
          }),
          searchTerm && H('button', {
            className: 'btn',
            type: 'button',
            onClick: () => setSearchTerm(''),
            disabled: searchLoading
          }, 'Clear')
        ),
        searchError && H('div', { style: { color: '#b91c1c', fontSize: 13, marginBottom: 8 } }, searchError),
        searchLoading && !searchTerm.trim() ? H('div', { className: 'muted', style: { fontSize: 13 } }, 'Loading...') : null,
        H('div', { style: { maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 } },
          searchResults.map(item => H('button', {
            key: item.id,
            className: 'card',
            onClick: () => loadUser(item.id),
            style: {
              padding: 12,
              textAlign: 'left',
              border: selectedUserId === item.id ? '2px solid #2563eb' : '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer'
            }
          },
            H('div', { style: { fontWeight: 600 } }, item.username || '(no username)'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, item.email || 'No email'),
            H('div', { className: 'muted', style: { fontSize: 12 } }, `Status: ${item.account_status || 'active'} | Reports: ${Number(item.report_count || 0)}`)
          ))
        )
      ),

      H('section', { className: 'card', style: { padding: 16 } },
        userLoading ? H('div', { className: 'muted' }, 'Loading user...') : userSummary,
        (reportsLoading && !userReports.length) ? H('div', { className: 'muted', style: { marginTop: 12 } }, 'Loading reports...') : reportsList
      )
    ),

    tab === 'reports' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },
      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
        H('h3', { style: { margin: 0, fontSize: 18 } }, 'Most reported accounts'),
        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          H('label', { style: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 } },
            'Window:',
            H('select', {
              value: topDays,
              onChange: (e) => setTopDays(Number(e.target.value)),
              style: { padding: 6 }
            },
              H('option', { value: 7 }, '7 days'),
              H('option', { value: 30 }, '30 days'),
              H('option', { value: 90 }, '90 days')
            )
          ),
          H('label', { style: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 } },
            'Min reports:',
            H('input', {
              type: 'number',
              min: 1,
              value: String(topMin),
              onChange: (e) => setTopMin(Math.max(1, Number(e.target.value) || 1)),
              style: { width: 72, padding: 6 }
            })
          ),
          H('button', { className: 'btn', onClick: () => loadTopReports(topDays, topMin) }, 'Refresh')
        )
      ),
      topLoading && !topReports.length ? H('div', { className: 'muted' }, 'Loading...') : null,
      topList
    ),

    tab === 'flagged' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },
      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 } },
        H('h3', { style: { margin: 0, fontSize: 18 } }, 'Flagged uploads'),
        H('button', { className: 'btn', onClick: loadFlagged, disabled: flaggedLoading }, flaggedLoading ? 'Refreshing…' : 'Refresh')
      ),
      flaggedError && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, flaggedError),
      flaggedLoading && !flaggedList.length ? H('div', { className: 'muted', style: { fontSize: 13 } }, 'Loading flagged uploads…') : null,
      flaggedList.length
        ? H('div', { style: { display: 'grid', gap: 12 } },
            flaggedList.map(item => {
              const details = Array.isArray(item?.details) ? item.details : [];
              return H('div', {
                key: item.id,
                className: 'card',
                style: { padding: 12, border: '1px solid #e5e7eb', display: 'grid', gap: 8 }
              },
                H('div', { style: { display: 'grid', gap: 4 } },
                  H('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    H('span', { style: { fontWeight: 600 } }, item?.username || '(no username)'),
                    item?.flagged_at && H('span', { className: 'muted', style: { fontSize: 12 } }, formatDateTime(item.flagged_at))
                  ),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, item?.email || 'No email on file'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, item?.listing_title ? `Title: ${item.listing_title}` : 'Title not provided'),
                  details.length ? H('div', { style: { display: 'grid', gap: 6 } },
                    details.map((detail, idx) => {
                      if (!detail || typeof detail !== 'object') return null;
                      const categories = Array.isArray(detail.categories) ? detail.categories.filter(Boolean) : [];
                      const tags = categories.length ? categories : ['Flagged'];
                      const rawType = typeof detail.type === 'string' && detail.type ? detail.type : 'content';
                      const typeLabel = rawType.charAt(0).toUpperCase() + rawType.slice(1);
                      const target = typeof detail.target === 'string' ? detail.target.trim() : '';
                      const isImage = rawType.toLowerCase() === 'image';
                      const textPreview = target.length > 120 ? `${target.slice(0, 117)}…` : target;
                      const preview = isImage
                        ? (target ? 'Image flagged — click to view the full capture.' : 'Image flagged — preview unavailable.')
                        : (textPreview || 'No text captured. Click to open details.');
                      return H('button', {
                        key: `${item.id}-${idx}`,
                        type: 'button',
                        className: 'flagged-detail-button',
                        onClick: () => openFlaggedDetail(item, detail),
                        title: target
                      },
                        H('div', { className: 'flagged-detail-type' }, typeLabel),
                        H('div', { className: 'flagged-detail-tags' },
                          tags.map((tag) => H('span', { key: tag, className: 'flagged-tag' }, tag))
                        ),
                        H('div', { className: 'flagged-detail-preview' }, preview)
                      );
                    }).filter(Boolean)
                  ) : null
                ),
                H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },
                  onMessageUser && H('button', { className: 'btn', onClick: () => handleMessageFlagged(item.user_id) }, 'Message'),
                  H('button', {
                    className: 'btn',
                    onClick: () => handleDismissFlagged(item.id),
                    disabled: dismissingFlaggedId === Number(item.id)
                  }, dismissingFlaggedId === Number(item.id) ? 'Removing…' : 'Dismiss')
                )
              );
            })
          )
        : (!flaggedLoading && !flaggedError
            ? H('div', { className: 'muted', style: { fontSize: 13 } }, 'No flagged uploads yet.')
            : null)
    ),

    H(FlaggedDetailsModal, {
      open: Boolean(flaggedDetailModal?.detail),
      detail: flaggedDetailModal?.detail || null,
      item: flaggedDetailModal?.item || null,
      onClose: closeFlaggedDetail
    }),


    tab === 'ads' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 16 } },

      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },

        H('h3', { style: { margin: 0, fontSize: 18 } }, editingAdId ? 'Edit advertisement' : 'Create advertisement'),

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('button', { className: 'btn', type: 'button', onClick: loadAds, disabled: adsLoading }, 'Refresh'),

          editingAdId && H('button', { className: 'btn', type: 'button', onClick: resetAdForm, disabled: adSaving }, 'New ad')

        )

      ),

      adsError && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, adsError),

      H('form', { onSubmit: handleAdSubmit, style: { display: 'grid', gap: 12 } },

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 260px' } },

            'Title',

            H('input', {

              value: adForm.title,

              onChange: (e) => setAdForm(f => ({ ...f, title: e.target.value })),

              placeholder: 'Headline',

              disabled: adSaving,

              required: true

            })

          ),

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 260px' } },

            'Target URL',

            H('input', {

              value: adForm.target_url,

              onChange: (e) => setAdForm(f => ({ ...f, target_url: e.target.value })),

              placeholder: 'https://example.com',

              disabled: adSaving,

              required: true

            })

          )

        ),

        H('label', { style: { display: 'grid', gap: 4 } },

          'Subtitle',

          H('input', {

            value: adForm.subtitle,

            onChange: (e) => setAdForm(f => ({ ...f, subtitle: e.target.value })),

            placeholder: 'Short supporting copy',

            disabled: adSaving

          })

        ),

        H('label', { style: { display: 'grid', gap: 4 } },

          'Image URL',

          H('input', {

            value: adForm.image_url,

            onChange: (e) => setAdForm(f => ({ ...f, image_url: e.target.value })),

            placeholder: 'https://cdn.example.com/banner.jpg',

            disabled: adSaving

          })

        ),

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 200px' } },

            'CTA label',

            H('input', {

              value: adForm.cta_label,

              onChange: (e) => setAdForm(f => ({ ...f, cta_label: e.target.value })),

              placeholder: 'Learn more',

              disabled: adSaving

            })

          ),

          H('label', { style: { display: 'grid', gap: 4, flex: '1 1 240px' } },

            'Background',

            H('input', {

              value: adForm.background,

              onChange: (e) => setAdForm(f => ({ ...f, background: e.target.value })),

              placeholder: 'e.g. linear-gradient(...)',

              disabled: adSaving

            })

          ),

          H('label', { style: { display: 'grid', gap: 4, width: 140 } },

            'Position',

            H('input', {

              type: 'number',

              value: adForm.position,

              onChange: (e) => setAdForm(f => ({ ...f, position: e.target.value })),

              disabled: adSaving

            })

          ),

          H('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },

            H('input', {

              type: 'checkbox',

              checked: !!adForm.is_active,

              onChange: (e) => setAdForm(f => ({ ...f, is_active: e.target.checked })),

              disabled: adSaving

            }),

            'Active'

          )

        ),

        H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

          H('button', { className: 'btn primary', type: 'submit', disabled: adSaving }, editingAdId ? 'Update ad' : 'Create ad'),

          H('button', { className: 'btn', type: 'button', onClick: resetAdForm, disabled: adSaving }, 'Reset')

        ),

        H('div', { style: { display: 'grid', gap: 8 } },

          H('div', { className: 'muted', style: { fontSize: 12 } }, 'Preview'),

          H('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 } },

            H(AdTile, { ad: { ...adForm }, cols: 3, preview: true, className: 'ad-preview' })

          )

        )

      ),

      adsLoading ? H('div', { className: 'muted' }, 'Loading ads...') :

        (adsList.length

          ? H('div', { style: { display: 'grid', gap: 12 } }, adsList.map(ad =>

              H('div', { key: ad.id, className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },

                H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },

                  H('div', { style: { display: 'grid', gap: 4 } },

                    H('div', { style: { fontWeight: 600 } }, ad.title || '(no title)'),

                    H('div', { className: 'muted', style: { fontSize: 12 } }, ad.target_url),

                    H('div', { className: 'muted', style: { fontSize: 12 } }, `Position: ${Number(ad.position || 0)} | ${ad.is_active ? 'Active' : 'Inactive'}`)

                  ),

                  H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },

                    H('button', { className: 'btn', onClick: () => handleEditAd(ad) }, 'Edit'),

                    H('button', { className: 'btn', onClick: () => handleToggleAdActive(ad) }, ad.is_active ? 'Deactivate' : 'Activate'),

                    H('button', { className: 'btn danger', onClick: () => handleDeleteAd(ad.id) }, 'Delete')

                  )

                ),

                H('div', { style: { display: 'grid', gap: 8 } },

                  H(AdTile, { ad, cols: 3, preview: true })

                )

              )

            ))

          : H('div', { className: 'muted' }, 'No ads yet.')

        )

    
    ),

    tab === 'testing' && H('section', { className: 'card', style: { padding: 16, display: 'grid', gap: 12 } },
      H('h3', { style: { margin: 0, fontSize: 18 } }, 'Testing utilities'),
      H('div', { className: 'muted', style: { fontSize: 13 } }, 'Generate sample listings with photos for QA or demo walkthroughs.'),
      seedError
        ? H('div', { style: { color: '#b91c1c', fontSize: 13 } }, seedError)
        : (seedMessage
            ? H('div', { style: { color: '#047857', fontSize: 13 } }, seedMessage)
            : null),
      (seedBusy || seedDeleteBusy)
        ? H('div', { className: 'muted', style: { fontSize: 13 } }, seedBusy ? 'Seeding test listings… this may take a moment.' : 'Deleting test listings…')
        : null,
      H('label', { style: { display: 'grid', gap: 6, fontSize: 13 } },
        'Images to seed',
        H('input', {
          type: 'number',
          min: 1,
          max: 2000,
          step: 1,
          value: seedCount,
          placeholder: 'Uses default when left blank',
          onChange: (e) => setSeedCount(e.target.value),
          disabled: seedActionsDisabled
        })
      ),
      H('div', { className: 'row', style: { gap: 8, flexWrap: 'wrap' } },
        H('button', {
          className: 'btn primary',
          type: 'button',
          onClick: handleSeedListings,
          disabled: seedActionsDisabled
        }, seedBusy ? 'Seeding…' : 'Seed test listings'),
        H('button', {
          className: 'btn danger',
          type: 'button',
          onClick: handleDeleteSeedListings,
          disabled: seedActionsDisabled
        }, seedDeleteBusy ? 'Deleting…' : 'Delete test listings')
      )
    )
  );
}


// NEW: Seller Profile Component
function SellerProfile({ sellerId, sellerUsername, onBack, user, onMessage, onAdminDelete }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('active');
  useEffect(() => {
    let mounted = true;

    async function fetchSellerListings() {
      try {
        const items = await api.listByUser(sellerId);
        if (!mounted) return;
        setListings(asArray(items));
        setError(null);
      } catch (e) {
        if (!mounted) return;
        console.error('Failed to fetch seller listings:', e);

        const message = e?.message;
        if (message === 'User not found' || message === 'Not found') {
          setError('User not found');
        } else {
          setError('Failed to load listings');
        }
        setListings([]);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    if (sellerId) {
      setLoading(true);
      setError(null);
      fetchSellerListings();
    } else {
      setListings([]);
      setError(null);
      setLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [sellerId]);

  useEffect(() => { setTab('active'); }, [sellerId]);

  const handleSelectListing = useCallback((listing, coverSrc) => {
    const { payload, images } = prepareListingForModal(listing, coverSrc);
    if (!payload) return;
    setSelectedListing(payload);
    if (listing?.id) {
      warmListingImages(listing.id, images);
    }
  }, [setSelectedListing]);

  const handleSelectListingFromEvent = useCallback((evt, listing, coverSrc) => {
    if (evt && typeof evt.preventDefault === 'function') {
      evt.preventDefault();
    }
    if (evt && typeof evt.stopPropagation === 'function') {
      evt.stopPropagation();
    }
    handleSelectListing(listing, coverSrc);
  }, [handleSelectListing]);

  if (error) {
    return H('div', { style: { padding: '24px', textAlign: 'center' } },
      H('div', { className: 'muted' }, error),
      H('button', { className: 'btn', onClick: onBack }, '<- Back')
    );
  }

  if (loading) {
    return H('div', { style: { padding: '24px', textAlign: 'center' } },
      H('div', { className: 'spinner' }),
      H('div', { style: { marginTop: '12px' } }, 'Loading seller profile...')
    );
  }

  const activeListings = listings.filter(l => !l?.sold);
  const soldListings = listings.filter(l => !!l?.sold);
  const shownListings = tab === 'sold' ? soldListings : activeListings;

  return H('div', null,
    H('section', { className: 'card', style: { padding: '16px', margin: '12px 0 16px' } },
      H('div', { className: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
        H('div', null,
          H('div', { style: { fontWeight: 800, fontSize: '20px' } }, `@${sellerUsername}'s Listings`),
          H('div', { className: 'muted' }, `Active ${activeListings.length} - Sold ${soldListings.length}`)
        ),
        H('button', { className: 'btn', onClick: onBack }, '<- Back')
      )
    ),

    H('div', { className:'row', style:{ gap:8, margin:'0 0 16px' } },
      H('button', {
        className: `btn ${tab === 'active' ? 'primary' : ''}`,
        type: 'button',
        onClick: () => setTab('active')
      }, 'Active listings'),
      H('button', {
        className: `btn ${tab === 'sold' ? 'primary' : ''}`,
        type: 'button',
        onClick: () => setTab('sold')
      }, 'Sold listings')
    ),

    shownListings.length === 0 
      ? H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } }, tab === 'sold' ? 'No sold listings yet.' : 'No listings from this seller.')
      : (() => {
          const isMobile = isMobileDevice();
          const COLS = isMobile ? 3 : 4;
          const GAP = 12;
          
          return H('section', {
            style: {
              display: 'grid',
              gridTemplateColumns: `repeat(${COLS}, 1fr)`,
              gap: GAP
            }
          },
            shownListings.map(it => {
              const src = it.image_data || '';
              
              return H('div', { 
                key: it.id, 
                className: 'card', 
                style: { padding: 0, overflow: 'hidden', borderRadius: 8 } 
              },
                H('div', { 
                  style: { 
                    position: 'relative', 
                    width: '100%', 
                    aspectRatio: '1 / 1', 
                    background: '#f3f4f6' 
                  } 
                },
                  src && H(ImageWithSkeleton, {
                    src,
                    alt: it.title || 'Item',
                    loading: 'lazy',
                    decoding: 'async',
                    fetchPriority: 'low',
                    style: {
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                      cursor: 'pointer'
                    },
                    disableSkeleton: true,
                    onClick: (evt) => handleSelectListingFromEvent(evt, it, src)
                  }),
                  it.sold ? H('div', {
                    style: {
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none'
                    }
                  },
                    H('div', {
                      style: {
                        transform: 'rotate(-18deg)',
                        padding: '4px 14px',
                        textTransform: 'uppercase',
                        letterSpacing: '6px',
                        fontWeight: 800,
                        fontSize: 22,
                        color: 'rgba(4, 120, 87, 0.85)',
                        border: '3px solid rgba(16, 185, 129, 0.55)',
                        background: 'rgba(229, 255, 244, 0.82)',
                        borderRadius: 999
                      }
                    }, 'Sold')
                  ) : null
                )
              );
            })
          );
        })(),

    H(ListingModal, {
      open: !!selectedListing,
      item: selectedListing,
      onClose: () => setSelectedListing(null),
      cardProps: {
        user,
        canEdit: false,
        onMessage: (item) => {
          setSelectedListing(null);
          onMessage(item);
        },
        onAdminDelete: (id) => {
          setListings(prev => prev.filter(l => l.id !== id));
          setSelectedListing(null);
          onAdminDelete?.(id);
        },
        showDistance: false,
        onViewSeller: null
      }
    })
  );
}

  // --- Nearby Panel (unchanged) ---
  function NearbyPanel({ user, mineById, onEdit, onDelete, onMessage, onAdminDelete, setTab, onViewSeller, onToggleSold }) {
    const [radius, setRadius] = useState(150);
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [lastUpdatedLabel, setLastUpdatedLabel] = useState('');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('new');
    const storedCoords = useMemo(() => {
      try {
        const raw = localStorage.getItem('listit_nearby_coords');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const lat = Number(parsed?.lat);
        const lon = Number(parsed?.lon);
        const ts = Number(parsed?.ts) || 0;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return { lat, lon, ts };
        }
      } catch {}
      return null;
    }, []);
    const coordsRef = useRef(storedCoords ? { lat: storedCoords.lat, lon: storedCoords.lon } : null);
    const coordsTsRef = useRef(storedCoords?.ts || 0);
    const abortRef = useRef(null);

    const isMobile = useMemo(() => isMobileDevice(), []);
    const columns = isMobile ? 3 : 4;
    const gridGap = isMobile ? 8 : 12;

    const filteredItems = useMemo(() => {
      const base = Array.isArray(items) ? items.slice() : [];
      const query = search.trim().toLowerCase();
      let working = base;

      if (query) {
        working = base.filter((item) => {
          const haystack = [
            item?.title,
            item?.description,
            item?.location,
            item?.owner_username
          ].filter(Boolean).map(value => String(value).toLowerCase()).join(' ');
          return haystack.includes(query);
        });
      } else {
        working = [...working];
      }

      const parseDate = (value) => {
        if (!value) return 0;
        const ts = new Date(value).getTime();
        return Number.isFinite(ts) ? ts : 0;
      };

      const parsePrice = (item) => {
        const val = Number(item?.price);
        return Number.isFinite(val) ? val : 0;
      };

      working.sort((a, b) => {
        if (sort === 'price_asc') {
          const diff = parsePrice(a) - parsePrice(b);
          if (diff !== 0) return diff;
        } else if (sort === 'price_desc') {
          const diff = parsePrice(b) - parsePrice(a);
          if (diff !== 0) return diff;
        } else {
          const tb = parseDate(b?.created_at || b?.updated_at);
          const ta = parseDate(a?.created_at || a?.updated_at);
          const diff = tb - ta;
          if (diff !== 0) return diff;
        }

        // Fallback tie-breakers
        const createdDiff = parseDate(b?.created_at || b?.updated_at) - parseDate(a?.created_at || a?.updated_at);
        if (createdDiff !== 0) return createdDiff;
        return Number(b?.id || 0) - Number(a?.id || 0);
      });

      return working;
    }, [items, search, sort]);

    const ensureCoords = useCallback(async (force = false) => {
      const cached = coordsRef.current;
      const now = Date.now();
      if (!force && cached && (now - coordsTsRef.current) < 120000) {
        return cached;
      }
      if (!('geolocation' in navigator)) {
        if (cached) return cached;
        throw new Error('geolocation_unsupported');
      }
      try {
        const position = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy:true,
            timeout:8000,
            maximumAge:60000
          })
        );
        const out = { lat: position.coords.latitude, lon: position.coords.longitude };
        coordsRef.current = out;
        coordsTsRef.current = Date.now();
        try { localStorage.setItem('listit_nearby_coords', JSON.stringify({ ...out, ts: coordsTsRef.current })); } catch {}
        return out;
      } catch (err) {
        if (!force && cached) return cached;
        throw err;
      }
    }, []);

    const load = useCallback(async (forceLocation = false) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setErrorMsg('');
      try {
        const coords = await ensureCoords(forceLocation);
        if (!coords) throw new Error('location_unavailable');
        const res = await api.listNearby(coords.lat, coords.lon, radius, { silent:true, signal: controller.signal });
        if (abortRef.current !== controller) return;
        setItems(Array.isArray(res) ? res : []);
        setLastUpdatedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Nearby load failed:', err);
        let message = 'Could not load nearby listings.';
        if (err?.message === 'geolocation_unsupported') {
          message = 'Geolocation not supported in this browser.';
        } else if (typeof err?.code === 'number') {
          if (err.code === 1) message = 'Location permission denied.';
          else if (err.code === 2) message = 'Unable to determine your location.';
          else if (err.code === 3) message = 'Location lookup timed out.';
        } else if (err?.message === 'location_unavailable') {
          message = 'Location unavailable.';
        }
        if (abortRef.current === controller) {
          setItems([]);
          setErrorMsg(message);
          setLastUpdatedLabel('');
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    }, [ensureCoords, radius]);

    useEffect(() => {
      load(false);
      return () => {
        if (abortRef.current) abortRef.current.abort();
      };
    }, [load]);

    function handleEdit(it) {
      setSelected(null);
      setTab('browse');
      onEdit(it);
    }

    const handleSelectListing = useCallback((listing, coverSrc) => {
      const { payload, images } = prepareListingForModal(listing, coverSrc);
      if (!payload) return;
      setSelected(payload);
      if (listing?.id) {
        warmListingImages(listing.id, images);
      }
    }, [setSelected]);

    const handleSelectListingFromEvent = useCallback((evt, listing, coverSrc) => {
      if (evt && typeof evt.preventDefault === 'function') {
        evt.preventDefault();
      }
      if (evt && typeof evt.stopPropagation === 'function') {
        evt.stopPropagation();
      }
      handleSelectListing(listing, coverSrc);
    }, [handleSelectListing]);

    return H('div', { id: 'tab-nearby' },
      H('section', { className:'card', style:{ padding:12, margin:'12px 0 16px' } },
        H('div', { className:'row nearby-filter', style:{ gap:10, alignItems:'center', flexWrap:'wrap' } },
          H('input', {
            type:'search',
            placeholder:'Search nearby listings...',
            value: search,
            onChange: e => setSearch(e.target.value),
            style:{ flex:'1 1 220px', minWidth:180 }
          }),
          H('select', {
            value: sort,
            onChange: e => setSort(e.target.value),
            style:{ width:'auto' }
          },
            H('option', { value:'new' }, 'Newest'),
            H('option', { value:'price_asc' }, 'Price: Low -> High'),
            H('option', { value:'price_desc' }, 'Price: High -> Low')
          ),
          H('label', { htmlFor:'radius' }, 'Filter radius:'),
          H('select', {
            id:'radius',
            value: radius,
            onChange: e => setRadius(Number(e.target.value)),
            style:{ width:'auto' }
          },
            H('option', { value:150 }, '~500 ft'),
            H('option', { value:402 }, '0.25 mi'),
            H('option', { value:805 }, '0.5 mi'),
            H('option', { value:1609 }, '1 mi')
          ),
          H('button', { className:'btn', onClick: () => load(true), disabled:busy }, busy ? 'Refreshing...' : 'Reload'),
          lastUpdatedLabel && H('span', { className:'muted', style:{ marginLeft:'auto', fontSize:11 } }, lastUpdatedLabel)
        ),

      errorMsg && H('div', { className:'muted', style:{ color:'#b91c1c', marginTop:8, fontSize:12 } }, errorMsg),

      H('section', {
        className:'nearby-grid',
        style:{
          display:'grid',
          gridTemplateColumns:`repeat(${columns}, minmax(0, 1fr))`,
          gap:gridGap
        }
      },
        filteredItems.map(item => {
          const cover = selectPrimaryListingImage(item, item?.image_data);
          return H('div', { key:item.id, className:'card', style:{ padding:0, overflow:'hidden', borderRadius:8 } },
            H('div', { style:{ position:'relative', width:'100%', aspectRatio:'1 / 1', background:'#f3f4f6' } },
              cover && H(ImageWithSkeleton, {
                src: cover,
                loading:'lazy',
                decoding:'async',
                onClick: (evt) => handleSelectListingFromEvent(evt, item, cover),
                style:{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:'block', cursor:'pointer' },
                disableSkeleton: true
              })
            )
          );
        })
      ),

      (filteredItems.length === 0 && items.length > 0 && !busy && !errorMsg) &&
        H('p', { className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No nearby listings match your search.'),

      (!items.length && !busy && !errorMsg) && H('p', { className:'muted', style:{ textAlign:'center', margin:'28px 0' } }, 'No nearby listings found in this radius.'),

      H(ListingModal, {
        open: !!selected,
        item: selected,
        onClose: () => setSelected(null),
        cardProps: {
          user,
          canEdit: !!mineById[selected?.id],
          onEdit: handleEdit,
          onDelete,
          onMessage,
          onAdminDelete,
          showDistance: true,
          onViewSeller,
          onToggleSold
        }
      })
      )
    );
  }

  // --- Profile Panel (unchanged; defined to avoid "ProfilePanel is not defined") ---
  function ProfilePanel({
    user, items, onNewListing, onEdit, onDelete, onLogout, onAdminDelete,
    autoListEnabled, setAutoListEnabled,
    aiDescriptionEnabled, setAiDescriptionEnabled,
    autoPostNearbyEnabled, setAutoPostNearbyEnabled,
    isMobile,
    onViewSeller, // ADD THIS PARAMETER
    onToggleSold
  }) {
    const [helpModal, setHelpModal] = useState(null);
    const [profileSelected, setProfileSelected] = useState(null);

    const handleEdit = useCallback((it) => {
      setProfileSelected(null);
      onEdit?.(it);
    }, [onEdit]);

    const handleDelete = useCallback(async (it) => {
      if (onDelete) await onDelete(it);
      setProfileSelected(null);
    }, [onDelete]);

    const handleAdminDelete = useCallback(async (id) => {
      if (onAdminDelete) await onAdminDelete(id);
      setProfileSelected(null);
    }, [onAdminDelete]);
    const [profileTab, setProfileTab] = useState('active');

    const [paypalEmail, setPaypalEmail] = useState(user?.paypal_email || '');
    async function savePaypal() {
      const r = await api.updatePaypalEmail((paypalEmail || '').trim());
      if (r?.error) { alert(r.error); return; }
      // refresh global user so Messages sees the latest email
      const me = await api.me({ silent:true });
      AppNav.setUser(me);
      alert('Saved.');
    }

    if (!user) {
      return H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
        H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 'Profile'),
        H('div', { className: 'muted' }, 'Please log in to view your profile.')
      );
    }

    const activeItems = asArray(items).filter(it => !it?.sold);
    const soldItems = asArray(items).filter(it => !!it?.sold);
    const shownItems = profileTab === 'sold' ? soldItems : activeItems;

    return H(React.Fragment, null,
      H('section', { className:'card', style:{ padding:16, margin:'12px 0 16px' } },
        H('div', { className:'row', style:{ justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 } },
          H('div', null,
            H('div', { style:{ fontWeight:800, fontSize:18 } }, user.username ? `@${user.username}` : user.email),
            H('div', { className:'muted' }, 'Your account')
          ),
          // Right controls: Auto-list toggle - New listing - Log out
          H('div', { className:'row', style:{ gap:12, alignItems:'center', flexWrap:'wrap' } },
            H('label', { className:'toggle-card', style:{ padding:'6px 10px' } },
              H('input', {
                type:'checkbox',
                className:'toggle-input',
                checked: !!autoListEnabled,
                onChange: (e) => setAutoListEnabled(e.target.checked)
              }),
              H('span', { className:'toggle-slider', 'aria-hidden': true }),
              H('div', { className:'toggle-copy' },
                H('div', { style:{ fontWeight:700 } }, 'Auto-list'),
                H('div', { className:'muted', style:{ fontSize:12 } }, 'new uploads')
              ),
              H('button', {
                type:'button',
                onClick: (e) => { e.preventDefault(); e.stopPropagation(); setHelpModal('auto'); },
                title:'About Auto-list',
                style:{
                  marginLeft:6, width:24, height:24, lineHeight:'22px',
                  borderRadius:12, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer'
                }
              }, '?')
            ),
            H('label', { className:'toggle-card', style:{ padding:'6px 10px' } },
              H('input', {
                type:'checkbox',
                className:'toggle-input',
                checked: !!aiDescriptionEnabled,
                onChange: (e) => setAiDescriptionEnabled(e.target.checked)
              }),
              H('span', { className:'toggle-slider', 'aria-hidden': true }),
              H('div', { className:'toggle-copy' },
                H('div', { style:{ fontWeight:700 } }, 'AI descriptions'),
                H('div', { className:'muted', style:{ fontSize:12 } }, 'fill description for you')
              ),
              H('button', {
                type:'button',
                onClick: (e) => { e.preventDefault(); e.stopPropagation(); setHelpModal('ai'); },
                title:'AI description tips',
                style:{
                  marginLeft:6, width:24, height:24, lineHeight:'22px',
                  borderRadius:12, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer'
                }
              }, '?')
            ),
            H('button', { className:'btn', onClick:onNewListing }, 'New listing'),
            H('button', { className:'btn danger', onClick:onLogout }, 'Log out')
          )
        ),

        // Slide-out child when parent is on (mobile-only)
        (isMobile && H('div', {
            style: {
              marginTop: 10,
              overflow: 'hidden',
              maxHeight: autoListEnabled ? 120 : 0,
              transition: 'max-height 220ms ease'
            }
          },
            H('label', {
              className:'toggle-card',
              style:{ gap:8, alignItems:'flex-start', padding:'8px 10px', border:'1px dashed #e5e7eb', borderRadius:12, background:'#fafafa' },
              'data-disabled': !autoListEnabled ? 'true' : undefined
            },
              H('input', {
                type:'checkbox',
                className:'toggle-input',
                checked: !!autoPostNearbyEnabled,
                onChange: (e) => setAutoPostNearbyEnabled(e.target.checked),
                disabled: !autoListEnabled
              }),
              H('span', { className:'toggle-slider', 'aria-hidden': true }),
              H('div', { className:'toggle-copy' },
                H('div', { style:{ fontWeight:700 } }, 'Also post to Nearby'),
                H('div', { className:'muted', style:{ fontSize:12 } }, 'Auto-created items will be discoverable in Nearby (asks for your location once).')
              )
            )
          ))),
      H('section', null,
        H('div', { className:'row', style:{ justifyContent:'space-between', margin:'0 0 12px', flexWrap:'wrap' } },
          H('section', { style:{ marginTop:12 } },
            H('label', null, 'PayPal email'),
            H('div', { className:'row', style:{ gap:8, alignItems:'center', flexWrap:'wrap' } },
              H('input', {
                value: paypalEmail,
                onChange: e => setPaypalEmail(e.target.value),
                placeholder: 'name@example.com',
                style:{ minWidth: 260 }
              }),
              H('button', { className:'btn', onClick: savePaypal }, 'Save')
            ),
            H('div', { className:'muted', style:{ fontSize:12, marginTop:4 } },
              'When you press "Reveal PayPal address" in a DM, the email you save here will be sent as a normal message.'
            )
          ),

          H('div', { style:{ fontWeight:800 } }, `Your listings`),
          H('div', { className:'muted' }, `Active ${activeItems.length} - Sold ${soldItems.length}`)
        ),
        H('div', { className:'row', style:{ gap:8, margin:'0 0 16px' } },
          H('button', {
            className: `btn ${profileTab === 'active' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setProfileTab('active')
          }, 'Active listings'),
          H('button', {
            className: `btn ${profileTab === 'sold' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setProfileTab('sold')
          }, 'Sold listings')
        ),
        (shownItems.length
          ? (() => {
              const COLS = isMobile ? 3 : 4;
              const GAP = 12;
              return H('section', {
                style: {
                  display: 'grid',
                  gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                  gap: GAP
                }
              },
                shownItems.map(it => {
                  const src = it.image_data || '';
                  return H('div', {
                    key: it.id,
                    className: 'card',
                    style: { padding: 0, overflow: 'hidden', borderRadius: 8, cursor: 'pointer' },
                    onClick: () => setProfileSelected(it)
                  },
                    H('div', {
                      style: {
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '1 / 1',
                        background: '#f3f4f6'
                      }
                    },
                      src ? H(ImageWithSkeleton, {
                        src,
                        alt: it.title || 'Item',
                        loading: 'lazy',
                        decoding: 'async',
                        fetchPriority: 'low',
                        style: {
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block'
                        },
                        disableSkeleton: true
                      }) : H('div', {
                        style: {
                          position: 'absolute',
                          inset: 0,
                          display: 'grid',
                          placeItems: 'center',
                          color: '#6b7280',
                          fontWeight: 600
                        }
                      }, 'No image'),
                      it.sold ? H('div', {
                        style: {
                          position: 'absolute',
                          top: '22%',
                          left: '50%',
                          transform: 'translateX(-50%) rotate(-12deg)',
                          background: 'rgba(5, 150, 105, 0.92)',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 20,
                          letterSpacing: 4,
                          textTransform: 'uppercase',
                          padding: '6px 24px',
                          borderRadius: 999,
                          pointerEvents: 'none',
                          boxShadow: '0 8px 18px rgba(4,120,87,0.35)'
                        }
                      }, 'Sold') : null
                    )
                  );
                })
              );
            })()
          : H('p', {
              className:'muted',
              style:{ textAlign:'center', margin:'28px 0' }
            }, profileTab === 'sold' ? 'No sold listings yet.' : 'No listings yet. Create your first one!')
        )
      ),

      helpModal === 'auto' && H(AutoListHelpModal, { onClose: () => setHelpModal(null) }),
      helpModal === 'ai' && H(AiDescriptionHelpModal, { onClose: () => setHelpModal(null) }),

      H(ListingModal, {
        open: !!profileSelected,
        item: profileSelected,
        onClose: () => setProfileSelected(null),
        cardProps: {
          user,
          canEdit: true,
          onEdit: handleEdit,
          onDelete: handleDelete,
          onAdminDelete: handleAdminDelete,
          onViewSeller,
          onToggleSold,
          showDistance: false
        }
      })
    );
  }

  // ---------- App ----------
// Add this new component BEFORE the ListingForm component definition
// --- Listing Form Modal ---
// --- Listing Form Modal ---
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
















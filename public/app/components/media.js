(() => {
  function createMediaComponents({ React, ReactDOM }) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Media components require React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Media components require ReactDOM.');
    }

    const {
      useState,
      useEffect,
      useMemo,
      useCallback,
      useRef
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const RESPONSIVE_WIDTHS = [320, 480, 640, 960, 1280];
    const PLACEHOLDER_SRC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiNmM2Y0ZjYiLz48L3N2Zz4=';

    const SENSITIVE_IMAGE_QUERY_KEYS = new Set([
      'signature',
      'sig',
      'token',
      'access_token',
      'auth',
      'authorization',
      'expires',
      'expiry',
      'awsaccesskeyid',
      'x-amz-signature',
      'x-amz-credential',
      'x-amz-security-token',
      'x-amz-access-token',
      'x-amz-signedheaders',
      'x-amz-date',
      'x-amz-expires',
      'x-goog-signature',
      'x-goog-credential',
      'x-goog-algorithm',
      'x-goog-date',
      'x-goog-expires',
      'x-goog-signedheaders',
      'key-pair-id',
      'policy'
    ]);

    const SENSITIVE_IMAGE_QUERY_PREFIXES = ['x-amz-', 'x-goog-', 'x-oss-', 'x-ms-'];

    function isLikelySignedAssetUrl(url) {
      if (!url) return false;
      try {
        const params = url.searchParams;
        if (!params) return false;
        for (const key of params.keys()) {
          const lower = key.toLowerCase();
          if (SENSITIVE_IMAGE_QUERY_KEYS.has(lower)) return true;
          if (lower === 'x-amz-meta-iv') return true;
          if (lower.endsWith('_signature') || lower.endsWith('_token')) return true;
          if (lower.endsWith('-signature') || lower.endsWith('-token')) return true;
          if (lower === 'signature' || lower === 'sig') return true;
          if (lower.endsWith('_sig') || lower.endsWith('-sig')) return true;
          if (lower.includes('token')) return true;
          if (SENSITIVE_IMAGE_QUERY_PREFIXES.some(prefix => lower.startsWith(prefix))) return true;
        }
      } catch {
        return false;
      }
      return false;
    }

    function buildSizedUrl(src, width) {
      if (!src || typeof src !== 'string') return src;
      if (src.startsWith('data:') || src.startsWith('blob:')) return src;
      try {
        const url = new URL(src);
        if (isLikelySignedAssetUrl(url)) return src;
        if (width && Number.isFinite(width)) url.searchParams.set('w', String(width));
        if (!url.searchParams.has('auto')) url.searchParams.set('auto', 'compress');
        return url.toString();
      } catch (_) {
        return src;
      }
    }

    const isIOSWebView = (() => {
      if (typeof navigator === 'undefined') return false;
      const ua = navigator.userAgent || '';
      const isIOS = /(iPad|iPhone|iPod)/i.test(ua);
      const isWebView = typeof window !== 'undefined' && !!window.webkit?.messageHandlers;
      return isIOS && isWebView;
    })();

    function ImageWithSkeleton({
      className,
      wrapperClassName,
      wrapperStyle,
      skeletonClassName = 'image-skeleton',
      skeletonStyle,
      onLoad,
      onError,
      style,
      disableSkeleton = false,
      width,
      ...imgProps
    }) {
      const [loaded, setLoaded] = useState(false);
      const [failed, setFailed] = useState(false);
      const imgRef = useRef(null);

      const optimizedSrc = useMemo(() => {
        if (!imgProps.src) return imgProps.src;
        return width ? buildSizedUrl(imgProps.src, width) : imgProps.src;
      }, [imgProps.src, width]);

      useEffect(() => {
        setLoaded(false);
        setFailed(false);
      }, [optimizedSrc]);

      // Fix for Safari/Cached images: check if image is already complete
      useEffect(() => {
        if (imgRef.current && imgRef.current.complete) {
          if (imgRef.current.naturalWidth === 0) {
            // It's complete but broken
            setFailed(true);
          } else {
            setLoaded(true);
          }
        }
      }, [optimizedSrc]);

      const handleLoad = useCallback((event) => {
        setLoaded(true);
        if (typeof onLoad === 'function') onLoad(event);
      }, [onLoad]);

      const handleError = useCallback((event) => {
        setFailed(true);
        if (typeof onError === 'function') onError(event);
      }, [onError]);

      const showSkeleton = !disableSkeleton && !!optimizedSrc && !loaded && !failed;

      const computedWrapperStyle = useMemo(() => {
        const base = { lineHeight: 0, ...wrapperStyle };
        if (!isIOSWebView) {
          base.contentVisibility = 'auto';
          base.containIntrinsicSize = '300px';
        }
        const pos = style?.position;

        if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') {
          base.position = pos;
          if (style?.top !== undefined && base.top === undefined) base.top = style.top;
          if (style?.right !== undefined && base.right === undefined) base.right = style.right;
          if (style?.bottom !== undefined && base.bottom === undefined) base.bottom = style.bottom;
          if (style?.left !== undefined && base.left === undefined) base.left = style.left;
          if (style?.inset !== undefined && base.inset === undefined) base.inset = style.inset;
        } else if (pos != null && base.position === undefined) {
          base.position = pos;
        }

        if (style?.display !== undefined && base.display === undefined) base.display = style.display;

        if (style?.width !== undefined && base.width === undefined) base.width = style.width;
        if (style?.height !== undefined && base.height === undefined) base.height = style.height;
        if (style?.maxWidth !== undefined && base.maxWidth === undefined) base.maxWidth = style.maxWidth;
        if (style?.maxHeight !== undefined && base.maxHeight === undefined) base.maxHeight = style.maxHeight;
        if (style?.minWidth !== undefined && base.minWidth === undefined) base.minWidth = style.minWidth;
        if (style?.minHeight !== undefined && base.minHeight === undefined) base.minHeight = style.minHeight;
        if (style?.cursor !== undefined && base.cursor === undefined) base.cursor = style.cursor;

        if (style?.borderRadius != null && base.borderRadius == null) base.borderRadius = style.borderRadius;
        if (base.borderRadius != null && !base.overflow) base.overflow = 'hidden';

        return base;
      }, [style, wrapperStyle]);

      const computedSkeletonStyle = useMemo(() => {
        if (style?.borderRadius != null) {
          return { borderRadius: style.borderRadius, ...skeletonStyle };
        }
        return skeletonStyle;
      }, [style?.borderRadius, skeletonStyle]);

      const wrapperClass = wrapperClassName
        ? `image-shell ${wrapperClassName}`
        : 'image-shell';

      if (failed) {
        return H('span', { className: wrapperClass, style: computedWrapperStyle },
          H('div', {
            style: {
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f3f4f6',
              color: '#9ca3af',
              fontSize: '24px'
            }
          }, '!')
        );
      }

      return H('span', { className: wrapperClass, style: computedWrapperStyle },
        H('img', { ...imgProps, loading: imgProps.loading || 'lazy', ref: imgRef, src: optimizedSrc, width, className, style, onLoad: handleLoad, onError: handleError }),
        showSkeleton ? H('div', { className: skeletonClassName, style: computedSkeletonStyle, 'aria-hidden': true }) : null
      );
    }

    function ResponsiveImage({
      src,
      alt = '',
      widths = RESPONSIVE_WIDTHS,
      sizes = '(min-width: 1024px) 280px, (min-width: 640px) 50vw, 90vw',
      loading = 'lazy',
      decoding = 'async',
      fetchPriority = 'auto',
      style,
      className,
      onClick,
      wrapperClassName,
      wrapperStyle,
      skeletonClassName,
      skeletonStyle,
      ...imgProps
    }) {
      const safeSrc = src || PLACEHOLDER_SRC;
      const hasResponsive = Array.isArray(widths) && widths.length > 0 && typeof safeSrc === 'string' && !safeSrc.startsWith('data:') && !safeSrc.startsWith('blob:');
      const srcSet = hasResponsive
        ? widths.map((w) => `${buildSizedUrl(safeSrc, w)} ${w}w`).join(', ')
        : undefined;
      const defaultSrc = hasResponsive ? buildSizedUrl(safeSrc, widths[widths.length - 1]) : safeSrc;

      return H(ImageWithSkeleton, {
        src: defaultSrc,
        srcSet,
        sizes: srcSet ? sizes : undefined,
        alt,
        loading,
        decoding,
        fetchPriority,
        style,
        className,
        onClick,
        wrapperClassName,
        wrapperStyle,
        skeletonClassName,
        skeletonStyle,
        ...imgProps
      });
    }

    function Lightbox({ open, images, fallback, index, onClose, onIndex, loading = false }) {
      const esc = (e) => { if (e.key === 'Escape') onClose(); };
      useEffect(() => { if (open) { window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); } }, [open, onClose]);

      const display = Array.isArray(images) && images.length ? images : (Array.isArray(fallback) ? fallback : []);
      const len = display.length;
      const safeIndex = len ? Math.min(Math.max(index, 0), len - 1) : 0;
      const canNavigate = len > 1 && typeof onIndex === 'function';

      useEffect(() => {
        if (!open || !len) return;
        if (index < 0 || index >= len) onIndex?.(0);
      }, [open, len, index, onIndex]);

      const mainContent = len
        ? H('div', { className: 'lightbox-main' },
          H(ResponsiveImage, {
            src: display[safeIndex] || display[0],
            alt: 'Image ' + (safeIndex + 1),
            widths: [480, 720, 1080, 1440],
            sizes: '100vw',
            loading: 'eager',
            fetchPriority: 'high',
            className: 'lightbox-img'
          })
        )
        : H('div', {
          className: 'lightbox-empty'
        }, loading ? 'Loading images...' : 'No images available');

      const thumbs = len && typeof onIndex === 'function'
        ? H('div', { className: 'lightbox-thumbs' },
          ...display.map((img, i) => H(ImageWithSkeleton, {
            key: i,
            src: img,
            className: i === safeIndex ? 'active' : '',
            onClick: () => onIndex(i)
          }))
        )
        : null;

      if (!open) return null;

      const modal = H('div', {
        className: 'lightbox-overlay',
        onClick: (e) => { if (e.target === e.currentTarget) onClose(); }
      },
        H('div', { className: 'lightbox-content', role: 'dialog', 'aria-modal': true },
          H('button', { className: 'lightbox-close', onClick: onClose, 'aria-label': 'Close image' }, 'X'),
          H('div', { className: 'lightbox-stage' },
            canNavigate ? H('button', { className: 'lightbox-arrow left', onClick: () => onIndex((safeIndex - 1 + len) % len), 'aria-label': 'Previous image' }, '<') : null,
            mainContent,
            canNavigate ? H('button', { className: 'lightbox-arrow right', onClick: () => onIndex((safeIndex + 1) % len), 'aria-label': 'Next image' }, '>') : null
          ),
          thumbs,
          loading && len ? H('div', { className: 'lightbox-info' }, 'Loading...') : null
        )
      );

      return ReactDOM.createPortal(modal, document.body);
    }

    return {
      Lightbox,
      ImageWithSkeleton,
      ResponsiveImage
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.media = {
    createMediaComponents
  };
})();

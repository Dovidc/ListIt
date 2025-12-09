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
      maxRetries = 2,
      ...imgProps
    }) {
      const [loaded, setLoaded] = useState(false);
      const [failed, setFailed] = useState(false);
      const [retryCount, setRetryCount] = useState(0);
      const imgRef = useRef(null);
      const retryTimerRef = useRef(null);

      const optimizedSrc = useMemo(() => {
        if (!imgProps.src) return imgProps.src;
        return width ? buildSizedUrl(imgProps.src, width) : imgProps.src;
      }, [imgProps.src, width]);

      useEffect(() => {
        setLoaded(false);
        setFailed(false);
        setRetryCount(0);
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
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
        setFailed(false);
        if (typeof onLoad === 'function') onLoad(event);
      }, [onLoad]);

      const handleError = useCallback((event) => {
        if (retryCount < maxRetries) {
          // Retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
          retryTimerRef.current = setTimeout(() => {
            setRetryCount(c => c + 1);
            // Force reload by clearing and resetting src
            if (imgRef.current) {
              const src = imgRef.current.src;
              imgRef.current.src = '';
              imgRef.current.src = src;
            }
          }, delay);
        } else {
          setFailed(true);
          if (typeof onError === 'function') onError(event);
        }
      }, [onError, retryCount, maxRetries]);

      // Cleanup retry timer on unmount
      useEffect(() => {
        return () => {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        };
      }, []);

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
      const hasResponsive = Array.isArray(widths) && widths.length > 0 && typeof src === 'string' && !src.startsWith('data:') && !src.startsWith('blob:');
      const srcSet = hasResponsive
        ? widths.map((w) => `${buildSizedUrl(src, w)} ${w}w`).join(', ')
        : undefined;
      const defaultSrc = hasResponsive ? buildSizedUrl(src, widths[widths.length - 1]) : src;

      return H(ImageWithSkeleton, {
        src: defaultSrc || src,
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

      // Zoom state
      const [zoom, setZoom] = useState(1);
      const [pan, setPan] = useState({ x: 0, y: 0 });
      const [isDragging, setIsDragging] = useState(false);
      const containerRef = useRef(null);
      const touchStartRef = useRef(null);
      const lastPinchDistRef = useRef(null);
      const isPanningRef = useRef(false);
      const lastPanRef = useRef({ x: 0, y: 0 });
      const mouseStartRef = useRef(null);

      // Reset zoom when image changes or lightbox closes
      useEffect(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }, [safeIndex, open]);

      useEffect(() => {
        if (!open || !len) return;
        if (index < 0 || index >= len) onIndex?.(0);
      }, [open, len, index, onIndex]);

      // Pinch-to-zoom for mobile
      const handleTouchStart = useCallback((e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
          isPanningRef.current = false;
        } else if (e.touches.length === 1 && zoom > 1) {
          e.preventDefault();
          isPanningRef.current = true;
          touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          lastPanRef.current = { ...pan };
        }
      }, [zoom, pan]);

      const handleTouchMove = useCallback((e) => {
        if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const scale = dist / lastPinchDistRef.current;
          setZoom(z => Math.min(Math.max(z * scale, 1), 5));
          lastPinchDistRef.current = dist;
        } else if (e.touches.length === 1 && isPanningRef.current && touchStartRef.current && zoom > 1) {
          e.preventDefault();
          const dx = e.touches[0].clientX - touchStartRef.current.x;
          const dy = e.touches[0].clientY - touchStartRef.current.y;
          setPan({
            x: lastPanRef.current.x + dx,
            y: lastPanRef.current.y + dy
          });
        }
      }, [zoom]);

      const handleTouchEnd = useCallback((e) => {
        if (e.touches.length < 2) {
          lastPinchDistRef.current = null;
        }
        if (e.touches.length === 0) {
          isPanningRef.current = false;
          touchStartRef.current = null;
          // Reset pan if zoom is back to 1
          if (zoom <= 1) {
            setPan({ x: 0, y: 0 });
          }
        }
      }, [zoom]);

      // Mouse drag for desktop
      const handleMouseDown = useCallback((e) => {
        if (zoom > 1 && e.button === 0) {
          e.preventDefault();
          setIsDragging(true);
          mouseStartRef.current = { x: e.clientX, y: e.clientY };
          lastPanRef.current = { ...pan };
        }
      }, [zoom, pan]);

      const handleMouseMove = useCallback((e) => {
        if (isDragging && mouseStartRef.current && zoom > 1) {
          e.preventDefault();
          const dx = e.clientX - mouseStartRef.current.x;
          const dy = e.clientY - mouseStartRef.current.y;
          setPan({
            x: lastPanRef.current.x + dx,
            y: lastPanRef.current.y + dy
          });
        }
      }, [isDragging, zoom]);

      const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        mouseStartRef.current = null;
      }, []);

      // Attach mouse move/up to window when dragging
      useEffect(() => {
        if (isDragging) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
          return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
          };
        }
      }, [isDragging, handleMouseMove, handleMouseUp]);

      // Scroll-to-zoom for desktop
      const handleWheel = useCallback((e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(z => {
          const newZoom = Math.min(Math.max(z * delta, 1), 5);
          if (newZoom <= 1) {
            setPan({ x: 0, y: 0 });
          }
          return newZoom;
        });
      }, []);

      // Double-tap/click to toggle zoom
      const lastTapRef = useRef(0);
      const handleDoubleTap = useCallback((e) => {
        if (isDragging) return; // Don't toggle zoom if we were dragging
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          e.preventDefault();
          if (zoom > 1) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            setZoom(2.5);
          }
        }
        lastTapRef.current = now;
      }, [zoom, isDragging]);

      const mainContent = len
        ? H('div', {
            className: 'lightbox-main',
            ref: containerRef,
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
            onWheel: handleWheel,
            onClick: handleDoubleTap,
            style: { touchAction: 'none', overflow: 'hidden', userSelect: 'none' }
          },
          H(ResponsiveImage, {
            src: display[safeIndex] || display[0],
            alt: 'Image ' + (safeIndex + 1),
            widths: [480, 720, 1080, 1440],
            sizes: '100vw',
            loading: 'eager',
            fetchPriority: 'high',
            className: 'lightbox-img',
            style: {
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: zoom === 1 ? 'transform 0.2s ease-out' : 'none',
              cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              pointerEvents: 'none'
            }
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
          zoom > 1 && H('div', {
            style: {
              position: 'absolute',
              bottom: thumbs ? 80 : 20,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 16,
              fontSize: 12,
              pointerEvents: 'none'
            }
          }, `${Math.round(zoom * 100)}%`),
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

const ReactGlobal = typeof React !== 'undefined' ? React : null;
const createElement = ReactGlobal?.createElement?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useMemo = ReactGlobal?.useMemo?.bind(ReactGlobal) ?? null;
const useCallback = ReactGlobal?.useCallback?.bind(ReactGlobal) ?? null;

function ensureReact() {
  if (!createElement || !useState || !useEffect || !useMemo || !useCallback) {
    throw new Error('ImageWithSkeleton requires React to be loaded globally.');
  }
}

const H = (...args) => createElement(...args);

export function ImageWithSkeleton({
  className,
  wrapperClassName,
  wrapperStyle,
  skeletonClassName = 'image-skeleton',
  skeletonStyle,
  onLoad,
  onError,
  style,
  disableSkeleton = false,
  ...imgProps
}) {
  ensureReact();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [imgProps.src]);

  const handleLoad = useCallback((event) => {
    setLoaded(true);
    if (typeof onLoad === 'function') onLoad(event);
  }, [onLoad]);

  const handleError = useCallback((event) => {
    setFailed(true);
    if (typeof onError === 'function') onError(event);
  }, [onError]);

  const showSkeleton = !disableSkeleton && !!imgProps.src && !loaded && !failed;

  const computedWrapperStyle = useMemo(() => {
    const base = { lineHeight: 0, ...wrapperStyle };
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

  return H('span', { className: wrapperClass, style: computedWrapperStyle },
    H('img', { ...imgProps, className, style, onLoad: handleLoad, onError: handleError }),
    showSkeleton ? H('div', { className: skeletonClassName, style: computedSkeletonStyle, 'aria-hidden': true }) : null
  );
}

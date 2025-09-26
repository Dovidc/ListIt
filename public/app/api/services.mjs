import {
  React,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from '../shared/runtime.mjs';

function safeInvoke(fn) {
  try {
    fn?.();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('ListIt service handler failed', error);
  }
}

const ServicesContext = React.createContext(null);

export function ServicesProvider({ children }) {
  const [loadingCount, setLoadingCount] = useState(0);
  const unauthorizedHandlersRef = useRef(new Set());
  const lockedHandlersRef = useRef(new Set());
  const apiRef = useRef(null);
  const helpersRef = useRef({ formatCurrency: null, formatDistance: null, haversineMeters: null });

  if (!apiRef.current) {
    const core = window.ListItCore || {};
    const {
      createApiClient,
      formatCurrency,
      formatDistance,
      haversineMeters
    } = core;

    if (typeof createApiClient !== 'function') {
      throw new Error('ListIt core bundle failed to load.');
    }

    helpersRef.current = {
      formatCurrency: typeof formatCurrency === 'function' ? formatCurrency : null,
      formatDistance: typeof formatDistance === 'function' ? formatDistance : null,
      haversineMeters: typeof haversineMeters === 'function' ? haversineMeters : null
    };

    apiRef.current = createApiClient({
      onRequestStart: () => setLoadingCount((count) => count + 1),
      onRequestEnd: () => setLoadingCount((count) => Math.max(0, count - 1)),
      onUnauthorized: () => {
        unauthorizedHandlersRef.current.forEach((handler) => safeInvoke(handler));
      },
      onAccountLocked: () => {
        lockedHandlersRef.current.forEach((handler) => safeInvoke(handler));
      }
    });
  }

  const registerUnauthorized = useCallback((handler) => {
    if (typeof handler !== 'function') return () => {};
    const set = unauthorizedHandlersRef.current;
    set.add(handler);
    return () => set.delete(handler);
  }, []);

  const registerLocked = useCallback((handler) => {
    if (typeof handler !== 'function') return () => {};
    const set = lockedHandlersRef.current;
    set.add(handler);
    return () => set.delete(handler);
  }, []);

  const value = useMemo(() => {
    const { formatCurrency, formatDistance, haversineMeters } = helpersRef.current;
    const fallbackCurrency = (value) => {
      const numeric = Number(value || 0);
      return `\u0024${numeric.toFixed(2)}`;
    };
    const fallbackDistance = (meters) => {
      const numeric = Number(meters || 0);
      if (!Number.isFinite(numeric) || numeric <= 0) return '';
      if (numeric < 1000) return `${Math.round(numeric)} m`;
      return `${Math.round(numeric / 100) / 10} km`;
    };
    const fallbackHaversine = () => 0;

    return {
      api: apiRef.current,
      formatCurrency: formatCurrency || fallbackCurrency,
      formatDistance: formatDistance || fallbackDistance,
      haversineMeters: haversineMeters || fallbackHaversine,
      loadingCount,
      onUnauthorized: registerUnauthorized,
      onAccountLocked: registerLocked
    };
  }, [loadingCount, registerLocked, registerUnauthorized]);

  return createElement(ServicesContext.Provider, { value }, children);
}

export function useServices() {
  const context = useContext(ServicesContext);
  if (!context) {
    throw new Error('useServices must be used within a ServicesProvider');
  }
  return context;
}

import {
  React,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from '../shared/runtime.mjs';
import { useServices } from '../api/services.mjs';
import { useAuth } from '../auth/AuthContext.mjs';

const DEFAULT_FILTERS = {
  query: '',
  location: '',
  sort: 'new'
};

const ListingsContext = React.createContext(null);

function normalizeListingsResponse(res, limit = 75) {
  let rows = [];
  if (Array.isArray(res)) rows = res;
  else if (res && typeof res === 'object') {
    if (Array.isArray(res.rows)) rows = res.rows;
    else if (Array.isArray(res.items)) rows = res.items;
    else if (Array.isArray(res.listings)) rows = res.listings;
    else if (Array.isArray(res.data)) rows = res.data;
  }
  let hasNext = false;
  let nextCursor = null;
  if (res && typeof res === 'object') {
    if (typeof res.hasNext === 'boolean') hasNext = res.hasNext;
    else if (typeof res.next === 'boolean') hasNext = res.next;
    else if (Number.isFinite(res.total) && Number.isFinite(res.page)) {
      const shown = (res.page - 1) * limit + rows.length;
      hasNext = shown < res.total;
    } else {
      hasNext = rows.length === limit;
    }
    if (res.next_cursor != null) nextCursor = res.next_cursor;
    else if (res.cursor != null) nextCursor = res.cursor;
  } else {
    hasNext = rows.length === limit;
  }
  return { rows, hasNext, nextCursor };
}

function extractNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hydrateListing(raw, helpers) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.listing_id ?? raw.ID ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const priceValue = raw.price_cents != null
    ? extractNumber(raw.price_cents) / 100
    : extractNumber(raw.price);
  const distanceValue = extractNumber(raw.distance_m ?? raw.distance);
  const cover = [raw.image_url, raw.image_data, raw.thumb_url, raw.cover].find((value) => typeof value === 'string' && value.trim());
  return {
    ...raw,
    id,
    price_value: priceValue,
    price_label: helpers.formatCurrency(priceValue),
    distance_m: distanceValue,
    distance_label: distanceValue > 0 ? helpers.formatDistance(distanceValue) : '',
    cover: cover || ''
  };
}

export function ListingsProvider({ children }) {
  const services = useServices();
  const { api } = services;
  const { user } = useAuth();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [listings, setListings] = useState([]);
  const [mine, setMine] = useState([]);
  const [status, setStatus] = useState('idle');
  const [hasNext, setHasNext] = useState(false);
  const cursorRef = useRef(null);
  const lastQueryRef = useRef(null);

  const helpers = useMemo(() => ({
    formatCurrency: services.formatCurrency,
    formatDistance: services.formatDistance
  }), [services.formatCurrency, services.formatDistance]);

  const refreshAll = useCallback(async (overrideFilters) => {
    const params = { ...filters, ...(overrideFilters || {}) };
    const requestParams = {
      q: params.query?.trim() || '',
      loc: params.location?.trim() || '',
      sort: params.sort || 'new',
      page: 1,
      limit: 75
    };
    setStatus('loading');
    try {
      const response = await api.listAll(requestParams);
      const normalized = normalizeListingsResponse(response, requestParams.limit);
      const hydrated = normalized.rows.map((row) => hydrateListing(row, helpers)).filter(Boolean);
      cursorRef.current = normalized.nextCursor ?? null;
      lastQueryRef.current = requestParams;
      setListings(hydrated);
      setHasNext(Boolean(normalized.hasNext));
      setStatus('ready');
      return hydrated;
    } catch (error) {
      setStatus('error');
      throw error;
    }
  }, [api, filters, helpers]);

  const loadNext = useCallback(async () => {
    if (!hasNext) return [];
    const lastParams = lastQueryRef.current || {
      q: filters.query?.trim() || '',
      loc: filters.location?.trim() || '',
      sort: filters.sort || 'new',
      limit: 75
    };
    setStatus('loading-more');
    try {
      const response = await api.listAll({ ...lastParams, cursor: cursorRef.current });
      const normalized = normalizeListingsResponse(response, lastParams.limit);
      cursorRef.current = normalized.nextCursor ?? null;
      setHasNext(Boolean(normalized.hasNext));
      const hydrated = normalized.rows.map((row) => hydrateListing(row, helpers)).filter(Boolean);
      setListings((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const next = [...prev];
        hydrated.forEach((item) => {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            next.push(item);
          }
        });
        return next;
      });
      setStatus('ready');
      return hydrated;
    } catch (error) {
      setStatus('error');
      throw error;
    }
  }, [api, filters, hasNext, helpers]);

  const refreshMine = useCallback(async () => {
    if (!user || user.id == null) {
      setMine([]);
      return [];
    }
    try {
      const response = await api.listMine();
      const normalized = normalizeListingsResponse(response, 75);
      const hydrated = normalized.rows.map((row) => hydrateListing(row, helpers)).filter(Boolean);
      setMine(hydrated);
      return hydrated;
    } catch (error) {
      setMine([]);
      throw error;
    }
  }, [api, user, helpers]);

  useEffect(() => {
    refreshAll();
  }, [filters.query, filters.location, filters.sort, refreshAll]);

  useEffect(() => {
    refreshMine();
  }, [refreshMine]);

  const [selectedListingId, setSelectedListingId] = useState(null);
  const selectedListing = useMemo(() => listings.find((item) => item.id === selectedListingId) || null,
    [listings, selectedListingId]);

  const value = useMemo(() => ({
    filters,
    setFilters,
    listings,
    mine,
    status,
    hasNext,
    selectedListing,
    selectListing: setSelectedListingId,
    refreshAll,
    refreshMine,
    loadNext
  }), [filters, listings, mine, status, hasNext, selectedListing, refreshAll, refreshMine, loadNext]);

  return createElement(ListingsContext.Provider, { value }, children);
}

export function useListings() {
  const context = useContext(ListingsContext);
  if (!context) {
    throw new Error('useListings must be used within a ListingsProvider');
  }
  return context;
}

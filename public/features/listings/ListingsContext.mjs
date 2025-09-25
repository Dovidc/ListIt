import { useAuth } from '../auth/AuthContext.mjs';

const ReactGlobal = typeof React !== 'undefined' ? React : null;
const useCallback = ReactGlobal?.useCallback?.bind(ReactGlobal) ?? null;
const useContext = ReactGlobal?.useContext?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useMemo = ReactGlobal?.useMemo?.bind(ReactGlobal) ?? null;
const useRef = ReactGlobal?.useRef?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;
const createElement = ReactGlobal?.createElement?.bind(ReactGlobal) ?? null;
const createContext = ReactGlobal?.createContext?.bind(ReactGlobal) ?? null;

const ListingsContext = createContext ? createContext(null) : null;

const PAGE_SIZE = 75;

function normalizeListingsResponse(res, limit = PAGE_SIZE) {
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

function listingsArray(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input.rows)) return input.rows;
  if (Array.isArray(input.items)) return input.items;
  if (Array.isArray(input.listings)) return input.listings;
  if (Array.isArray(input.data)) return input.data;
  return [];
}

function ensureReactHooks() {
  return useState && useEffect && useMemo && useRef && useCallback && createElement && ListingsContext;
}

function resolveApi(api) {
  return api || (typeof window !== 'undefined' && window.ListItApi) || null;
}

export function ListingsProvider({ children, api: apiProp }) {
  if (!ensureReactHooks()) {
    throw new Error('ListingsProvider requires React to be loaded globally.');
  }

  const api = resolveApi(apiProp);
  if (!api || typeof api.listAll !== 'function') {
    throw new Error('ListingsProvider requires an api client with a listAll method.');
  }

  let auth;
  try {
    auth = typeof useAuth === 'function' ? useAuth() : { user: null };
  } catch {
    auth = { user: null };
  }
  const user = auth?.user ?? null;

  const [tab, setTab] = useState('browse');
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const [all, setAll] = useState([]);
  const [mine, setMine] = useState([]);
  const [query, setQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [sort, setSort] = useState('new');
  const [ads, setAds] = useState([]);
  const [viewingSeller, setViewingSeller] = useState(null);

  const [hasNext, setHasNext] = useState(false);
  const [isFetchingListings, setIsFetchingListings] = useState(false);
  const sentinelRef = useRef(null);
  const loadingListingsRef = useRef(false);
  const nextCursorRef = useRef(null);
  const reloadReqRef = useRef(0);

  const [selectedListing, setSelectedListing] = useState(null);
  const [editing, setEditing] = useState(null);

  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const [debouncedLocation, setDebouncedLocation] = useState(locationQuery);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedLocation(locationQuery), 500);
    return () => window.clearTimeout(t);
  }, [locationQuery]);

  const [coverById, setCoverById] = useState(() => Object.create(null));

  const ensureCover = useCallback(async (id) => {
    if (id == null || (coverById && Object.prototype.hasOwnProperty.call(coverById, id))) return;
    if (!api || typeof api.getListingImages !== 'function') return;
    try {
      const arr = await api.getListingImages(id, { silent: true });
      let obj = null;
      if (Array.isArray(arr) && arr.length) {
        obj = typeof arr[0] === 'string'
          ? { url: arr[0], w: null, h: null }
          : { url: arr[0]?.url, w: arr[0]?.w ?? null, h: arr[0]?.h ?? null };
      }
      setCoverById((prev) => ({ ...prev, [id]: obj }));
    } catch {
      setCoverById((prev) => ({ ...prev, [id]: null }));
    }
  }, [api, coverById]);

  const reloadMineOnly = useCallback(async () => {
    if (!api || typeof api.listMine !== 'function') {
      setMine([]);
      return;
    }
    if (!user) {
      setMine([]);
      return;
    }
    const mineRes = await api.listMine({ silent: true });
    setMine(listingsArray(mineRes));
  }, [api, user?.id]);

  const loadListingsPage = useCallback(async ({ cursor = null, replace = false } = {}) => {
    const req = ++reloadReqRef.current;
    loadingListingsRef.current = true;
    setIsFetchingListings(true);
    try {
      const res = await api.listAll({
        q: debouncedQuery.trim() || '',
        loc: debouncedLocation.trim() || '',
        cursor,
        limit: PAGE_SIZE,
        sort
      });

      if (req !== reloadReqRef.current) return;

      const { rows, hasNext, nextCursor } = normalizeListingsResponse(res, PAGE_SIZE);
      const newRows = Array.isArray(rows) ? rows : [];
      setHasNext(!!hasNext);

      setAll((prev) => {
        if (replace || cursor == null) return newRows;
        if (!prev || !prev.length) return newRows;
        const existing = new Set(prev.map((r) => r.id));
        const appended = newRows.filter((r) => !existing.has(r.id));
        return appended.length ? [...prev, ...appended] : prev;
      });

      if (cursor == null) {
        await reloadMineOnly();
      }

      if (newRows.length && api.getCoversBatch) {
        try {
          const ids = (cursor == null ? newRows.slice(0, 24) : newRows).map((r) => r.id);
          if (ids.length) {
            const covers = await api.getCoversBatch(ids, { silent: true });
            if (req === reloadReqRef.current && Array.isArray(covers) && covers.length) {
              const patch = {};
              covers.forEach((r) => {
                if (!r || r.id == null) return;
                if (r.image_data) patch[r.id] = { url: r.image_data };
              });
              if (Object.keys(patch).length) {
                setCoverById((prev) => ({ ...prev, ...patch }));
              }
            }
          }
        } catch {
          // ignore cover prefetch errors
        }
      }

      nextCursorRef.current = hasNext ? (nextCursor ?? null) : null;
    } catch (error) {
      if (req === reloadReqRef.current) {
        console.error('load listings failed', error);
        if (replace || cursor == null) setAll([]);
        setHasNext(false);
        if (cursor == null && !user) setMine([]);
      }
    } finally {
      if (req === reloadReqRef.current) {
        loadingListingsRef.current = false;
        setIsFetchingListings(false);
      }
    }
  }, [api, debouncedQuery, debouncedLocation, reloadMineOnly, sort, user?.id]);

  const refreshListings = useCallback(async ({ preserveExisting = false } = {}) => {
    nextCursorRef.current = null;
    if (!preserveExisting) {
      setAll([]);
      setHasNext(false);
    }
    await loadListingsPage({ cursor: null, replace: true });
  }, [loadListingsPage]);

  const toggleSold = useCallback(async (listing, makeSold) => {
    if (!listing || !api || typeof api.markListingSold !== 'function') return;
    try {
      await api.markListingSold(listing.id, makeSold);
      try {
        const mineRes = await api.listMine({ silent: true });
        setMine(listingsArray(mineRes));
      } catch {
        // ignore
      }
      setSelectedListing((prev) => {
        if (prev && prev.id === listing.id) {
          return { ...prev, sold: makeSold ? 1 : 0 };
        }
        return prev;
      });
      if (makeSold) {
        setAll((prev) => Array.isArray(prev) ? prev.filter((it) => it.id !== listing.id) : prev);
      }
      await refreshListings();
    } catch (error) {
      console.error('toggle sold failed', error);
    }
  }, [api, refreshListings]);

  useEffect(() => {
    nextCursorRef.current = null;
    setAll([]);
    setHasNext(false);
    loadListingsPage({ cursor: null, replace: true });
  }, [user?.id, debouncedQuery, debouncedLocation, sort, loadListingsPage]);

  const value = useMemo(
    () => ({
      api,
      tab,
      setTab,
      tabRef,
      all,
      setAll,
      mine,
      setMine,
      query,
      setQuery,
      locationQuery,
      setLocationQuery,
      sort,
      setSort,
      ads,
      setAds,
      viewingSeller,
      setViewingSeller,
      hasNext,
      setHasNext,
      isFetchingListings,
      setIsFetchingListings,
      sentinelRef,
      loadingListingsRef,
      nextCursorRef,
      reloadReqRef,
      selectedListing,
      setSelectedListing,
      editing,
      setEditing,
      debouncedQuery,
      debouncedLocation,
      coverById,
      ensureCover,
      loadListingsPage,
      refreshListings,
      reloadMineOnly,
      toggleSold
    }),
    [
      api,
      tab,
      all,
      mine,
      query,
      locationQuery,
      sort,
      ads,
      viewingSeller,
      hasNext,
      isFetchingListings,
      selectedListing,
      editing,
      debouncedQuery,
      debouncedLocation,
      coverById,
      ensureCover,
      loadListingsPage,
      refreshListings,
      reloadMineOnly,
      toggleSold
    ]
  );

  return createElement(ListingsContext.Provider, { value }, children);
}

export function useListings() {
  if (!useContext || !ListingsContext) {
    throw new Error('useListings requires React to be loaded globally.');
  }
  const ctx = useContext(ListingsContext);
  if (!ctx) {
    throw new Error('useListings must be used within a ListingsProvider');
  }
  return ctx;
}

export function createListingsStateForTest(api = null) {
  const state = {
    api,
    tab: 'browse',
    all: [],
    mine: [],
    query: '',
    locationQuery: '',
    sort: 'new',
    ads: [],
    viewingSeller: null,
    hasNext: false,
    isFetchingListings: false,
    sentinelRef: { current: null },
    loadingListingsRef: { current: false },
    nextCursorRef: { current: null },
    reloadReqRef: { current: 0 },
    selectedListing: null,
    editing: null,
    debouncedQuery: '',
    debouncedLocation: '',
    coverById: Object.create(null),
    nextCursor: null
  };

  const client = api;

  const toArray = (rows) => listingsArray(rows).map((row) => ({ ...row }));

  async function ensureCover(id) {
    if (id == null || (id in state.coverById)) return;
    if (!client || typeof client.getListingImages !== 'function') return;
    try {
      const arr = await client.getListingImages(id, { silent: true });
      let obj = null;
      if (Array.isArray(arr) && arr.length) {
        obj = typeof arr[0] === 'string'
          ? { url: arr[0], w: null, h: null }
          : { url: arr[0]?.url, w: arr[0]?.w ?? null, h: arr[0]?.h ?? null };
      }
      state.coverById = { ...state.coverById, [id]: obj };
    } catch {
      state.coverById = { ...state.coverById, [id]: null };
    }
  }

  async function loadListingsPage({ cursor = null, replace = false } = {}) {
    if (!client || typeof client.listAll !== 'function') return;
    const res = await client.listAll({ cursor, limit: PAGE_SIZE });
    const { rows, hasNext, nextCursor } = normalizeListingsResponse(res, PAGE_SIZE);
    const newRows = Array.isArray(rows) ? rows : [];
    state.hasNext = !!hasNext;
    if (replace || cursor == null) {
      state.all = newRows;
    } else if (Array.isArray(state.all) && state.all.length) {
      const existing = new Set(state.all.map((r) => r.id));
      const appended = newRows.filter((r) => !existing.has(r.id));
      if (appended.length) {
        state.all = [...state.all, ...appended];
      }
    } else {
      state.all = newRows;
    }
    if (cursor == null && client && client.listMine) {
      try {
        const mineRows = await client.listMine({ silent: true });
        state.mine = toArray(mineRows);
      } catch {
        state.mine = [];
      }
    }
    if (newRows.length && client && client.getCoversBatch) {
      try {
        const ids = (cursor == null ? newRows.slice(0, 24) : newRows).map((r) => r.id);
        if (ids.length) {
          const covers = await client.getCoversBatch(ids, { silent: true });
          if (Array.isArray(covers) && covers.length) {
            const patch = {};
            covers.forEach((r) => {
              if (!r || r.id == null) return;
              if (r.image_data) patch[r.id] = { url: r.image_data };
            });
            if (Object.keys(patch).length) {
              state.coverById = { ...state.coverById, ...patch };
            }
          }
        }
      } catch {}
    }
    state.nextCursor = hasNext ? (nextCursor ?? null) : null;
  }

  async function refreshListings({ preserveExisting = false } = {}) {
    if (!client) return;
    if (!preserveExisting) {
      state.all = [];
      state.hasNext = false;
    }
    await loadListingsPage({ cursor: null, replace: true });
  }

  async function reloadMineOnly() {
    if (!client || typeof client.listMine !== 'function') {
      state.mine = [];
      return;
    }
    try {
      const mineRows = await client.listMine({ silent: true });
      state.mine = toArray(mineRows);
    } catch {
      state.mine = [];
    }
  }

  async function toggleSold(listing, makeSold) {
    if (!client || !listing || typeof client.markListingSold !== 'function') return;
    await client.markListingSold(listing.id, makeSold);
    if (makeSold && Array.isArray(state.all)) {
      state.all = state.all.filter((item) => item.id !== listing.id);
    }
    if (state.selectedListing && state.selectedListing.id === listing.id) {
      state.selectedListing = { ...state.selectedListing, sold: makeSold ? 1 : 0 };
    }
  }

  return {
    state,
    setTab: (value) => { state.tab = value; },
    setAll: (rows) => { state.all = Array.isArray(rows) ? rows : []; },
    setMine: (rows) => { state.mine = Array.isArray(rows) ? rows : []; },
    setQuery: (value) => { state.query = value ?? ''; state.debouncedQuery = value ?? ''; },
    setLocationQuery: (value) => { state.locationQuery = value ?? ''; state.debouncedLocation = value ?? ''; },
    setSort: (value) => { state.sort = value ?? 'new'; },
    setAds: (rows) => { state.ads = Array.isArray(rows) ? rows : []; },
    setViewingSeller: (value) => { state.viewingSeller = value ?? null; },
    setHasNext: (value) => { state.hasNext = !!value; },
    setIsFetchingListings: (value) => { state.isFetchingListings = !!value; },
    setSelectedListing: (value) => { state.selectedListing = value ?? null; },
    setEditing: (value) => { state.editing = value ?? null; },
    ensureCover,
    loadListingsPage,
    refreshListings,
    reloadMineOnly,
    toggleSold
  };
}

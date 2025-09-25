const ReactGlobal = typeof React !== 'undefined' ? React : null;
const useContext = ReactGlobal?.useContext?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useMemo = ReactGlobal?.useMemo?.bind(ReactGlobal) ?? null;
const useRef = ReactGlobal?.useRef?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;
const createElement = ReactGlobal?.createElement?.bind(ReactGlobal) ?? null;
const createContext = ReactGlobal?.createContext?.bind(ReactGlobal) ?? null;

const ListingsContext = createContext ? createContext(null) : null;

export function ListingsProvider({ children }) {
  if (!useState || !useEffect || !useMemo || !useRef || !createElement || !ListingsContext) {
    throw new Error('ListingsProvider requires React to be loaded globally.');
  }

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

  const value = useMemo(
    () => ({
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
      debouncedLocation
    }),
    [
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
      debouncedLocation
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

export function createListingsStateForTest() {
  const state = {
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
    debouncedLocation: ''
  };

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
    setEditing: (value) => { state.editing = value ?? null; }
  };
}

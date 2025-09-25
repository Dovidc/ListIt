const {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} = React;

function createInitialWindowFocus() {
  if (typeof document === 'undefined') return true;
  return !document.hidden;
}

const ListingsContext = createContext(null);

function createListingsController() {
  const listeners = new Set();
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
    selectedListing: null,
    editing: null,
    activeConvoId: null,
    windowFocused: createInitialWindowFocus(),
    unreadCount: 0,
    hasAdminUnread: false,
    loadingCount: 0
  };

  const refs = {
    sentinelRef: { current: null },
    loadingListingsRef: { current: false },
    nextCursorRef: { current: null },
    tabRef: { current: 'browse' },
    activeConvoIdRef: { current: null },
    windowFocusedRef: { current: state.windowFocused }
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (_) {}
    });
  };

  const setValue = (key, value) => {
    if (state[key] === value) return;
    state[key] = value;
    notify();
  };

  const controller = {
    refs,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return { ...state };
    },
    setTab(value) {
      refs.tabRef.current = value;
      setValue('tab', value);
    },
    setAll(value) {
      setValue('all', Array.isArray(value) ? value : []);
    },
    setMine(value) {
      setValue('mine', Array.isArray(value) ? value : []);
    },
    setQuery(value) {
      setValue('query', value ?? '');
    },
    setLocationQuery(value) {
      setValue('locationQuery', value ?? '');
    },
    setSort(value) {
      setValue('sort', value ?? 'new');
    },
    setAds(value) {
      setValue('ads', Array.isArray(value) ? value : []);
    },
    setViewingSeller(value) {
      setValue('viewingSeller', value || null);
    },
    setHasNext(value) {
      setValue('hasNext', !!value);
    },
    setIsFetchingListings(value) {
      setValue('isFetchingListings', !!value);
    },
    setSelectedListing(value) {
      setValue('selectedListing', value || null);
    },
    setEditing(value) {
      setValue('editing', value || null);
    },
    setActiveConvoId(value) {
      refs.activeConvoIdRef.current = value;
      setValue('activeConvoId', value || null);
    },
    setWindowFocused(value) {
      refs.windowFocusedRef.current = !!value;
      setValue('windowFocused', !!value);
    },
    setUnreadCount(value) {
      setValue('unreadCount', Number(value) || 0);
    },
    setHasAdminUnread(value) {
      setValue('hasAdminUnread', !!value);
    },
    setLoadingCount(value) {
      setValue('loadingCount', Number(value) || 0);
    }
  };

  return controller;
}

export function ListingsProvider({ children }) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createListingsController();
  }

  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());

  useEffect(() => controller.subscribe(() => {
    setSnapshot(controller.getSnapshot());
  }), [controller]);

  const value = useMemo(() => ({
    tab: snapshot.tab,
    setTab: controller.setTab,
    all: snapshot.all,
    setAll: controller.setAll,
    mine: snapshot.mine,
    setMine: controller.setMine,
    query: snapshot.query,
    setQuery: controller.setQuery,
    locationQuery: snapshot.locationQuery,
    setLocationQuery: controller.setLocationQuery,
    sort: snapshot.sort,
    setSort: controller.setSort,
    ads: snapshot.ads,
    setAds: controller.setAds,
    viewingSeller: snapshot.viewingSeller,
    setViewingSeller: controller.setViewingSeller,
    hasNext: snapshot.hasNext,
    setHasNext: controller.setHasNext,
    isFetchingListings: snapshot.isFetchingListings,
    setIsFetchingListings: controller.setIsFetchingListings,
    sentinelRef: controller.refs.sentinelRef,
    loadingListingsRef: controller.refs.loadingListingsRef,
    nextCursorRef: controller.refs.nextCursorRef,
    selectedListing: snapshot.selectedListing,
    setSelectedListing: controller.setSelectedListing,
    editing: snapshot.editing,
    setEditing: controller.setEditing,
    activeConvoId: snapshot.activeConvoId,
    setActiveConvoId: controller.setActiveConvoId,
    tabRef: controller.refs.tabRef,
    activeConvoIdRef: controller.refs.activeConvoIdRef,
    windowFocused: snapshot.windowFocused,
    setWindowFocused: controller.setWindowFocused,
    windowFocusedRef: controller.refs.windowFocusedRef,
    unreadCount: snapshot.unreadCount,
    setUnreadCount: controller.setUnreadCount,
    hasAdminUnread: snapshot.hasAdminUnread,
    setHasAdminUnread: controller.setHasAdminUnread,
    loadingCount: snapshot.loadingCount,
    setLoadingCount: controller.setLoadingCount
  }), [snapshot, controller]);

  return React.createElement(ListingsContext.Provider, { value }, children);
}

export function useListingsContext() {
  const ctx = useContext(ListingsContext);
  if (!ctx) {
    throw new Error('useListingsContext must be used within a ListingsProvider');
  }
  return ctx;
}

export { createListingsController };

if (typeof module !== 'undefined') {
  module.exports = {
    ListingsProvider,
    useListingsContext,
    createListingsController
  };
}

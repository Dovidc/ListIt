const ReactGlobal = typeof React !== 'undefined' ? React : null;
const useCallback = ReactGlobal?.useCallback?.bind(ReactGlobal) ?? null;
const useContext = ReactGlobal?.useContext?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useMemo = ReactGlobal?.useMemo?.bind(ReactGlobal) ?? null;
const useRef = ReactGlobal?.useRef?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;
const createElement = ReactGlobal?.createElement?.bind(ReactGlobal) ?? null;
const createContext = ReactGlobal?.createContext?.bind(ReactGlobal) ?? null;

const UploadsContext = createContext ? createContext(null) : null;

const AUTO_KEY = 'listit_auto_list';
const AI_DESC_KEY = 'listit_ai_descriptions';
const AUTO_NEAR_KEY = 'listit_auto_post_nearby';

export function UploadsProvider({ children }) {
  if (!useState || !useEffect || !useMemo || !useRef || !useCallback || !createElement || !UploadsContext) {
    throw new Error('UploadsProvider requires React to be loaded globally.');
  }

  const [showForm, setShowForm] = useState(false);
  const [showMassList, setShowMassList] = useState(false);

  const [autoListEnabled, setAutoListEnabled] = useState(() => {
    try {
      return localStorage.getItem(AUTO_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_KEY, autoListEnabled ? '1' : '0');
    } catch {}
  }, [autoListEnabled]);

  const [aiDescriptionEnabled, setAiDescriptionEnabled] = useState(() => {
    try {
      return localStorage.getItem(AI_DESC_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(AI_DESC_KEY, aiDescriptionEnabled ? '1' : '0');
    } catch {}
  }, [aiDescriptionEnabled]);

  const [autoPostNearbyEnabled, setAutoPostNearbyEnabled] = useState(() => {
    try {
      return localStorage.getItem(AUTO_NEAR_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_NEAR_KEY, autoPostNearbyEnabled ? '1' : '0');
    } catch {}
  }, [autoPostNearbyEnabled]);

  const listingQueueRef = useRef([]);
  const listingQueueProcessingRef = useRef(false);
  const [showQueueToast, setShowQueueToast] = useState(false);
  const toastTimerRef = useRef(null);
  const [queuePendingCount, setQueuePendingCount] = useState(0);

  useEffect(() => () => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
  }, []);

  const showQueueReminder = useCallback(() => {
    setShowQueueToast(true);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setShowQueueToast(false), 2000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const processNextListingJob = useCallback(() => {
    if (listingQueueProcessingRef.current) return;
    const job = listingQueueRef.current.shift();
    if (!job) {
      setQueuePendingCount(0);
      return;
    }
    listingQueueProcessingRef.current = true;
    Promise.resolve()
      .then(() => job())
      .catch((err) => {
        console.error('Background listing job failed:', err);
      })
      .finally(() => {
        listingQueueProcessingRef.current = false;
        setQueuePendingCount(listingQueueRef.current.length);
        processNextListingJob();
      });
  }, []);

  const enqueueListingJob = useCallback((job) => {
    if (typeof job !== 'function') return;
    listingQueueRef.current.push(job);
    setQueuePendingCount(listingQueueRef.current.length + (listingQueueProcessingRef.current ? 1 : 0));
    showQueueReminder();
    if (!listingQueueProcessingRef.current) {
      processNextListingJob();
    }
  }, [processNextListingJob, showQueueReminder]);

  const resetListingQueue = useCallback(() => {
    listingQueueRef.current = [];
    listingQueueProcessingRef.current = false;
    setQueuePendingCount(0);
  }, []);

  useEffect(() => () => {
    resetListingQueue();
  }, [resetListingQueue]);

  const value = useMemo(
    () => ({
      showForm,
      setShowForm,
      showMassList,
      setShowMassList,
      autoListEnabled,
      setAutoListEnabled,
      aiDescriptionEnabled,
      setAiDescriptionEnabled,
      autoPostNearbyEnabled,
      setAutoPostNearbyEnabled,
      listingQueueRef,
      listingQueueProcessingRef,
      showQueueToast,
      setShowQueueToast,
      queuePendingCount,
      setQueuePendingCount,
      toastTimerRef,
      showQueueReminder,
      enqueueListingJob,
      processNextListingJob,
      resetListingQueue
    }),
    [
      showForm,
      showMassList,
      autoListEnabled,
      aiDescriptionEnabled,
      autoPostNearbyEnabled,
      showQueueToast,
      queuePendingCount,
      showQueueReminder,
      enqueueListingJob,
      processNextListingJob,
      resetListingQueue
    ]
  );

  return createElement(UploadsContext.Provider, { value }, children);
}

export function useUploads() {
  if (!useContext || !UploadsContext) {
    throw new Error('useUploads requires React to be loaded globally.');
  }
  const ctx = useContext(UploadsContext);
  if (!ctx) {
    throw new Error('useUploads must be used within an UploadsProvider');
  }
  return ctx;
}

export function createUploadsStateForTest(storage = new Map()) {
  const get = (key) => {
    if (storage instanceof Map) return storage.get(key) ?? null;
    if (typeof storage?.getItem === 'function') return storage.getItem(key);
    return null;
  };
  const set = (key, value) => {
    if (storage instanceof Map) storage.set(key, value);
    else if (typeof storage?.setItem === 'function') storage.setItem(key, value);
  };

  const state = {
    showForm: false,
    showMassList: false,
    autoListEnabled: get(AUTO_KEY) === '1',
    aiDescriptionEnabled: get(AI_DESC_KEY) === '1',
    autoPostNearbyEnabled: get(AUTO_NEAR_KEY) === '1',
    listingQueueRef: [],
    listingQueueProcessingRef: false,
    showQueueToast: false,
    queuePendingCount: 0,
    toastTimer: null
  };

  const updateFlag = (key, value) => {
    set(key, value ? '1' : '0');
  };

  return {
    state,
    setShowForm: (value) => { state.showForm = !!value; },
    setShowMassList: (value) => { state.showMassList = !!value; },
    setAutoListEnabled: (value) => { state.autoListEnabled = !!value; updateFlag(AUTO_KEY, state.autoListEnabled); },
    setAiDescriptionEnabled: (value) => { state.aiDescriptionEnabled = !!value; updateFlag(AI_DESC_KEY, state.aiDescriptionEnabled); },
    setAutoPostNearbyEnabled: (value) => { state.autoPostNearbyEnabled = !!value; updateFlag(AUTO_NEAR_KEY, state.autoPostNearbyEnabled); },
    enqueue: (job) => { if (typeof job === 'function') state.listingQueueRef.push(job); },
    setQueuePendingCount: (value) => { state.queuePendingCount = Number(value) || 0; },
    setShowQueueToast: (value) => { state.showQueueToast = !!value; }
  };
}

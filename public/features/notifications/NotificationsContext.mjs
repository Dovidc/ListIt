const ReactGlobal = typeof React !== 'undefined' ? React : null;
const useContext = ReactGlobal?.useContext?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useMemo = ReactGlobal?.useMemo?.bind(ReactGlobal) ?? null;
const useRef = ReactGlobal?.useRef?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;
const createElement = ReactGlobal?.createElement?.bind(ReactGlobal) ?? null;
const createContext = ReactGlobal?.createContext?.bind(ReactGlobal) ?? null;

const NotificationsContext = createContext ? createContext(null) : null;

export function NotificationsProvider({ children }) {
  if (!useState || !useEffect || !useMemo || !useRef || !createElement || !NotificationsContext) {
    throw new Error('NotificationsProvider requires React to be loaded globally.');
  }

  const [banner, setBanner] = useState(null);
  const [messageToasts, setMessageToasts] = useState([]);
  const pushSetupRef = useRef({ userId: null, permission: null });
  const toastTimersRef = useRef(new Map());
  const conversationMapRef = useRef(new Map());
  const audioCtxRef = useRef(null);

  const [windowFocused, setWindowFocused] = useState(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });
  const windowFocusedRef = useRef(windowFocused);
  useEffect(() => {
    windowFocusedRef.current = windowFocused;
  }, [windowFocused]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
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

  const [unreadCount, setUnreadCount] = useState(0);
  const [hasAdminUnread, setHasAdminUnread] = useState(false);
  const [loadingCount, setLoadingCount] = useState(0);
  const [activeConvoId, setActiveConvoId] = useState(null);
  const activeConvoIdRef = useRef(activeConvoId);
  useEffect(() => {
    activeConvoIdRef.current = activeConvoId;
  }, [activeConvoId]);

  useEffect(() => () => {
    toastTimersRef.current.forEach(clearTimeout);
    toastTimersRef.current.clear();
  }, []);

  const value = useMemo(
    () => ({
      banner,
      setBanner,
      messageToasts,
      setMessageToasts,
      pushSetupRef,
      toastTimersRef,
      conversationMapRef,
      audioCtxRef,
      windowFocused,
      setWindowFocused,
      windowFocusedRef,
      unreadCount,
      setUnreadCount,
      hasAdminUnread,
      setHasAdminUnread,
      loadingCount,
      setLoadingCount,
      activeConvoId,
      setActiveConvoId,
      activeConvoIdRef
    }),
    [
      banner,
      messageToasts,
      windowFocused,
      unreadCount,
      hasAdminUnread,
      loadingCount,
      activeConvoId
    ]
  );

  return createElement(NotificationsContext.Provider, { value }, children);
}

export function useNotifications() {
  if (!useContext || !NotificationsContext) {
    throw new Error('useNotifications requires React to be loaded globally.');
  }
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return ctx;
}

export function createNotificationsStateForTest() {
  const state = {
    banner: null,
    messageToasts: [],
    pushSetup: { userId: null, permission: null },
    toastTimers: new Map(),
    conversations: new Map(),
    audioCtx: null,
    windowFocused: true,
    unreadCount: 0,
    hasAdminUnread: false,
    loadingCount: 0,
    activeConvoId: null
  };

  return {
    state,
    setBanner: (value) => { state.banner = value ?? null; },
    addToast: (toast) => { if (toast) state.messageToasts.push(toast); },
    clearToasts: () => { state.messageToasts = []; state.toastTimers.clear(); },
    setWindowFocused: (value) => { state.windowFocused = !!value; },
    setUnreadCount: (value) => { state.unreadCount = Number(value) || 0; },
    setHasAdminUnread: (value) => { state.hasAdminUnread = !!value; },
    setLoadingCount: (value) => { state.loadingCount = Number(value) || 0; },
    setActiveConvoId: (value) => { state.activeConvoId = value ?? null; }
  };
}

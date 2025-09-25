const ReactGlobal = typeof React !== 'undefined' ? React : null;
const useCallback = ReactGlobal?.useCallback?.bind(ReactGlobal) ?? null;
const useContext = ReactGlobal?.useContext?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useMemo = ReactGlobal?.useMemo?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;
const createElement = ReactGlobal?.createElement?.bind(ReactGlobal) ?? null;
const createContext = ReactGlobal?.createContext?.bind(ReactGlobal) ?? null;

const AuthContext = createContext ? createContext(null) : null;

export function AuthProvider({ children, api }) {
  if (!useState || !useCallback || !useEffect || !useMemo || !createElement || !AuthContext) {
    throw new Error('AuthProvider requires React to be loaded globally.');
  }

  const [user, setUserState] = useState(null);
  const [pushMeta, setPushMeta] = useState({ available: false, vapidPublicKey: null });
  const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'login' });

  const setUser = useCallback((next) => {
    const normalized = next || null;
    setUserState(normalized);
    setPushMeta(normalizePushMeta(normalized));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (!alive) return;
        setUser(me);
      } catch {
        if (!alive) return;
        setUser(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, setUser]);

  const value = useMemo(
    () => ({ user, setUser, pushMeta, authModal, setAuthModal }),
    [user, setUser, pushMeta, authModal]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  if (!useContext || !AuthContext) {
    throw new Error('useAuth requires React to be loaded globally.');
  }
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export async function bootstrapAuthStateForTest(api) {
  const state = {
    user: null,
    pushMeta: { available: false, vapidPublicKey: null },
    authModal: { isOpen: false, mode: 'login' }
  };

  const setUser = (next) => {
    const normalized = next || null;
    state.user = normalized;
    state.pushMeta = normalizePushMeta(normalized);
  };

  try {
    const me = await api.me();
    setUser(me);
  } catch {
    setUser(null);
  }

  return {
    getState: () => ({ ...state }),
    setUser
  };
}

export function normalizePushMeta(user) {
  if (!user || typeof user !== 'object') {
    return { available: false, vapidPublicKey: null };
  }
  const vapidKey = typeof user.vapid_public_key === 'string' ? user.vapid_public_key : null;
  return { available: !!vapidKey, vapidPublicKey: vapidKey };
}

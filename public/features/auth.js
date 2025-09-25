(() => {
  const {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState
  } = React;

  const AuthContext = createContext(null);

  function normalizePushMeta(value) {
    const source = value && typeof value === 'object'
      ? (value.push_meta && typeof value.push_meta === 'object'
          ? value.push_meta
          : (value.pushMeta && typeof value.pushMeta === 'object' ? value.pushMeta : null))
      : null;

    const available = !!source?.available;
    const vapid = typeof source?.vapid_public_key === 'string'
      ? source.vapid_public_key.trim()
      : (typeof source?.vapidPublicKey === 'string' ? source.vapidPublicKey.trim() : '');

    return {
      available: available && !!vapid,
      vapidPublicKey: vapid || null
    };
  }

  function AuthProvider({ api, children }) {
    if (!api || typeof api.me !== 'function') {
      throw new Error('AuthProvider requires an api client with a `me` method.');
    }

    const [user, setUserState] = useState(null);
    const [pushMeta, setPushMeta] = useState({ available: false, vapidPublicKey: null });

    const setUser = useCallback((next) => {
      setUserState(next || null);
      setPushMeta(normalizePushMeta(next));
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

    const value = useMemo(() => ({ user, setUser, pushMeta, api }), [user, setUser, pushMeta, api]);

    return React.createElement(AuthContext.Provider, { value }, children);
  }

  function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
      throw new Error('useAuth must be used within an AuthProvider.');
    }
    return context;
  }

  window.ListItFeatures = window.ListItFeatures || {};
  window.ListItFeatures.Auth = {
    AuthProvider,
    useAuth,
    normalizePushMeta
  };
})();

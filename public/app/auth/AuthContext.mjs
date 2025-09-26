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
import { useNotifications } from '../notifications/NotificationsContext.mjs';

const AuthContext = React.createContext(null);

export function AuthProvider({ children }) {
  const { api, onUnauthorized, onAccountLocked } = useServices();
  const { notify } = useNotifications();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [isLocked, setLocked] = useState(false);
  const didLoadRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const me = await api.me({ silent: true });
        if (!cancelled) {
          setUser(me || null);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          didLoadRef.current = true;
          setStatus('ready');
        }
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => onUnauthorized(() => {
    setUser(null);
  }), [onUnauthorized]);

  useEffect(() => onAccountLocked(() => {
    setLocked(true);
    notify({
      type: 'error',
      title: 'Account locked',
      message: 'Your account is locked. Contact support to regain access.'
    });
  }), [onAccountLocked, notify]);

  const login = useCallback(async (email, password) => {
    const account = await api.login(email, password);
    setUser(account || null);
    setLocked(false);
    if (!didLoadRef.current) {
      setStatus('ready');
    }
    return account;
  }, [api]);

  const register = useCallback(async (payload) => {
    const account = await api.register(payload);
    setUser(account || null);
    setLocked(false);
    if (!didLoadRef.current) {
      setStatus('ready');
    }
    return account;
  }, [api]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, [api]);

  const refresh = useCallback(async () => {
    const me = await api.me({ silent: true });
    setUser(me || null);
    return me;
  }, [api]);

  const value = useMemo(() => ({
    user,
    status,
    isLocked,
    isAuthenticated: !!(user && user.id != null),
    login,
    logout,
    register,
    refresh
  }), [user, status, isLocked, login, logout, register, refresh]);

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

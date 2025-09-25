import { api } from '../../shared/core.js';

const {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

function createAuthController() {
  const listeners = new Set();
  const state = {
    user: null,
    pushMeta: { available: false, vapidPublicKey: null },
    authModal: { isOpen: false, mode: 'login' },
    banner: null
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (_) {}
    });
  };

  const controller = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return {
        user: state.user,
        pushMeta: state.pushMeta,
        authModal: state.authModal,
        banner: state.banner
      };
    },
    setUser(next) {
      state.user = next || null;
      state.pushMeta = normalizePushMeta(next);
      notify();
    },
    setAuthModal(next) {
      state.authModal = next ? { ...next } : { isOpen: false, mode: 'login' };
      notify();
    },
    setBanner(next) {
      state.banner = next || null;
      notify();
    },
    showLockedBanner() {
      controller.setBanner({
        type: 'locked',
        message: 'Your account is locked. Please message an admin for help.',
        ts: Date.now()
      });
    },
    dismissBanner() {
      controller.setBanner(null);
    }
  };

  return controller;
}

function useAuthState() {
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createAuthController();
  }

  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());

  useEffect(() => controller.subscribe(() => {
    setSnapshot(controller.getSnapshot());
  }), [controller]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (!alive) return;
        controller.setUser(me);
      } catch {
        if (!alive) return;
        controller.setUser(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [controller]);

  return useMemo(() => ({
    user: snapshot.user,
    setUser: controller.setUser,
    pushMeta: snapshot.pushMeta,
    authModal: snapshot.authModal,
    setAuthModal: controller.setAuthModal,
    banner: snapshot.banner,
    setBanner: controller.setBanner,
    showLockedBanner: controller.showLockedBanner,
    dismissBanner: controller.dismissBanner
  }), [snapshot, controller]);
}

export function AuthProvider({ children }) {
  const value = useAuthState();
  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return ctx;
}

export { normalizePushMeta };
export { createAuthController };

if (typeof module !== 'undefined') {
  module.exports = {
    AuthProvider,
    useAuthContext,
    normalizePushMeta,
    createAuthController
  };
}

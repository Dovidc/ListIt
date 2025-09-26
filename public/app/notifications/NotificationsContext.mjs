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

const NotificationsContext = React.createContext(null);

function normalizeToast(options = {}) {
  const id = options.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const type = options.type || 'info';
  const duration = Number.isFinite(options.duration) ? options.duration : 4000;
  return {
    id,
    type,
    title: options.title || '',
    message: options.message || '',
    duration,
    action: options.action || null
  };
}

export function NotificationsProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    if (!id) return;
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timers = timersRef.current;
    if (timers.has(id)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  }, []);

  const pushToast = useCallback((options) => {
    const toast = normalizeToast(options);
    setToasts((prev) => [...prev, toast]);
    if (toast.duration > 0) {
      const timerId = window.setTimeout(() => removeToast(toast.id), toast.duration);
      timersRef.current.set(toast.id, timerId);
    }
    return toast.id;
  }, [removeToast]);

  useEffect(() => () => {
    timersRef.current.forEach((timerId) => clearTimeout(timerId));
    timersRef.current.clear();
  }, []);

  const value = useMemo(() => ({
    toasts,
    notify: pushToast,
    dismiss: removeToast
  }), [toasts, pushToast, removeToast]);

  return createElement(NotificationsContext.Provider, { value }, children);
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}

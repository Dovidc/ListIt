const {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState
} = React;

const NotificationsContext = createContext(null);

function createNotificationsController() {
  const listeners = new Set();
  const state = {
    messageToasts: []
  };

  const refs = {
    pushSetupRef: { current: { userId: null, permission: null } },
    toastTimersRef: { current: new Map() },
    conversationMapRef: { current: new Map() },
    audioCtxRef: { current: null }
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (_) {}
    });
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
    setMessageToasts(list) {
      state.messageToasts = Array.isArray(list) ? list : [];
      notify();
    }
  };

  return controller;
}

export function NotificationsProvider({ children }) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createNotificationsController();
  }

  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());

  useEffect(() => controller.subscribe(() => {
    setSnapshot(controller.getSnapshot());
  }), [controller]);

  const value = useMemo(() => ({
    messageToasts: snapshot.messageToasts,
    setMessageToasts: controller.setMessageToasts,
    pushSetupRef: controller.refs.pushSetupRef,
    toastTimersRef: controller.refs.toastTimersRef,
    conversationMapRef: controller.refs.conversationMapRef,
    audioCtxRef: controller.refs.audioCtxRef
  }), [snapshot, controller]);

  return React.createElement(NotificationsContext.Provider, { value }, children);
}

export function useNotificationsContext() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotificationsContext must be used within a NotificationsProvider');
  }
  return ctx;
}

export { createNotificationsController };

if (typeof module !== 'undefined') {
  module.exports = {
    NotificationsProvider,
    useNotificationsContext,
    createNotificationsController
  };
}

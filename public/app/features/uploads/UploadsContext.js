const {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} = React;

const AUTO_KEY = 'listit_auto_list';
const AI_DESC_KEY = 'listit_ai_descriptions';
const AUTO_NEAR_KEY = 'listit_auto_post_nearby';

const UploadsContext = createContext(null);

function readStoredFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function createUploadsController() {
  const listeners = new Set();
  const state = {
    showForm: false,
    showMassList: false,
    autoListEnabled: readStoredFlag(AUTO_KEY),
    aiDescriptionEnabled: readStoredFlag(AI_DESC_KEY),
    autoPostNearbyEnabled: readStoredFlag(AUTO_NEAR_KEY),
    backgroundQueueEnabled: true,
    showQueueToast: false,
    queuePendingCount: 0
  };

  const refs = {
    listingQueueRef: { current: [] },
    listingQueueProcessingRef: { current: false },
    toastTimerRef: { current: null }
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
    setShowForm(value) {
      setValue('showForm', !!value);
    },
    setShowMassList(value) {
      setValue('showMassList', !!value);
    },
    setAutoListEnabled(value) {
      const next = !!value;
      setValue('autoListEnabled', next);
      try { localStorage.setItem(AUTO_KEY, next ? '1' : '0'); } catch {}
    },
    setAiDescriptionEnabled(value) {
      const next = !!value;
      setValue('aiDescriptionEnabled', next);
      try { localStorage.setItem(AI_DESC_KEY, next ? '1' : '0'); } catch {}
    },
    setAutoPostNearbyEnabled(value) {
      const next = !!value;
      setValue('autoPostNearbyEnabled', next);
      try { localStorage.setItem(AUTO_NEAR_KEY, next ? '1' : '0'); } catch {}
    },
    setShowQueueToast(value) {
      setValue('showQueueToast', !!value);
    },
    setQueuePendingCount(value) {
      const count = Math.max(0, Number(value) || 0);
      setValue('queuePendingCount', count);
    }
  };

  return controller;
}

export function UploadsProvider({ children }) {
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createUploadsController();
  }

  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());

  useEffect(() => controller.subscribe(() => {
    setSnapshot(controller.getSnapshot());
  }), [controller]);

  const value = useMemo(() => ({
    showForm: snapshot.showForm,
    setShowForm: controller.setShowForm,
    showMassList: snapshot.showMassList,
    setShowMassList: controller.setShowMassList,
    autoListEnabled: snapshot.autoListEnabled,
    setAutoListEnabled: controller.setAutoListEnabled,
    aiDescriptionEnabled: snapshot.aiDescriptionEnabled,
    setAiDescriptionEnabled: controller.setAiDescriptionEnabled,
    autoPostNearbyEnabled: snapshot.autoPostNearbyEnabled,
    setAutoPostNearbyEnabled: controller.setAutoPostNearbyEnabled,
    backgroundQueueEnabled: snapshot.backgroundQueueEnabled,
    listingQueueRef: controller.refs.listingQueueRef,
    listingQueueProcessingRef: controller.refs.listingQueueProcessingRef,
    showQueueToast: snapshot.showQueueToast,
    setShowQueueToast: controller.setShowQueueToast,
    toastTimerRef: controller.refs.toastTimerRef,
    queuePendingCount: snapshot.queuePendingCount,
    setQueuePendingCount: controller.setQueuePendingCount
  }), [snapshot, controller]);

  return React.createElement(UploadsContext.Provider, { value }, children);
}

export function useUploadsContext() {
  const ctx = useContext(UploadsContext);
  if (!ctx) {
    throw new Error('useUploadsContext must be used within an UploadsProvider');
  }
  return ctx;
}

export { createUploadsController };

if (typeof module !== 'undefined') {
  module.exports = {
    UploadsProvider,
    useUploadsContext,
    createUploadsController
  };
}

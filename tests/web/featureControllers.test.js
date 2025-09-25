let createAuthController;
let normalizePushMeta;
let createListingsController;
let createUploadsController;
let createNotificationsController;
let AppNav;

beforeAll(async () => {
  global.window = global.window || {};
  global.React = global.React || {
    createContext: () => ({ Provider: () => null }),
    useContext: () => { throw new Error('useContext stub invoked'); },
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (initial = null) => ({ current: initial }),
    useState: (initial) => [initial, () => {}]
  };
  const storage = new Map();
  const storageApi = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
    clear: () => { storage.clear(); }
  };

  global.localStorage = storageApi;
  global.window.localStorage = storageApi;

  global.window.ListItCore = {
    createApiClient: () => ({}),
    formatCurrency: (value) => value,
    formatDistance: (value) => value,
    haversineMeters: () => 0
  };
  global.fetch = global.fetch || (() => Promise.resolve({ ok: true, json: async () => ({}) }));

  ({ createAuthController, normalizePushMeta } = await import('../../public/app/features/auth/AuthContext.js'));
  ({ createListingsController } = await import('../../public/app/features/listings/ListingsContext.js'));
  ({ createUploadsController } = await import('../../public/app/features/uploads/UploadsContext.js'));
  ({ createNotificationsController } = await import('../../public/app/features/notifications/NotificationsContext.js'));
  ({ AppNav } = await import('../../public/app/shared/core.js'));
});

afterEach(() => {
  if (global.localStorage && typeof global.localStorage.clear === 'function') {
    global.localStorage.clear();
  }
});

describe('feature controllers', () => {
  test('auth controller normalizes push meta and surfaces locked banner', () => {
    const controller = createAuthController();
    controller.setUser({
      id: 9,
      push_meta: { available: true, vapid_public_key: 'abc' }
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.user.id).toBe(9);
    expect(snapshot.pushMeta).toEqual({ available: true, vapidPublicKey: 'abc' });

    controller.showLockedBanner();
    const bannerSnapshot = controller.getSnapshot();
    expect(bannerSnapshot.banner).toBeTruthy();
    expect(bannerSnapshot.banner.message).toContain('locked');

    controller.dismissBanner();
    expect(controller.getSnapshot().banner).toBeNull();
  });

  test('normalizePushMeta handles alternative shapes', () => {
    expect(normalizePushMeta({ pushMeta: { available: true, vapidPublicKey: 'xyz' } })).toEqual({ available: true, vapidPublicKey: 'xyz' });
    expect(normalizePushMeta(null)).toEqual({ available: false, vapidPublicKey: null });
  });

  test('listings controller tracks tab changes and ref updates', () => {
    const controller = createListingsController();
    expect(controller.getSnapshot().tab).toBe('browse');
    controller.setTab('messages');
    const after = controller.getSnapshot();
    expect(after.tab).toBe('messages');
    expect(controller.refs.tabRef.current).toBe('messages');

    controller.setWindowFocused(false);
    expect(controller.getSnapshot().windowFocused).toBe(false);
    expect(controller.refs.windowFocusedRef.current).toBe(false);
  });

  test('uploads controller reads storage defaults and persists toggles', () => {
    localStorage.setItem('listit_auto_list', '1');
    localStorage.setItem('listit_ai_descriptions', '0');
    localStorage.setItem('listit_auto_post_nearby', '1');

    const controller = createUploadsController();
    const initial = controller.getSnapshot();
    expect(initial.autoListEnabled).toBe(true);
    expect(initial.aiDescriptionEnabled).toBe(false);
    expect(initial.autoPostNearbyEnabled).toBe(true);

    controller.setAutoListEnabled(false);
    controller.setAiDescriptionEnabled(true);
    controller.setAutoPostNearbyEnabled(false);

    expect(controller.getSnapshot()).toMatchObject({
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false
    });
    expect(localStorage.getItem('listit_auto_list')).toBe('0');
    expect(localStorage.getItem('listit_ai_descriptions')).toBe('1');
    expect(localStorage.getItem('listit_auto_post_nearby')).toBe('0');
  });

  test('notifications controller stores toast state', () => {
    const controller = createNotificationsController();
    controller.setMessageToasts([{ id: 1, preview: 'hello' }]);
    expect(controller.getSnapshot().messageToasts).toHaveLength(1);
    controller.setMessageToasts(null);
    expect(controller.getSnapshot().messageToasts).toHaveLength(0);
  });

  test('AppNav wiring can drive controller transitions', () => {
    const listings = createListingsController();
    const auth = createAuthController();

    AppNav.setTab = listings.setTab;
    AppNav.notifyLocked = auth.showLockedBanner;

    AppNav.setTab('messages');
    expect(listings.getSnapshot().tab).toBe('messages');

    AppNav.notifyLocked();
    expect(auth.getSnapshot().banner).toBeTruthy();
  });
});


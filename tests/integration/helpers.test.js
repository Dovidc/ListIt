const path = require('path');

const helpersPath = path.join(__dirname, '..', '..', 'public', 'app', 'helpers.js');

function setupWindow() {
  const addEventListener = jest.fn();
  const removeEventListener = jest.fn();
  const requestAnimationFrame = jest.fn((cb) => {
    if (typeof cb === 'function') {
      cb();
    }
    return 1;
  });
  const cancelAnimationFrame = jest.fn();
  const getComputedStyle = jest.fn(() => ({ columnCount: '3', paddingRight: '0' }));
  const btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  const atob = (str) => Buffer.from(str, 'base64').toString('binary');

  global.window = {
    ListItApp: {},
    addEventListener,
    removeEventListener,
    requestAnimationFrame,
    cancelAnimationFrame,
    getComputedStyle,
    innerWidth: 1024,
    scrollY: 200,
    pageYOffset: undefined,
    btoa,
    atob
  };
  global.getComputedStyle = getComputedStyle;

  global.document = {
    body: { style: {} },
    documentElement: { clientWidth: 980 },
    scrollingElement: { scrollTop: 0 }
  };

  const storage = new Map();
  global.localStorage = {
    getItem: jest.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: jest.fn((key, value) => {
      storage.set(key, value);
    })
  };

  global.navigator = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    vendor: 'Apple',
    maxTouchPoints: 0,
    geolocation: {
      getCurrentPosition: jest.fn()
    }
  };

  return { addEventListener, removeEventListener, requestAnimationFrame, cancelAnimationFrame, getComputedStyle };
}

function teardownWindow() {
  delete global.window;
  delete global.document;
  delete global.navigator;
  delete global.localStorage;
  delete global.ResizeObserver;
  delete global.getComputedStyle;
}

function loadHelpersFactory() {
  if (!global.window || !global.window.ListItApp) {
    throw new Error('Window must be initialized before loading helpers.');
  }
  delete global.window.ListItApp.helpers;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(helpersPath);
  return global.window.ListItApp.helpers.createHelpers;
}

function createReactMocks() {
  const setters = [];
  const effects = [];
  const memos = [];

  const React = {
    useState: jest.fn((initial) => {
      const setter = jest.fn((next) => {
        if (typeof next === 'function') {
          return next(initial);
        }
        return next;
      });
      setters.push(setter);
      return [initial, setter];
    }),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
    }),
    useMemo: jest.fn((factory, deps) => {
      const value = factory();
      memos.push({ deps, value });
      return value;
    }),
    useRef: jest.fn((initial) => ({ current: initial })),
    useCallback: jest.fn((fn) => fn),
    createElement: jest.fn((component, props = {}, ...children) => ({ component, props, children }))
  };

  return { React, setters, effects, memos };
}

beforeEach(() => {
  jest.resetModules();
  teardownWindow();
});

afterEach(() => {
  teardownWindow();
});

describe('helpers integration', () => {
  test('registers factory on the global namespace and enforces React dependency', () => {
    setupWindow();
    const createHelpers = loadHelpersFactory();

    expect(typeof createHelpers).toBe('function');
    expect(() => createHelpers({})).toThrow('Helpers require React.');
  });

  test('provides storage, conversion, and concurrency helpers', async () => {
    setupWindow();
    const { React } = createReactMocks();
    const createHelpers = loadHelpersFactory();
    const helpers = createHelpers({ React });

    expect(helpers.seenKey('user-1')).toBe('listit_seen_user-1');
    expect(helpers.seenKey()).toBe('listit_seen_anon');

    global.localStorage.getItem.mockReturnValueOnce('{"foo":true}');
    expect(helpers.loadSeen('user-1')).toEqual({ foo: true });

    helpers.saveSeen('user-2', { bar: false });
    expect(global.localStorage.setItem).toHaveBeenCalledWith('listit_seen_user-2', JSON.stringify({ bar: false }));

    const buf = new Uint8Array([1, 2, 3]).buffer;
    const encoded = helpers.arrayBufferToBase64Url(buf);
    expect(typeof encoded).toBe('string');
    expect(Array.from(helpers.base64UrlToUint8Array(encoded))).toEqual([1, 2, 3]);

    const subscription = {
      endpoint: 'https://push.example',
      expirationTime: null,
      getKey: jest.fn((type) => {
        if (type === 'auth') return new Uint8Array([1, 2]);
        if (type === 'p256dh') return new Uint8Array([3, 4]);
        return null;
      })
    };
    const serialized = helpers.serializePushSubscription(subscription);
    expect(serialized).toEqual({
      endpoint: 'https://push.example',
      expirationTime: null,
      keys: {
        auth: expect.any(String),
        p256dh: expect.any(String)
      }
    });

    const limiter = helpers.createConcurrencyLimiter(1);
    const order = [];
    const first = limiter(() => {
      order.push('first');
      return Promise.resolve('A');
    });
    const second = limiter(() => {
      order.push('second');
      return Promise.resolve('B');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);

    global.navigator.geolocation.getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 12.34, longitude: 56.78 } });
    });

    const coords = await helpers.getUserCoordsOnce();
    expect(coords).toEqual({ lat: 12.34, lon: 56.78 });
    expect(await helpers.getUserCoordsOnce()).toBe(coords);

    expect(helpers.interleaveByColumns([1, 2, 3, 4, 5], 2)).toEqual([1, 3, 5, 2, 4]);

    const normalized = helpers.normalizeListingsResponse({ rows: [1, 2, 3], total: 4, page: 1 }, 2);
    expect(normalized).toEqual({ rows: [1, 2, 3], hasNext: true, nextCursor: null });
    expect(helpers.asArray({ items: ['a'] })).toEqual(['a']);

    const viewTop = helpers.pageTop({ getBoundingClientRect: () => ({ top: 150 }) });
    expect(viewTop).toBe(350);
  });

  test('hook helpers wire DOM observers and listeners', () => {
    const { addEventListener, removeEventListener } = setupWindow();
    const { React, setters, effects } = createReactMocks();
    const createHelpers = loadHelpersFactory();
    const helpers = createHelpers({ React });

    const element = { getBoundingClientRect: () => ({ top: 0 }) };
    const ref = { current: element };

    const resizeObserverInstances = [];
    global.ResizeObserver = jest.fn().mockImplementation((callback) => {
      const instance = {
        observe: jest.fn(() => callback()),
        disconnect: jest.fn()
      };
      resizeObserverInstances.push(instance);
      return instance;
    });

    const cols = helpers.useColumnCount(ref, 2);
    expect(cols).toBe(2);
    expect(effects).toHaveLength(1);

    const cleanupColumnCount = effects[0]();
    expect(setters[0]).toHaveBeenCalledWith(3);
    expect(resizeObserverInstances[0].observe).toHaveBeenCalledWith(element);
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    cleanupColumnCount();
    expect(resizeObserverInstances[0].disconnect).toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  test('useElementWidth observes elements and cleans up listeners', () => {
    const hooks = setupWindow();
    const { React, setters, effects } = createReactMocks();
    const createHelpers = loadHelpersFactory();
    const helpers = createHelpers({ React });

    const element = { clientWidth: 320 };
    const ref = { current: element };

    global.ResizeObserver = jest.fn().mockImplementation((callback) => ({
      observe: jest.fn(() => callback()),
      disconnect: jest.fn()
    }));

    helpers.useElementWidth(ref, true);
    expect(effects.length).toBeGreaterThan(0);
    const cleanup = effects[0]();
    expect(setters[0]).toHaveBeenCalledWith(expect.any(Function));

    const updateFn = setters[0].mock.calls[0][0];
    expect(updateFn(0)).toBe(320);

    cleanup();
    expect(hooks.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

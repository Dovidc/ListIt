const path = require('path');

const pushFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'push.js'
);

function loadFactory() {
  global.window = { ListItApp: { features: {} } };
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(pushFeaturePath);
  return global.window.ListItApp.features.push.createPushFeature;
}

function resetGlobals() {
  delete global.window;
  delete global.navigator;
  delete global.Notification;
}

function createReactMocks() {
  const refs = [];
  const effects = [];
  const callbacks = [];

  const React = {
    useRef: jest.fn((initialValue) => {
      const ref = { current: initialValue };
      refs.push(ref);
      return ref;
    }),
    useEffect: jest.fn((effect, deps) => {
      effects.push({ effect, deps });
    }),
    useCallback: jest.fn((fn, deps) => {
      const wrapped = (...args) => fn(...args);
      callbacks.push({ fn, deps, wrapped });
      return wrapped;
    })
  };

  return { React, refs, effects, callbacks };
}

async function flushPromises(iterations = 6) {
  for (let i = 0; i < iterations; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.resetModules();
  resetGlobals();
});

afterEach(() => {
  resetGlobals();
});

describe('push feature integration', () => {
  test('validates required dependencies', () => {
    const createPushFeature = loadFactory();

    expect(() => createPushFeature({})).toThrow('Push feature requires React.');
    expect(() =>
      createPushFeature({ React: { useEffect: jest.fn(), useCallback: jest.fn() } })
    ).toThrow('Push feature requires React.');

    const React = { useRef: jest.fn(), useEffect: jest.fn(), useCallback: jest.fn() };

    expect(() => createPushFeature({ React })).toThrow('Push feature requires an API client.');
    expect(() => createPushFeature({ React, api: {} })).toThrow(
      'Push feature requires helpers.serializePushSubscription.'
    );
    expect(() =>
      createPushFeature({
        React,
        api: {},
        helpers: { serializePushSubscription: jest.fn() }
      })
    ).toThrow('Push feature requires helpers.base64UrlToUint8Array.');
  });

  test('removePushSubscription unsubscribes current registration', async () => {
    const createPushFeature = loadFactory();
    const react = createReactMocks();

    const api = {
      pushUnsubscribe: jest.fn().mockResolvedValue(null)
    };

    const helpers = {
      serializePushSubscription: jest.fn(() => 'serialized-subscription'),
      base64UrlToUint8Array: jest.fn(() => new Uint8Array())
    };

    const feature = createPushFeature({ React: react.React, api, helpers });
    const { removePushSubscription } = feature.usePushNotifications({ user: { id: 'user-1' } });

    expect(typeof removePushSubscription).toBe('function');
    expect(react.callbacks[0].deps).toEqual([api, helpers.serializePushSubscription]);

    const subscription = {
      unsubscribe: jest.fn().mockResolvedValue(undefined)
    };

    const pushManager = {
      getSubscription: jest.fn().mockResolvedValue(subscription)
    };

    const registration = { pushManager };

    global.window = { PushManager: function PushManager() {} };
    global.navigator = {
      serviceWorker: {
        getRegistration: jest.fn().mockResolvedValue(registration)
      }
    };

    await removePushSubscription();

    expect(global.navigator.serviceWorker.getRegistration).toHaveBeenCalled();
    expect(pushManager.getSubscription).toHaveBeenCalled();
    expect(helpers.serializePushSubscription).toHaveBeenCalledWith(subscription);
    expect(api.pushUnsubscribe).toHaveBeenCalledWith('serialized-subscription', { silent: true });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  test('setups push notifications when prerequisites are met', async () => {
    const createPushFeature = loadFactory();
    const react = createReactMocks();

    const api = {
      pushSubscribe: jest.fn().mockResolvedValue(null),
      pushUnsubscribe: jest.fn()
    };

    const helpers = {
      serializePushSubscription: jest.fn(() => 'serialized-subscription'),
      base64UrlToUint8Array: jest.fn(() => new Uint8Array([1, 2, 3]))
    };

    const feature = createPushFeature({ React: react.React, api, helpers });

    const hook = feature.usePushNotifications({
      user: { id: 'user-1' },
      pushMeta: { available: true, vapidPublicKey: 'pk_live' }
    });

    expect(typeof hook.removePushSubscription).toBe('function');
    expect(react.refs[0].current).toEqual({ userId: null, permission: null });

    const subscription = {};

    const readyRegistration = {
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue(null),
        subscribe: jest.fn().mockResolvedValue(subscription)
      }
    };

    const registration = {
      pushManager: readyRegistration.pushManager
    };

    global.window = { PushManager: function PushManager() {} };
    global.navigator = {
      serviceWorker: {
        register: jest.fn().mockResolvedValue(registration),
        ready: Promise.resolve(readyRegistration),
        getRegistration: jest.fn().mockResolvedValue(registration)
      }
    };

    global.Notification = {
      permission: 'default',
      requestPermission: jest.fn().mockResolvedValue('granted')
    };

    const effectRecord = react.effects[0];
    expect(effectRecord.deps).toEqual([
      'user-1',
      true,
      'pk_live',
      api,
      helpers.serializePushSubscription,
      helpers.base64UrlToUint8Array
    ]);

    const cleanup = effectRecord.effect();
    await flushPromises();

    expect(global.navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(helpers.base64UrlToUint8Array).toHaveBeenCalledWith('pk_live');
    expect(readyRegistration.pushManager.getSubscription).toHaveBeenCalled();
    expect(readyRegistration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3])
    });
    expect(helpers.serializePushSubscription).toHaveBeenCalledWith(subscription);
    expect(api.pushSubscribe).toHaveBeenCalledWith('serialized-subscription', { silent: true });
    expect(react.refs[0].current).toEqual({ userId: 'user-1', permission: 'granted' });

    expect(typeof cleanup).toBe('function');
    cleanup();
  });
});

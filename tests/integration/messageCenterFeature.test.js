const path = require('path');

const messageCenterFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'message-center.js'
);

const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

function resetGlobals() {
  delete global.window;
  delete global.document;
  delete global.navigator;
  delete global.WebSocket;
  delete global.alert;
  delete global.confirm;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
}

function loadFactory() {
  global.window = {
    ListItApp: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    location: { protocol: 'https:', host: 'app.test' }
  };
  global.document = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    hidden: false
  };
  global.navigator = {};
  global.WebSocket = jest.fn(() => ({
    readyState: 1,
    send: jest.fn(),
    close: jest.fn(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null
  }));
  global.WebSocket.OPEN = 1;

  const scheduledTimeouts = [];
  const scheduledIntervals = [];
  global.setTimeout = jest.fn((fn, delay) => {
    scheduledTimeouts.push({ fn, delay });
    return scheduledTimeouts.length;
  });
  global.clearTimeout = jest.fn();
  global.setInterval = jest.fn((fn, delay) => {
    scheduledIntervals.push({ fn, delay });
    return scheduledIntervals.length;
  });
  global.clearInterval = jest.fn();
  global.alert = jest.fn();
  global.confirm = jest.fn(() => true);

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(messageCenterFeaturePath);

  return global.window.ListItApp.features.messageCenter.createMessageCenterFeature;
}

function createReactMocks(stateOverrides = []) {
  const states = [];
  const refs = [];
  const effects = [];

  const React = {
    createElement: jest.fn((type, props = {}, ...children) => ({
      type,
      props: {
        ...props,
        children: children.length <= 1 ? children[0] : children
      }
    })),
    useState: jest.fn((initial) => {
      const initialValue = typeof initial === 'function' ? initial() : initial;
      const override = stateOverrides.length ? stateOverrides.shift() : undefined;
      const record = {
        value: override !== undefined ? override : initialValue,
        setter: null
      };
      const setter = jest.fn((update) => {
        const resolved = typeof update === 'function' ? update(record.value) : update;
        record.value = resolved;
        return resolved;
      });
      record.setter = setter;
      states.push(record);
      return [record.value, setter];
    }),
    useRef: jest.fn((initial) => {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    }),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
    }),
    useCallback: jest.fn((fn) => fn),
    useMemo: jest.fn((factory) => factory())
  };

  return { React, states, refs, effects };
}

describe('message center feature integration', () => {
  beforeEach(() => {
    jest.resetModules();
    resetGlobals();
  });

  afterEach(() => {
    resetGlobals();
  });

  test('registers factory and computes unread counts from API', async () => {
    const createMessageCenterFeature = loadFactory();
    const react = createReactMocks();

    const conversations = [
      {
        id: 'c-1',
        last_message_id: 4,
        last_message_sender_id: 'seller-2',
        last_message_is_admin: true
      },
      {
        id: 'c-2',
        last_message_id: 7,
        last_message_sender_id: 'user-1'
      }
    ];

    const api = {
      listConversations: jest.fn().mockResolvedValue(conversations)
    };

    const helpers = {
      loadSeen: jest.fn(() => ({ 'c-1': 1, 'c-2': 7 })),
      saveSeen: jest.fn()
    };

    const notificationsInstance = {
      showMessageToast: jest.fn(),
      playNotificationTone: jest.fn(),
      getConversationMeta: jest.fn(() => ({})),
      handleConversationsUpdate: jest.fn(),
      resetNotifications: jest.fn(),
      messageToasts: ['toast'],
      handleToastClick: jest.fn(),
      removeToast: jest.fn()
    };

    let notificationsOptions;
    const notifications = {
      useMessageNotifications: jest.fn((options) => {
        notificationsOptions = options;
        return notificationsInstance;
      })
    };

    const onTabChange = jest.fn();
    const onClearSeller = jest.fn();

    const feature = createMessageCenterFeature({
      React: react.React,
      api,
      helpers,
      notifications
    });

    const hookValue = feature.useMessageCenter({
      user: { id: 'user-1' },
      tab: 'messages',
      onTabChange,
      onClearSeller
    });

    expect(typeof hookValue).toBe('object');
    expect(hookValue.notifications.messageToasts).toBe(notificationsInstance.messageToasts);

    expect(notifications.useMessageNotifications).toHaveBeenCalledTimes(1);
    expect(notificationsOptions).toBeDefined();
    expect(typeof notificationsOptions.onSelectConversation).toBe('function');

    notificationsOptions.onSelectConversation('c-1');
    expect(react.states[0].setter).toHaveBeenCalledWith('c-1');
    expect(onClearSeller).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith('messages');

    expect(global.window.addEventListener).not.toHaveBeenCalled();
    const focusCleanup = react.effects[3]();
    expect(global.window.addEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(global.document.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    if (typeof focusCleanup === 'function') focusCleanup();

    await react.effects[4]();
    await Promise.resolve();

    expect(api.listConversations).toHaveBeenCalledWith({ silent: true });
    expect(helpers.loadSeen).toHaveBeenCalledWith('user-1');
    expect(notificationsInstance.handleConversationsUpdate).toHaveBeenCalledWith(conversations);

    expect(react.states[1].value).toBe(1);
    expect(react.states[2].value).toBe(true);
  });

  test('requires loadSeen helper and notifications hook', () => {
    const createMessageCenterFeature = loadFactory();
    const react = createReactMocks();

    expect(() => createMessageCenterFeature({
      React: react.React,
      api: {},
      helpers: { saveSeen: jest.fn() },
      notifications: { useMessageNotifications: jest.fn() }
    })).toThrow('Message center feature requires loadSeen helper.');

    expect(() => createMessageCenterFeature({
      React: react.React,
      api: {},
      helpers: { loadSeen: jest.fn(), saveSeen: jest.fn() },
      notifications: {}
    })).toThrow('Message center feature requires useMessageNotifications hook.');
  });

  test('requires React with hook implementations', () => {
    const createMessageCenterFeature = loadFactory();

    expect(() => createMessageCenterFeature({ React: null })).toThrow('Message center feature requires React.');

    expect(() => createMessageCenterFeature({
      React: { useState: null },
      api: {},
      helpers: { loadSeen: jest.fn(), saveSeen: jest.fn() },
      notifications: { useMessageNotifications: jest.fn() }
    })).toThrow('Message center feature requires React.');
  });
});

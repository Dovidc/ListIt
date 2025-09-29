const path = require('path');

const notificationsFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'notifications.js'
);

const originalClearTimeout = global.clearTimeout;

function setupWindow(overrides = {}) {
  global.window = {
    ListItApp: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    setTimeout: jest.fn(() => 'timer-default'),
    clearTimeout: jest.fn(),
    ...overrides
  };
}

function teardownWindow() {
  delete global.window;
}

function loadFactory(overrides = {}) {
  setupWindow(overrides);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(notificationsFeaturePath);
  return global.window.ListItApp.features.notifications.createNotificationsFeature;
}

function createReactMocks() {
  const states = [];
  const refs = [];
  const effects = [];

  const React = {
    useState: jest.fn((initial) => {
      const initialValue = typeof initial === 'function' ? initial() : initial;
      const record = { value: initialValue, setter: null };
      const setter = jest.fn((update) => {
        const nextValue = typeof update === 'function' ? update(record.value) : update;
        record.value = nextValue;
        return nextValue;
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
    useCallback: jest.fn((fn) => fn)
  };

  return { React, states, refs, effects };
}

describe('notifications feature integration', () => {
  let consoleWarnSpy;

  beforeEach(() => {
    jest.resetModules();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.clearTimeout = jest.fn();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    global.clearTimeout = originalClearTimeout;
    teardownWindow();
  });

  test('requires React when creating the feature', () => {
    const createNotificationsFeature = loadFactory();

    expect(() => createNotificationsFeature({})).toThrow('Notifications feature requires React.');
  });

  test('useMessageNotifications shows toasts, manages timers, and cleans up listeners', () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1500)
      .mockReturnValue(9000);

    const createNotificationsFeature = loadFactory();
    const { React, states, refs, effects } = createReactMocks();
    const feature = createNotificationsFeature({ React });
    const notifications = feature.useMessageNotifications();

    expect(typeof notifications.showMessageToast).toBe('function');

    global.window.setTimeout
      .mockReturnValueOnce('timer-1')
      .mockReturnValueOnce('timer-2')
      .mockReturnValueOnce('timer-3');

    notifications.showMessageToast({
      messageId: 'abc',
      senderName: 'Alice',
      hasImages: false
    });

    expect(states[0].value).toHaveLength(1);
    expect(states[0].value[0]).toEqual(
      expect.objectContaining({
        id: 'msg:abc',
        title: 'Alice',
        preview: 'Tap to open the conversation.'
      })
    );
    expect(global.window.setTimeout).toHaveBeenNthCalledWith(1, expect.any(Function), 6000);
    expect(refs[0].current.get('msg:abc')).toBe('timer-1');

    const unlockCleanup = effects[0]();
    expect(global.window.addEventListener).toHaveBeenNthCalledWith(1, 'click', expect.any(Function));
    expect(global.window.addEventListener).toHaveBeenNthCalledWith(2, 'keydown', expect.any(Function));
    unlockCleanup();
    expect(global.window.removeEventListener).toHaveBeenNthCalledWith(1, 'click', expect.any(Function));
    expect(global.window.removeEventListener).toHaveBeenNthCalledWith(2, 'keydown', expect.any(Function));

    notifications.showMessageToast({
      id: 'msg:abc',
      preview: '   Hello   again   ',
      durationMs: 7000
    });

    expect(global.clearTimeout).toHaveBeenCalledWith('timer-1');
    expect(states[0].value).toHaveLength(1);
    expect(states[0].value[0]).toEqual(
      expect.objectContaining({
        id: 'msg:abc',
        preview: 'Hello again'
      })
    );
    expect(global.window.setTimeout).toHaveBeenNthCalledWith(2, expect.any(Function), 7000);
    expect(refs[0].current.get('msg:abc')).toBe('timer-2');

    states[0].value = [
      { id: 'stale', ts: 0 },
      { ...states[0].value[0] }
    ];
    refs[0].current.set('stale', 'timer-stale');

    notifications.showMessageToast({
      messageId: 'next',
      listingTitle: 'Desk'
    });

    expect(states[0].value).toHaveLength(1);
    expect(states[0].value[0]).toEqual(
      expect.objectContaining({
        id: 'msg:next',
        title: 'Desk'
      })
    );
    expect(global.window.setTimeout).toHaveBeenNthCalledWith(3, expect.any(Function), 6000);
    expect(refs[0].current.get('msg:next')).toBe('timer-3');

    const timersCleanup = effects[1]();
    timersCleanup();
    expect(global.clearTimeout).toHaveBeenCalledWith('timer-stale', 'stale', expect.any(Map));
    expect(global.clearTimeout).toHaveBeenCalledWith('timer-3', 'msg:next', expect.any(Map));
    expect(refs[0].current.size).toBe(0);

    nowSpy.mockRestore();
  });

  test('handleToastClick selects conversations and resetNotifications clears state', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2500);

    const createNotificationsFeature = loadFactory();
    const { React, states, refs } = createReactMocks();
    const onSelectConversation = jest.fn();
    const feature = createNotificationsFeature({ React });
    const notifications = feature.useMessageNotifications({ onSelectConversation });

    global.window.setTimeout.mockReturnValue('timer-click');

    notifications.showMessageToast({
      id: 'toast-1',
      conversationId: 'convo-1',
      preview: 'Message preview'
    });

    expect(refs[0].current.get('toast-1')).toBe('timer-click');
    expect(states[0].value).toHaveLength(1);

    notifications.handleToastClick(states[0].value[0]);
    expect(onSelectConversation).toHaveBeenCalledWith('convo-1');
    expect(global.clearTimeout).toHaveBeenCalledWith('timer-click');
    expect(states[0].value).toEqual([]);

    refs[0].current.set('toast-2', 'timer-2');
    refs[1].current.set('toast-2', { id: 'toast-2' });
    states[0].value = [{ id: 'toast-2', ts: 123 }];

    notifications.resetNotifications();

    expect(global.clearTimeout).toHaveBeenCalledWith('timer-2', 'toast-2', expect.any(Map));
    expect(states[0].value).toEqual([]);
    expect(refs[0].current.size).toBe(0);
    expect(refs[1].current.size).toBe(0);

    nowSpy.mockRestore();
  });

  test('playNotificationTone reuses audio context and unlock handler resumes when suspended', () => {
    const oscillator = {
      frequency: { setValueAtTime: jest.fn() },
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      type: ''
    };
    const gainNode = {
      gain: {
        setValueAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn()
      },
      connect: jest.fn()
    };
    const audioCtx = {
      currentTime: 5,
      state: 'suspended',
      resume: jest.fn(() => Promise.resolve()),
      createOscillator: jest.fn(() => oscillator),
      createGain: jest.fn(() => gainNode),
      destination: {}
    };

    const createNotificationsFeature = loadFactory({ AudioContext: jest.fn(() => audioCtx) });
    const { React, effects } = createReactMocks();
    const feature = createNotificationsFeature({ React });
    const notifications = feature.useMessageNotifications();

    const unlockCleanup = effects[0]();
    const unlock = global.window.addEventListener.mock.calls[0][1];
    unlock();
    expect(global.window.AudioContext).toHaveBeenCalledTimes(1);
    expect(audioCtx.resume).toHaveBeenCalledTimes(1);

    notifications.playNotificationTone();
    expect(global.window.AudioContext).toHaveBeenCalledTimes(1);
    expect(audioCtx.resume).toHaveBeenCalledTimes(2);
    expect(audioCtx.createOscillator).toHaveBeenCalledTimes(1);
    expect(audioCtx.createGain).toHaveBeenCalledTimes(1);
    expect(oscillator.connect).toHaveBeenCalledWith(gainNode);
    expect(gainNode.connect).toHaveBeenCalledWith(audioCtx.destination);
    expect(oscillator.start).toHaveBeenCalledWith(5);
    expect(oscillator.stop).toHaveBeenCalledWith(5.5);

    audioCtx.state = 'running';
    notifications.playNotificationTone();
    expect(global.window.AudioContext).toHaveBeenCalledTimes(1);
    expect(audioCtx.createOscillator).toHaveBeenCalledTimes(2);

    unlockCleanup();
  });
});


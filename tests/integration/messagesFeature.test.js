const path = require('path');

const messagesFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'messages.js'
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
    location: { protocol: 'https:', host: 'app.test' }
  };
  global.document = { body: {} };
  global.navigator = {};
  global.WebSocket = jest.fn(() => ({
    readyState: 1,
    send: jest.fn(),
    close: jest.fn()
  }));

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(messagesFeaturePath);

  return global.window.ListItApp.features.messages.createMessagesFeature;
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

function createDependencies({ stateOverrides, filePreviews } = {}) {
  const react = createReactMocks(stateOverrides ? [...stateOverrides] : []);
  const ReactDOM = {
    createPortal: jest.fn((node) => node)
  };

  const api = {
    listConversations: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue({}),
    deleteConversation: jest.fn().mockResolvedValue(undefined),
    ensureConversation: jest.fn().mockResolvedValue({ id: 'conversation-1' })
  };

  const uploads = {
    uploadOneMessageImage: jest.fn().mockResolvedValue('https://cdn/image.jpg'),
    useFilePreviews: jest.fn(() => filePreviews || [])
  };

  const helpers = {
    loadSeen: jest.fn(() => ({})),
    saveSeen: jest.fn()
  };

  const components = {
    Lightbox: jest.fn((props) => ({ type: 'Lightbox', props })),
    ImageWithSkeleton: jest.fn((props) => ({ type: 'ImageWithSkeleton', props }))
  };

  return {
    React: react.React,
    ReactDOM,
    api,
    uploads,
    helpers,
    components,
    __mocks: { react }
  };
}

describe('messages feature integration', () => {
  let scheduledTimeouts;
  let scheduledIntervals;

  beforeEach(() => {
    jest.resetModules();
    resetGlobals();
    scheduledTimeouts = [];
    scheduledIntervals = [];
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
  });

  afterEach(() => {
    resetGlobals();
  });

  test('registers factory and enforces dependency contract', () => {
    const createMessagesFeature = loadFactory();

    expect(typeof createMessagesFeature).toBe('function');
    expect(() => createMessagesFeature({})).toThrow('Messages feature requires React.');

    const React = { useState: () => {} };
    expect(() => createMessagesFeature({ React })).toThrow('Messages feature requires ReactDOM.');

    const ReactDOM = { createPortal: jest.fn() };
    expect(() => createMessagesFeature({ React, ReactDOM })).toThrow('Messages feature requires an API client.');

    const api = {};
    expect(() => createMessagesFeature({ React, ReactDOM, api })).toThrow('Messages feature requires uploadOneMessageImage helper.');

    const uploads = { uploadOneMessageImage: () => {} };
    expect(() => createMessagesFeature({ React, ReactDOM, api, uploads })).toThrow('Messages feature requires useFilePreviews hook.');

    const uploadsFull = { ...uploads, useFilePreviews: () => [] };
    expect(() => createMessagesFeature({ React, ReactDOM, api, uploads: uploadsFull })).toThrow('Messages feature requires loadSeen helper.');

    const helpers = { loadSeen: () => ({}) };
    expect(() => createMessagesFeature({ React, ReactDOM, api, uploads: uploadsFull, helpers })).toThrow('Messages feature requires saveSeen helper.');

    const helpersFull = { loadSeen: () => ({}), saveSeen: () => {} };
    expect(() => createMessagesFeature({ React, ReactDOM, api, uploads: uploadsFull, helpers: helpersFull })).toThrow('Messages feature requires media components.');
  });

  test('useMessagesPanelState send uploads images, sends message, and refreshes data', async () => {
    const createMessagesFeature = loadFactory();
    const fileA = { name: 'photo-a.jpg', size: 1024, type: 'image/jpeg' };
    const fileB = { name: 'photo-b.jpg', size: 2048, type: 'image/jpeg' };

    const deps = createDependencies({
      stateOverrides: [
        [], // conversations
        'convo-1', // activeId
        [], // messages
        false, // loadingMsgs
        'Hello there', // input
        [fileA, fileB], // imgFiles
        { open: false, images: [], index: 0 }, // lightbox state
        true // isAtBottom
      ],
      filePreviews: [
        { url: 'preview-a' },
        { url: 'preview-b' }
      ]
    });

    deps.uploads.uploadOneMessageImage
      .mockResolvedValueOnce('https://cdn/photo-a.jpg')
      .mockResolvedValueOnce('https://cdn/photo-b.jpg');
    deps.api.getMessages.mockResolvedValue([{ id: 99, sender_id: 7 }]);
    deps.api.listConversations.mockResolvedValue([{ id: 'convo-1', last_message_id: 99 }]);

    const onSeenChange = jest.fn();
    const onConversationsUpdate = jest.fn();

    const feature = createMessagesFeature(deps);
    const { useMessagesPanelState } = feature;

    const state = useMessagesPanelState({
      user: { id: 5, paypal_email: 'seller@pay.test', location_preset: '123 Anywhere Rd' },
      initialActiveId: 'convo-1',
      onSeenChange,
      onConversationsUpdate
    });

    const { refs, states } = deps.__mocks.react;

    await state.send();

    expect(deps.uploads.uploadOneMessageImage).toHaveBeenCalledTimes(2);
    expect(deps.uploads.uploadOneMessageImage).toHaveBeenNthCalledWith(1, fileA);
    expect(deps.uploads.uploadOneMessageImage).toHaveBeenNthCalledWith(2, fileB);

    expect(deps.api.sendMessage).toHaveBeenCalledWith('convo-1', 'Hello there', [
      'https://cdn/photo-a.jpg',
      'https://cdn/photo-b.jpg'
    ]);

    expect(states[4].setter).toHaveBeenCalledWith('');
    expect(states[5].setter).toHaveBeenCalledWith([]);

    expect(deps.api.getMessages).toHaveBeenCalledWith('convo-1', { silent: true });
    expect(states[2].setter).toHaveBeenCalledWith([{ id: 99, sender_id: 7 }]);
    expect(onSeenChange).toHaveBeenCalledWith('convo-1', 99);

    expect(deps.api.listConversations).toHaveBeenCalledWith({ silent: true });
    expect(onConversationsUpdate).toHaveBeenCalledWith([{ id: 'convo-1', last_message_id: 99 }]);

    expect(global.setTimeout).toHaveBeenCalled();
    const timeoutCall = global.setTimeout.mock.calls.find(([, delay]) => delay === 100);
    expect(timeoutCall).toBeTruthy();
    const timeoutCallback = timeoutCall[0];

    const msgsContainerRef = refs[5];
    msgsContainerRef.current = { scrollTop: 0, scrollHeight: 600, clientHeight: 300 };
    timeoutCallback();
    expect(msgsContainerRef.current.scrollTop).toBe(600);

    deps.api.sendMessage.mockClear();
    deps.api.getMessages.mockClear();
    deps.api.listConversations.mockClear();

    const sentLocation = await state.sendLocationPreset();
    expect(sentLocation).toBe(true);
    expect(deps.api.sendMessage).toHaveBeenCalledWith('convo-1', 'My address: 123 Anywhere Rd', []);
    expect(deps.api.getMessages).toHaveBeenCalledWith('convo-1', { silent: true });
    expect(deps.api.listConversations).toHaveBeenCalledWith({ silent: true });

    expect(global.alert).not.toHaveBeenCalled();
  });

  test('useMessageActions orchestrates conversation flow and seen tracking', async () => {
    const createMessagesFeature = loadFactory();
    const deps = createDependencies();

    deps.api.ensureConversation.mockResolvedValue({ id: 'convo-22' });

    const onConversationOpened = jest.fn();
    const onTabChange = jest.fn();
    const onSellerCleared = jest.fn();
    const recomputeUnread = jest.fn();

    const feature = createMessagesFeature(deps);
    const { useMessageActions } = feature;

    const actions = useMessageActions({
      user: { id: 5 },
      onConversationOpened,
      onTabChange,
      onSellerCleared,
      recomputeUnread
    });

    await actions.startMessage({ id: 101, user_id: 9 });

    expect(onSellerCleared).toHaveBeenCalledTimes(1);
    expect(deps.api.ensureConversation).toHaveBeenCalledWith({
      with_user_id: 9,
      listing_id: 101
    });
    expect(onConversationOpened).toHaveBeenCalledWith('convo-22');
    expect(onTabChange).toHaveBeenCalledWith('messages');
    expect(global.alert).not.toHaveBeenCalled();

    await actions.startDirectMessage('9');
    expect(deps.api.ensureConversation).toHaveBeenCalledWith({ with_user_id: 9 });

    await actions.startDirectMessage(5);
    expect(deps.api.ensureConversation).toHaveBeenCalledTimes(2);

    deps.helpers.loadSeen.mockReturnValue({});

    actions.handleSeen('convo-22', 33);
    expect(deps.helpers.saveSeen).toHaveBeenCalledWith(5, { 'convo-22': 33 });

    const seenTimeout = global.setTimeout.mock.calls.find(([, delay]) => delay === 0)[0];
    seenTimeout();
    await Promise.resolve();
    expect(recomputeUnread).toHaveBeenCalledTimes(1);
  });
});

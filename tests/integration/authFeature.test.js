const path = require('path');

const authFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'auth.js'
);

function resetGlobals() {
  delete global.window;
  delete global.document;
  delete global.React;
}

function loadFactory() {
  global.window = { ListItApp: { features: {} } };
  global.document = { body: {} };

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(authFeaturePath);
  return global.window.ListItApp.features.auth.createAuthFeature;
}

function createReactMocks({ stateOverrides = [] } = {}) {
  const initialOverrides = [...stateOverrides];
  const states = [];
  const effects = [];
  const memos = [];
  const callbacks = [];
  const contextValues = new Map();
  const contexts = [];

  let stateCursor = 0;
  let effectCursor = 0;
  let memoCursor = 0;
  let callbackCursor = 0;

  function prepareForRender() {
    stateCursor = 0;
    effectCursor = 0;
    memoCursor = 0;
    callbackCursor = 0;
  }

  const React = {
    Fragment: Symbol('Fragment'),
    createElement: jest.fn((type, props = {}, ...children) => ({
      type,
      props: {
        ...props,
        children: children.length <= 1 ? children[0] : children
      }
    })),
    useState: jest.fn((initial) => {
      const position = stateCursor;
      stateCursor += 1;

      if (!states[position]) {
        const initialValue = typeof initial === 'function' ? initial() : initial;
        const override = initialOverrides.length ? initialOverrides.shift() : undefined;
        const record = { value: override !== undefined ? override : initialValue };
        record.setter = jest.fn((update) => {
          const nextValue = typeof update === 'function' ? update(record.value) : update;
          record.value = nextValue;
          return nextValue;
        });
        states[position] = record;
      }

      return [states[position].value, states[position].setter];
    }),
    useEffect: jest.fn((effect) => {
      effects[effectCursor] = effect;
      effectCursor += 1;
    }),
    useMemo: jest.fn((factory) => {
      const value = factory();
      memos[memoCursor] = value;
      memoCursor += 1;
      return value;
    }),
    useCallback: jest.fn((fn) => {
      callbacks[callbackCursor] = fn;
      callbackCursor += 1;
      return fn;
    }),
    useContext: jest.fn((context) => {
      if (contextValues.has(context)) {
        return contextValues.get(context);
      }
      return context?.defaultValue ?? null;
    }),
    createContext: jest.fn((defaultValue) => {
      const context = { defaultValue };
      function Provider(providerProps) {
        return { type: 'ContextProvider', props: providerProps };
      }
      context.Provider = Provider;
      contexts.push(context);
      return context;
    })
  };

  return { React, states, effects, memos, callbacks, contextValues, contexts, prepareForRender };
}

function createDependencies({ react, api: apiOverrides = {}, ReactDOM: reactDomOverrides = {} } = {}) {
  const ReactDOM = {
    createPortal: jest.fn((node, target) => ({ node, target })),
    ...reactDomOverrides
  };

  const api = {
    me: jest.fn().mockResolvedValue(null),
    login: jest.fn().mockResolvedValue({}),
    register: jest.fn().mockResolvedValue({}),
    ...apiOverrides
  };

  return {
    api,
    ReactDOM,
    __mocks: {
      react
    }
  };
}

function findNode(root, predicate) {
  if (!root || typeof root !== 'object') return null;
  if (predicate(root)) return root;

  const { children } = root.props || {};
  if (!children) return null;

  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findNode(child, predicate);
      if (match) return match;
    }
  } else {
    return findNode(children, predicate);
  }

  return null;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.resetModules();
  resetGlobals();
});

afterEach(() => {
  resetGlobals();
});

describe('auth feature integration', () => {
  test('registers factory and enforces dependency contract', () => {
    const react = createReactMocks();
    global.React = react.React;

    const createAuthFeature = loadFactory();

    expect(typeof createAuthFeature).toBe('function');
    expect(() => createAuthFeature({})).toThrow('Auth feature requires an API client.');

    const api = {};
    expect(() => createAuthFeature({ api })).toThrow('Auth feature requires ReactDOM.');

    const dependencies = { api: {}, ReactDOM: { createPortal: jest.fn() } };
    expect(() => createAuthFeature(dependencies)).not.toThrow();
  });

  test('AuthProvider fetches current user and normalizes push meta', async () => {
    const react = createReactMocks();
    global.React = react.React;
    const createAuthFeature = loadFactory();

    const deps = createDependencies({
      react,
      api: {
        me: jest.fn().mockResolvedValue({
          id: 'user-1',
          push_meta: { available: true, vapid_public_key: '  pk_live ' }
        })
      }
    });

    const feature = createAuthFeature(deps);
    const { AuthProvider } = feature;

    react.prepareForRender();
    const providerElement = AuthProvider({ children: 'child' });
    expect(providerElement.type).toBe(react.contexts[0].Provider);
    expect(providerElement.props.children).toBe('child');

    expect(deps.api.me).not.toHaveBeenCalled();

    const effect = react.effects[0];
    const cleanup = effect();
    expect(typeof cleanup).toBe('function');

    await flushPromises();

    expect(deps.api.me).toHaveBeenCalledTimes(1);
    expect(react.states[0].setter).toHaveBeenCalledWith({
      id: 'user-1',
      push_meta: { available: true, vapid_public_key: '  pk_live ' }
    });
    expect(react.states[1].setter).toHaveBeenCalledWith({
      available: true,
      vapidPublicKey: 'pk_live'
    });

    const contextValue = providerElement.props.value;
    expect(typeof contextValue.setUser).toBe('function');

    contextValue.setUser({ pushMeta: { available: false, vapidPublicKey: '' } });
    expect(react.states[0].setter).toHaveBeenLastCalledWith({ pushMeta: { available: false, vapidPublicKey: '' } });
    expect(react.states[1].setter).toHaveBeenLastCalledWith({
      available: false,
      vapidPublicKey: null
    });

    cleanup();
  });

  test('AuthProvider ignores late responses after unmount', async () => {
    const react = createReactMocks();
    global.React = react.React;
    const createAuthFeature = loadFactory();

    let resolveMe;
    const deps = createDependencies({
      react,
      api: {
        me: jest.fn().mockImplementation(() => new Promise((resolve) => {
          resolveMe = resolve;
        }))
      }
    });

    const feature = createAuthFeature(deps);
    const { AuthProvider } = feature;

    react.prepareForRender();
    AuthProvider({ children: null });

    const effect = react.effects[0];
    const cleanup = effect();
    cleanup();

    resolveMe({ id: 'late-user' });
    await flushPromises();

    expect(react.states[0].setter).not.toHaveBeenCalled();
    expect(react.states[1].setter).not.toHaveBeenCalled();
  });

  test('AuthModal login uses API, updates context, and closes on success', async () => {
    const react = createReactMocks();
    global.React = react.React;
    const createAuthFeature = loadFactory();

    global.window.addEventListener = jest.fn();
    global.window.removeEventListener = jest.fn();

    const setUser = jest.fn();
    const deps = createDependencies({
      react,
      api: {
        login: jest.fn().mockResolvedValue({ id: 'auth-user' })
      }
    });

    const feature = createAuthFeature(deps);
    const { AuthModal } = feature;

    const context = react.contexts[0];
    react.contextValues.set(context, { setUser });

    const onClose = jest.fn();
    const onSuccess = jest.fn();

    react.prepareForRender();
    const firstRender = AuthModal({
      isOpen: true,
      onClose,
      initialMode: 'login',
      onSuccess
    });

    expect(deps.ReactDOM.createPortal).toHaveBeenCalledTimes(1);
    expect(firstRender.target).toBe(global.document.body);

    const [initialResetEffect, initialKeydownEffect] = react.effects;
    initialResetEffect();
    const removeListener = initialKeydownEffect();
    expect(global.window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    const { states } = react;
    states[2].setter('user@example.com');
    states[3].setter('s3cret');

    react.prepareForRender();
    const modalResult = AuthModal({
      isOpen: true,
      onClose,
      initialMode: 'login',
      onSuccess
    });

    expect(deps.ReactDOM.createPortal).toHaveBeenCalledTimes(2);
    const [modalTree, target] = deps.ReactDOM.createPortal.mock.calls[1];
    expect(target).toBe(global.document.body);
    expect(modalResult).toEqual({ node: modalTree, target: global.document.body });

    const formNode = findNode(modalTree, (node) => node?.type === 'form');
    expect(formNode).toBeTruthy();

    const submitEvent = { preventDefault: jest.fn() };
    await formNode.props.onSubmit(submitEvent);

    expect(submitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.api.login).toHaveBeenCalledWith('user@example.com', 's3cret');
    expect(setUser).toHaveBeenCalledWith({ id: 'auth-user' });
    expect(onSuccess).toHaveBeenCalledWith({ id: 'auth-user' });
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(states[8].setter).toHaveBeenCalledWith('');
    const loadingCalls = states[10].setter.mock.calls.map((call) => call[0]);
    expect(loadingCalls.includes(true)).toBe(true);
    expect(loadingCalls[loadingCalls.length - 1]).toBe(false);

    removeListener();
    expect(global.window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  test('AuthModal register surfaces errors and toggles mode controls', async () => {
    const react = createReactMocks();
    global.React = react.React;
    const createAuthFeature = loadFactory();

    global.window.addEventListener = jest.fn();
    global.window.removeEventListener = jest.fn();

    const setUser = jest.fn();
    const deps = createDependencies({
      react,
      api: {
        register: jest.fn().mockRejectedValue(new Error('Email taken'))
      }
    });

    const feature = createAuthFeature(deps);
    const { AuthModal } = feature;

    const context = react.contexts[0];
    react.contextValues.set(context, { setUser });

    const onClose = jest.fn();

    react.prepareForRender();
    const firstRender = AuthModal({
      isOpen: true,
      onClose,
      initialMode: 'register',
      onSuccess: undefined
    });

    expect(deps.ReactDOM.createPortal).toHaveBeenCalledTimes(1);
    expect(firstRender.target).toBe(global.document.body);

    const [initialResetEffect, initialKeydownEffect] = react.effects;
    initialResetEffect();
    const removeListener = initialKeydownEffect();

    const { states } = react;
    states[1].setter('Jane');
    states[2].setter('jane@example.com');
    states[3].setter('pw123');

    react.prepareForRender();
    const portal = AuthModal({
      isOpen: true,
      onClose,
      initialMode: 'register',
      onSuccess: undefined
    });

    expect(deps.ReactDOM.createPortal).toHaveBeenCalledTimes(2);
    const modalTree = portal.node;

    const formNode = findNode(modalTree, (node) => node?.type === 'form');
    const submitEvent = { preventDefault: jest.fn() };
    await formNode.props.onSubmit(submitEvent);

    expect(submitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.api.register).toHaveBeenCalledWith({
      username: 'Jane',
      email: 'jane@example.com',
      password: 'pw123'
    });
    const loadingCalls = states[10].setter.mock.calls.map((call) => call[0]);
    expect(loadingCalls.includes(true)).toBe(true);
    expect(loadingCalls[loadingCalls.length - 1]).toBe(false);

    const errorCalls = states[8].setter.mock.calls;
    expect(errorCalls[errorCalls.length - 1][0]).toBe('Email taken');

    expect(onClose).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();

    const toggleButton = findNode(modalTree, (node) => node?.type === 'button' && node?.props?.children === 'Log In');
    expect(toggleButton).toBeTruthy();
    toggleButton.props.onClick();
    expect(states[0].setter).toHaveBeenCalledWith('login');

    removeListener();
    expect(global.window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

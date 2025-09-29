const path = require('path');

const appViewFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'app-view.js'
);

function resetGlobals() {
  delete global.window;
}

function loadFactory() {
  jest.resetModules();
  resetGlobals();
  global.window = { ListItApp: { features: {} } };
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(appViewFeaturePath);
  return global.window.ListItApp.features.appView.createAppViewFeature;
}

function createReactMocks(stateOverrides = []) {
  const states = [];
  const effects = [];
  const React = {
    createElement: jest.fn(),
    Fragment: Symbol('Fragment'),
    memo: jest.fn((component) => component),
    useCallback: jest.fn((fn) => fn),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
    }),
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
    })
  };

  return { React, states, effects };
}

function runEffects(effects) {
  effects.forEach((effect) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') {
      cleanup();
    }
  });
}

describe('app view feature integration', () => {
  afterEach(() => {
    resetGlobals();
  });

  test('registers factory and enforces dependency contract', () => {
    const createAppViewFeature = loadFactory();

    expect(typeof createAppViewFeature).toBe('function');
    expect(() => createAppViewFeature({})).toThrow('App view feature requires React.');

    const React = { useState: () => {} };
    expect(() => createAppViewFeature({ React })).toThrow('App view feature requires isMobileDevice helper.');
  });

  test('provides tab management and banner helpers', () => {
    const createAppViewFeature = loadFactory();
    const { React, states, effects } = createReactMocks();
    const isMobileDevice = jest.fn(() => false);

    const feature = createAppViewFeature({ React, helpers: { isMobileDevice } });
    const view = feature.useAppView({ user: { id: 'user-1' } });

    expect(isMobileDevice).toHaveBeenCalledTimes(1);
    expect(states[0].value).toBe('browse');
    expect(states[1].value).toBeNull();

    view.handleTabChange('admin');
    expect(states[0].setter).not.toHaveBeenCalled();

    view.handleTabChange('nearby');
    expect(states[0].setter).not.toHaveBeenCalled();

    view.handleTabChange('messages');
    expect(states[0].setter).toHaveBeenCalledWith('messages');
    expect(states[3].setter).toHaveBeenCalledWith(null);

    view.showLockedBanner();
    expect(states[1].setter).toHaveBeenCalledWith(expect.objectContaining({ type: 'locked' }));

    view.dismissBanner();
    expect(states[1].setter).toHaveBeenCalledWith(null);

    view.openAuthModal('signup');
    expect(states[2].setter).toHaveBeenCalledWith({ isOpen: true, mode: 'signup' });

    runEffects(effects);
  });

  test('redirects away from restricted tabs when dependencies change', () => {
    const createAppViewFeature = loadFactory();

    const nonAdmin = createReactMocks(['admin']);
    const featureNonAdmin = createAppViewFeature({
      React: nonAdmin.React,
      helpers: { isMobileDevice: jest.fn(() => true) }
    });
    featureNonAdmin.useAppView({ user: { is_admin: false } });
    runEffects(nonAdmin.effects);
    expect(nonAdmin.states[0].setter).toHaveBeenCalledWith('browse');

    const noUser = createReactMocks(['messages']);
    const featureNoUser = createAppViewFeature({
      React: noUser.React,
      helpers: { isMobileDevice: jest.fn(() => true) }
    });
    featureNoUser.useAppView();
    runEffects(noUser.effects);
    expect(noUser.states[0].setter).toHaveBeenCalledWith('browse');

    const notMobile = createReactMocks(['nearby']);
    const featureNotMobile = createAppViewFeature({
      React: notMobile.React,
      helpers: { isMobileDevice: jest.fn(() => false) }
    });
    featureNotMobile.useAppView({ user: { id: 'user-1' } });
    runEffects(notMobile.effects);
    expect(notMobile.states[0].setter).toHaveBeenCalledWith('browse');
  });
});

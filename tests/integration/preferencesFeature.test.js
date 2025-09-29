const path = require('path');

const preferencesFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'preferences.js'
);

function resetGlobals() {
  delete global.window;
  delete global.document;
  delete global.navigator;
  delete global.localStorage;
}

function loadFactory() {
  global.window = { ListItApp: { features: {} } };
  global.document = { body: {} };

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(preferencesFeaturePath);
  return global.window.ListItApp.features.preferences.createPreferencesFeature;
}

function createReactMocks() {
  const states = [];
  const effects = [];

  let stateCursor = 0;
  let effectCursor = 0;

  function prepareForRender() {
    stateCursor = 0;
    effectCursor = 0;
  }

  const React = {
    useState: jest.fn((initial) => {
      const position = stateCursor;
      stateCursor += 1;

      if (!states[position]) {
        const initialValue = typeof initial === 'function' ? initial() : initial;
        const record = { value: initialValue };
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
    useMemo: jest.fn((factory) => factory())
  };

  return { React, states, effects, prepareForRender };
}

function runEffects(effects) {
  for (const effect of effects) {
    if (typeof effect === 'function') {
      effect();
    }
  }
}

beforeEach(() => {
  jest.resetModules();
  resetGlobals();
});

afterEach(() => {
  resetGlobals();
});

describe('preferences feature integration', () => {
  test('registers factory and enforces dependency contract', () => {
    const createPreferencesFeature = loadFactory();

    expect(typeof createPreferencesFeature).toBe('function');
    expect(() => createPreferencesFeature({})).toThrow('Preferences feature requires React.');

    const React = {};
    expect(() => createPreferencesFeature({ React })).toThrow('Preferences feature requires React.');

    React.useState = jest.fn();
    React.useEffect = jest.fn();
    React.useMemo = jest.fn();

    expect(() => createPreferencesFeature({ React })).not.toThrow();
  });

  test('useAppPreferences exposes toggles backed by localStorage', () => {
    const store = {
      listit_auto_list: '1',
      listit_ai_descriptions: '0',
      listit_auto_post_nearby: '1'
    };

    global.localStorage = {
      getItem: jest.fn((key) => (key in store ? store[key] : null)),
      setItem: jest.fn((key, value) => {
        store[key] = value;
      })
    };

    const createPreferencesFeature = loadFactory();
    const react = createReactMocks();

    const feature = createPreferencesFeature({ React: react.React });
    const { useAppPreferences } = feature;

    function renderHook() {
      react.prepareForRender();
      return useAppPreferences();
    }

    let preferences = renderHook();

    expect(preferences.autoListEnabled).toBe(true);
    expect(preferences.aiDescriptionEnabled).toBe(false);
    expect(preferences.autoPostNearbyEnabled).toBe(true);

    runEffects(react.effects);

    expect(global.localStorage.getItem).toHaveBeenCalledWith('listit_auto_list');
    expect(global.localStorage.getItem).toHaveBeenCalledWith('listit_ai_descriptions');
    expect(global.localStorage.getItem).toHaveBeenCalledWith('listit_auto_post_nearby');

    expect(global.localStorage.setItem).toHaveBeenCalledWith('listit_auto_list', '1');
    expect(global.localStorage.setItem).toHaveBeenCalledWith('listit_ai_descriptions', '0');
    expect(global.localStorage.setItem).toHaveBeenCalledWith('listit_auto_post_nearby', '1');

    preferences.setAiDescriptionEnabled(true);
    preferences.setAutoPostNearbyEnabled(false);

    preferences = renderHook();

    expect(preferences.aiDescriptionEnabled).toBe(true);
    expect(preferences.autoPostNearbyEnabled).toBe(false);

    runEffects(react.effects);

    expect(global.localStorage.setItem).toHaveBeenCalledWith('listit_ai_descriptions', '1');
    expect(global.localStorage.setItem).toHaveBeenCalledWith('listit_auto_post_nearby', '0');
  });
});

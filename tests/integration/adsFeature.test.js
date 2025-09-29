const path = require('path');

const adsFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'ads.js'
);

function resetGlobals() {
  delete global.window;
}

function loadFactory() {
  jest.resetModules();
  resetGlobals();
  global.window = { ListItApp: { features: {} } };
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(adsFeaturePath);
  return global.window.ListItApp.features.ads.createAdsFeature;
}

function createReactMocks(stateOverrides = []) {
  const states = [];
  const effects = [];
  const React = {
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
    useCallback: jest.fn((fn) => fn),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
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

describe('ads feature integration', () => {
  afterEach(() => {
    resetGlobals();
    jest.restoreAllMocks();
  });

  test('registers factory and enforces dependency contract', () => {
    const createAdsFeature = loadFactory();

    expect(typeof createAdsFeature).toBe('function');
    expect(() => createAdsFeature({})).toThrow('Ads feature requires React.');

    const React = { useState: () => {} };
    expect(() => createAdsFeature({ React })).toThrow('Ads feature requires an API client.');
  });

  test('loads ads on mount and refreshes on demand', async () => {
    const createAdsFeature = loadFactory();
    const { React, states, effects } = createReactMocks();
    const listAds = jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const api = { listAds };

    const feature = createAdsFeature({ React, api });
    const { useAds } = feature;
    const ads = useAds();

    expect(typeof ads.refreshAds).toBe('function');
    runEffects(effects);
    await Promise.resolve();

    expect(listAds).toHaveBeenCalledWith({ silent: true });
    expect(states[0].setter).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);

    states[0].setter.mockClear();
    listAds.mockResolvedValueOnce([{ id: 3 }]);
    await ads.refreshAds();
    expect(listAds).toHaveBeenCalledTimes(2);
    expect(states[0].setter).toHaveBeenCalledWith([{ id: 3 }]);
  });

  test('handles refresh errors by logging and clearing ads', async () => {
    const createAdsFeature = loadFactory();
    const { React, states, effects } = createReactMocks();
    const listAds = jest.fn().mockRejectedValue(new Error('network'));
    const api = { listAds };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const feature = createAdsFeature({ React, api });
    const { useAds } = feature;
    const ads = useAds();

    runEffects(effects);
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith('Failed to load ads', expect.any(Error));
    expect(states[0].setter).toHaveBeenCalledWith([]);

    errorSpy.mockClear();
    listAds.mockRejectedValueOnce(new Error('boom'));
    states[0].setter.mockClear();
    await ads.refreshAds();
    expect(errorSpy).toHaveBeenCalledWith('Failed to load ads', expect.any(Error));
    expect(states[0].setter).toHaveBeenCalledWith([]);
  });
});

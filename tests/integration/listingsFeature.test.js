const path = require('path');

const listingsFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'listings.js'
);

const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
const originalAlert = global.alert;

function resetGlobals() {
  delete global.window;
  delete global.document;
  delete global.navigator;
  delete global.IntersectionObserver;
  if (originalAlert === undefined) delete global.alert;
  else global.alert = originalAlert;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
}

function loadFactory() {
  global.window = { ListItApp: {} };
  global.document = { body: {} };
  global.navigator = {};

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(listingsFeaturePath);
  return global.window.ListItApp.features.listings.createListingsFeature;
}

function createReactMocks(stateOverrides = []) {
  const states = [];
  const effects = [];
  const refs = [];
  const memos = [];

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
      const record = { value: override !== undefined ? override : initialValue, setter: null };
      const setter = jest.fn((update) => {
        const nextValue = typeof update === 'function' ? update(record.value) : update;
        record.value = nextValue;
        return nextValue;
      });
      record.setter = setter;
      states.push(record);
      return [record.value, setter];
    }),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
    }),
    useMemo: jest.fn((factory) => {
      const value = factory();
      memos.push(value);
      return value;
    }),
    useRef: jest.fn((initial) => {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    }),
    useCallback: jest.fn((fn) => fn)
  };

  return { React, states, effects, refs, memos };
}

function createDependencies({ stateOverrides, helpers: helperOverrides = {}, api: apiOverrides = {}, uploads: uploadOverrides = {} } = {}) {
  const react = createReactMocks(stateOverrides ? [...stateOverrides] : []);

  const helpers = {
    normalizeListingsResponse: jest.fn(() => ({ rows: [], hasNext: false, nextCursor: null })),
    asArray: jest.fn((value) => (Array.isArray(value) ? value : [])),
    selectPrimaryListingImage: jest.fn(() => ''),
    pageSize: 75,
    ...helperOverrides
  };

  const api = {
    listAll: jest.fn().mockResolvedValue({}),
    listMine: jest.fn().mockResolvedValue([]),
    getCoversBatch: jest.fn().mockResolvedValue([]),
    markListingSold: jest.fn().mockResolvedValue(undefined),
    getListingImages: jest.fn().mockResolvedValue([]),
    searchCities: jest.fn().mockResolvedValue([]),
    ...apiOverrides
  };

  const uploads = {
    prepareListingForModal: jest.fn((listing) => ({ payload: listing, images: [] })),
    warmListingImages: jest.fn(),
    ...uploadOverrides
  };

  return {
    React: react.React,
    api,
    helpers,
    uploads,
    __mocks: { react }
  };
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;

  const { children } = node.props || {};
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

beforeEach(() => {
  jest.resetModules();
  resetGlobals();
});

afterEach(() => {
  resetGlobals();
});

describe('listings feature integration', () => {
  test('registers factory and enforces dependency contract', () => {
    const createListingsFeature = loadFactory();

    expect(typeof createListingsFeature).toBe('function');
    expect(() => createListingsFeature({})).toThrow('Listings feature requires React.');

    const React = { useState: jest.fn() };
    expect(() => createListingsFeature({ React })).toThrow('Listings feature requires an API client.');

    const api = {};
    expect(() => createListingsFeature({ React, api })).toThrow('Listings feature requires normalizeListingsResponse helper.');
  });

  test('useListingsFeature refreshes listings, loads mine, and caches covers', async () => {
    const createListingsFeature = loadFactory();
    const listResponse = { rows: [{ id: 'listing-1' }] };

    const deps = createDependencies({
      helpers: {
        normalizeListingsResponse: jest.fn(() => ({
          rows: [
            { id: 'listing-1', title: 'Chair', image_data: null, images: [{ url: 'inline.jpg', w: 4, h: 3 }] }
          ],
          hasNext: true,
          nextCursor: 'cursor-2'
        })),
        asArray: jest.fn((value) => value),
        selectPrimaryListingImage: jest.fn(() => 'inline-derived'),
        pageSize: 25
      },
      api: {
        listAll: jest.fn().mockResolvedValue(listResponse),
        listMine: jest.fn().mockResolvedValue([{ id: 'mine-1' }]),
        getCoversBatch: jest.fn().mockResolvedValue([{ id: 'listing-1', image_data: 'https://cover.jpg' }]),
        getListingImages: jest.fn().mockResolvedValue(['https://listing-3.jpg']),
        searchCities: jest.fn().mockResolvedValue(['Seattle'])
      }
    });

    global.setTimeout = jest.fn((fn) => {
      if (typeof fn === 'function') fn();
      return 1;
    });
    global.clearTimeout = jest.fn();
    global.window = { innerWidth: 1280 };
    global.document = { body: {} };
    const observe = jest.fn();
    const disconnect = jest.fn();
    global.IntersectionObserver = jest.fn(() => ({ observe, disconnect }));

    const feature = createListingsFeature(deps);
    const { useListingsFeature } = feature;

    const hooks = useListingsFeature({ user: { id: 'user-1' }, currentTab: 'browse' });
    const { states, effects, refs } = deps.__mocks.react;

    const [debounceQuery, debounceLocation,, intersectionEffect,, cityEffect] = effects;

    const cleanupQuery = debounceQuery ? debounceQuery() : undefined;
    const cleanupLocation = debounceLocation ? debounceLocation() : undefined;

    const cleanupIntersection = intersectionEffect
      ? (() => {
        refs[0].current = { id: 'sentinel' };
        return intersectionEffect();
      })()
      : undefined;

    if (intersectionEffect) {
      expect(global.IntersectionObserver).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledWith(refs[0].current);
    }

    const cleanupCity = cityEffect ? cityEffect() : undefined;
    if (cityEffect) {
      expect(deps.api.searchCities).toHaveBeenCalledWith('');
    }

    deps.api.listAll.mockClear();
    deps.api.listMine.mockClear();
    deps.helpers.normalizeListingsResponse.mockClear();

    await hooks.refreshListings();

    expect(deps.api.listAll).toHaveBeenCalledWith({
      q: '',
      loc: '',
      cursor: null,
      limit: 25,
      sort: 'new'
    });
    expect(deps.helpers.normalizeListingsResponse).toHaveBeenCalledWith(listResponse, 25);
    expect(states[0].value).toEqual([
      { id: 'listing-1', title: 'Chair', image_data: null, images: [{ url: 'inline.jpg', w: 4, h: 3 }] }
    ]);
    expect(states[1].value).toEqual([{ id: 'mine-1' }]);
    expect(states[5].value).toBe(true);
    expect(refs[2].current).toBe('cursor-2');
    expect(deps.api.getCoversBatch).toHaveBeenCalledWith(['listing-1'], { silent: true });
    expect(states[11].value).toEqual({ 'listing-1': { url: 'https://cover.jpg' } });
    expect(states[6].value).toBe(false);
    expect(deps.api.getListingImages).not.toHaveBeenCalled();

    await hooks.ensureCover('listing-3');
    expect(deps.api.getListingImages).toHaveBeenCalledWith('listing-3', { silent: true });
    expect(states[11].value['listing-3']).toEqual({ url: 'https://listing-3.jpg', w: null, h: null });

    cleanupQuery?.();
    cleanupLocation?.();
    cleanupIntersection?.();
    cleanupCity?.();
  });

  test('useListingModal prepares payloads and warms listing images', () => {
    const createListingsFeature = loadFactory();
    const deps = createDependencies({
      uploads: {
        prepareListingForModal: jest.fn(() => ({ payload: { id: 'listing-5', title: 'Desk' }, images: ['a.jpg', 'b.jpg'] })),
        warmListingImages: jest.fn()
      }
    });

    const feature = createListingsFeature(deps);
    const { useListingModal } = feature;

    const setSelectedListing = jest.fn();
    const { openListingModal, handleListingTileEvent } = useListingModal({ setSelectedListing });

    openListingModal({ id: 'listing-5' }, 'cover.jpg');

    expect(deps.uploads.prepareListingForModal).toHaveBeenCalledWith({ id: 'listing-5' }, 'cover.jpg');
    expect(setSelectedListing).toHaveBeenCalledWith({ id: 'listing-5', title: 'Desk' });
    expect(deps.uploads.warmListingImages).toHaveBeenCalledWith('listing-5', ['a.jpg', 'b.jpg']);

    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    handleListingTileEvent({ preventDefault, stopPropagation }, { id: 'listing-6' }, 'cover-2.jpg');

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(deps.uploads.prepareListingForModal).toHaveBeenCalledWith({ id: 'listing-6' }, 'cover-2.jpg');
  });

  test('CityAutocomplete filters options and handles interactions', () => {
    const createListingsFeature = loadFactory();
    const deps = createDependencies({ stateOverrides: [true, 0] });

    global.setTimeout = jest.fn((fn) => {
      if (typeof fn === 'function') fn();
      return 1;
    });
    global.clearTimeout = jest.fn();

    const feature = createListingsFeature(deps);
    const { CityAutocomplete } = feature;

    const onChange = jest.fn();
    const onUseMyLocation = jest.fn();

    const tree = CityAutocomplete({
      value: 'san',
      onChange,
      options: ['San Francisco', 'San Jose', 'Los Angeles'],
      onUseMyLocation
    });

    const { states, refs } = deps.__mocks.react;
    refs[0].current = { querySelector: () => ({ focus: jest.fn() }) };

    const inputNode = findNode(tree, (node) => node?.type === 'input');
    expect(inputNode).toBeTruthy();
    expect(inputNode.props.value).toBe('san');

    inputNode.props.onChange({ target: { value: 'San' } });
    expect(onChange).toHaveBeenCalledWith('San');
    expect(states[0].setter).toHaveBeenCalledWith(true);

    const preventDefault = jest.fn();
    inputNode.props.onKeyDown({ key: 'ArrowDown', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(states[1].setter).toHaveBeenLastCalledWith(expect.any(Function));
    const hoverUpdater = states[1].setter.mock.calls.at(-1)[0];
    expect(hoverUpdater(0)).toBe(1);

    const optionNode = findNode(tree, (node) => node?.props && typeof node.props.onMouseDown === 'function');
    expect(optionNode).toBeTruthy();
    const optionPreventDefault = jest.fn();
    optionNode.props.onMouseDown({ preventDefault: optionPreventDefault });
    expect(optionPreventDefault).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('San Francisco');
    expect(states[0].setter).toHaveBeenLastCalledWith(false);
    expect(states[1].setter).toHaveBeenLastCalledWith(0);

    const buttonNode = findNode(tree, (node) => node?.type === 'button' && node?.props?.children === 'Use my location');
    expect(buttonNode).toBeTruthy();
    buttonNode.props.onClick();
    expect(onUseMyLocation).toHaveBeenCalledTimes(1);
  });

  test('toggleSold updates listings and alerts on failure', async () => {
    const createListingsFeature = loadFactory();
    const deps = createDependencies({
      helpers: {
        normalizeListingsResponse: jest.fn(() => ({
          rows: [{ id: 'listing-2', sold: 0 }],
          hasNext: false,
          nextCursor: null
        })),
        asArray: jest.fn((value) => value),
        selectPrimaryListingImage: jest.fn(() => ''),
        pageSize: 25
      },
      api: {
        listAll: jest.fn().mockResolvedValue({}),
        listMine: jest.fn().mockResolvedValue([]),
        getCoversBatch: jest.fn().mockResolvedValue([]),
        markListingSold: jest.fn().mockResolvedValue(undefined)
      }
    });

    global.alert = jest.fn();

    const feature = createListingsFeature(deps);
    const { useListingsFeature } = feature;

    const hooks = useListingsFeature({ user: { id: 'user-1' }, currentTab: 'browse' });
    const { states } = deps.__mocks.react;

    states[0].value = [
      { id: 'listing-1', sold: 0 },
      { id: 'listing-2', sold: 0 }
    ];
    states[7].value = { id: 'listing-1', sold: 0 };

    await hooks.toggleSold({ id: 'listing-1' }, true);

    expect(deps.api.markListingSold).toHaveBeenCalledWith('listing-1', true);
    expect(states[7].value).toEqual({ id: 'listing-1', sold: 1 });
    expect(states[0].value).toEqual([{ id: 'listing-2', sold: 0 }]);

    deps.api.markListingSold.mockRejectedValueOnce(new Error('network'));

    await hooks.toggleSold({ id: 'listing-2' }, false);
    expect(global.alert).toHaveBeenCalledWith('Failed to update sold status. Please try again.');
  });
});


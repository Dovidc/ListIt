const path = require('path');

const nearbyFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'nearby.js'
);

const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
const originalAddEventListener = global.window?.addEventListener;
const originalRemoveEventListener = global.window?.removeEventListener;

function resetGlobals() {
  delete global.window;
  delete global.document;
  delete global.navigator;
  delete global.localStorage;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
  if (originalAddEventListener) {
    if (!global.window) global.window = {};
    global.window.addEventListener = originalAddEventListener;
  }
  if (originalRemoveEventListener) {
    if (!global.window) global.window = {};
    global.window.removeEventListener = originalRemoveEventListener;
  }
}

function loadFactory() {
  global.window = {
    ListItApp: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
  };
  global.document = { body: {} };
  global.navigator = {};

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(nearbyFeaturePath);

  return global.window.ListItApp.features.nearby.createNearbyFeature;
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
    memo: jest.fn((component) => component),
    useState: jest.fn((initial) => {
      const initialValue = typeof initial === 'function' ? initial() : initial;
      const override = stateOverrides.length ? stateOverrides.shift() : undefined;
      const record = {
        value: override !== undefined ? override : initialValue,
        setter: null
      };
      const setter = jest.fn((update) => {
        const nextValue = typeof update === 'function' ? update(record.value) : update;
        record.value = nextValue;
        return nextValue;
      });
      record.setter = setter;
      states.push(record);
      return [record.value, setter];
    }),
    useMemo: jest.fn((factory) => {
      const value = factory();
      memos.push(value);
      return value;
    }),
    useCallback: jest.fn((fn) => fn),
    useRef: jest.fn((initial) => {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    }),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
    })
  };

  return { React, states, effects, refs, memos };
}

function createDependencies({ stateOverrides, helpers: helperOverrides = {}, api: apiOverrides = {}, components: componentOverrides = {} } = {}) {
  const react = createReactMocks(stateOverrides ? [...stateOverrides] : []);

  const helpers = {
    asArray: jest.fn((value) => (Array.isArray(value) ? value : value == null ? [] : [value])),
    selectPrimaryListingImage: jest.fn(() => ''),
    fetchCoordsAndReverse: jest.fn().mockResolvedValue({ lat: 47.6, lon: -122.3, display: 'Downtown' }),
    ...helperOverrides
  };

  const api = {
    listNearby: jest.fn().mockResolvedValue({ rows: [] }),
    ...apiOverrides
  };

  const components = {
    ListingCard: jest.fn((props) => ({ type: 'ListingCard', props })),
    ListingsGrid: jest.fn((props) => ({ type: 'ListingsGrid', props })),
    ...componentOverrides
  };

  return {
    React: react.React,
    api,
    helpers,
    components,
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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.resetModules();
  resetGlobals();
  global.localStorage = {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn()
  };
});

afterEach(() => {
  resetGlobals();
});

describe('nearby feature integration', () => {
  test('registers factory and enforces dependency contract', () => {
    const createNearbyFeature = loadFactory();

    expect(typeof createNearbyFeature).toBe('function');
    expect(() => createNearbyFeature({})).toThrow('Nearby feature requires React.');

    const React = { useState: () => {} };
    expect(() => createNearbyFeature({ React })).toThrow('Nearby feature requires an API client with listNearby.');

    const api = { listNearby: () => {} };
    expect(() => createNearbyFeature({ React, api })).toThrow('Nearby feature requires asArray helper.');

    const helpers = { asArray: () => [] };
    expect(() => createNearbyFeature({ React, api, helpers })).toThrow('Nearby feature requires selectPrimaryListingImage helper.');

    const helpersWithImage = { ...helpers, selectPrimaryListingImage: () => '' };
    expect(() => createNearbyFeature({ React, api, helpers: helpersWithImage })).toThrow('Nearby feature requires fetchCoordsAndReverse helper.');

    const helpersComplete = { ...helpersWithImage, fetchCoordsAndReverse: () => ({}) };
    expect(() => createNearbyFeature({ React, api, helpers: helpersComplete })).toThrow('Nearby feature requires ListingCard component.');

    const componentsWithCard = { ListingCard: () => ({}) };
    expect(() => createNearbyFeature({ React, api, helpers: helpersComplete, components: componentsWithCard })).toThrow('Nearby feature requires ListingsGrid component.');

  });

  test('loads nearby listings, normalizes results, and stores location details', async () => {
    const createNearbyFeature = loadFactory();
    const deps = createDependencies({
      helpers: {
        selectPrimaryListingImage: jest.fn((item) => item.coverUrl || ''),
        fetchCoordsAndReverse: jest.fn().mockResolvedValue({ lat: 40.7, lon: -74.0, display: 'New York, NY' })
      },
      api: {
        listNearby: jest.fn().mockResolvedValue({
          rows: [
            { id: 'listing-1', title: 'Bike', thumb_url: 'thumb-1.jpg' },
            { id: 'listing-2', title: 'Chair', image_data: 'inline.jpg' }
          ]
        })
      }
    });

    const feature = createNearbyFeature(deps);
    expect(feature.DEFAULT_NEARBY_RADIUS_M).toBe(400);

    const setTab = jest.fn();
    const tree = feature.NearbyPanel({
      user: { id: 'user-1' },
      mineById: { 'listing-1': true },
      onEdit: jest.fn(),
      onDelete: jest.fn(),
      onMessage: jest.fn(),
      onAdminDelete: jest.fn(),
      onViewSeller: jest.fn(),
      onToggleSold: jest.fn(),
      setTab
    });

    expect(tree.type).toBe('div');

    const { states, effects } = deps.__mocks.react;
    expect(states.map((state) => state.value)).toEqual([
      150,
      [],
      false,
      '',
      null,
      '',
      '',
      '',
      'new'
    ]);

    const cleanupLoad = effects[0] ? effects[0]() : undefined;
    await flushPromises();

    expect(deps.helpers.fetchCoordsAndReverse).toHaveBeenCalledTimes(1);
    expect(deps.api.listNearby).toHaveBeenCalledWith(40.7, -74.0, 150, { silent: true });
    expect(deps.helpers.asArray).toHaveBeenCalledTimes(1);
    expect(deps.helpers.selectPrimaryListingImage).toHaveBeenCalledTimes(2);

    expect(states[1].value).toEqual([
      { id: 'listing-1', title: 'Bike', thumb_url: 'thumb-1.jpg', __cover: 'thumb-1.jpg' },
      { id: 'listing-2', title: 'Chair', image_data: 'inline.jpg', __cover: 'inline.jpg' }
    ]);
    expect(states[2].value).toBe(false);
    expect(typeof states[5].value).toBe('string');
    expect(states[5].value.length).toBeGreaterThan(0);
    expect(states[6].value).toBe('New York, NY');

    expect(global.localStorage.setItem).toHaveBeenCalledTimes(1);
    const storedPayload = JSON.parse(global.localStorage.setItem.mock.calls[0][1]);
    expect(storedPayload).toMatchObject({ lat: 40.7, lon: -74.0, display: 'New York, NY' });

    cleanupLoad?.();
  });

  test('handles geolocation errors by clearing items and surfacing message', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const createNearbyFeature = loadFactory();

    const deps = createDependencies({
      helpers: {
        fetchCoordsAndReverse: jest.fn().mockRejectedValue(new Error('location_unavailable'))
      }
    });

    const feature = createNearbyFeature(deps);
    feature.NearbyPanel({
      user: { id: 'user-1' },
      mineById: {},
      onEdit: jest.fn(),
      onDelete: jest.fn(),
      onMessage: jest.fn(),
      onAdminDelete: jest.fn(),
      onViewSeller: jest.fn(),
      onToggleSold: jest.fn(),
      setTab: jest.fn()
    });

    const { states, effects } = deps.__mocks.react;
    const cleanupLoad = effects[0] ? effects[0]() : undefined;
    await flushPromises();

    expect(deps.api.listNearby).not.toHaveBeenCalled();
    expect(states[1].value).toEqual([]);
    expect(states[3].value).toBe('Location unavailable.');
    expect(states[5].value).toBe('');
    expect(states[2].value).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Nearby load failed:', expect.any(Error));

    cleanupLoad?.();
    consoleErrorSpy.mockRestore();
  });

  test('modal actions clear selection and notify parent callbacks', () => {
    const createNearbyFeature = loadFactory();

    const selectedListing = { id: 'listing-9', title: 'Vintage Desk' };
    const deps = createDependencies({
      stateOverrides: [
        150,
        [selectedListing],
        false,
        '',
        selectedListing,
        '1:00 PM',
        'Capitol Hill',
        '',
        'new'
      ]
    });

    const setTab = jest.fn();
    const onEdit = jest.fn();

    const feature = createNearbyFeature(deps);
    const tree = feature.NearbyPanel({
      user: { id: 'user-42' },
      mineById: { 'listing-9': true },
      onEdit,
      onDelete: jest.fn(),
      onMessage: jest.fn(),
      onAdminDelete: jest.fn(),
      onViewSeller: jest.fn(),
      onToggleSold: jest.fn(),
      setTab
    });

    const { states, effects } = deps.__mocks.react;
    const keydownEffect = effects[1] ? effects[1]() : undefined;
    expect(global.window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    const listingCardNode = findNode(tree, (node) => node && node.type === deps.components.ListingCard);
    expect(listingCardNode).toBeTruthy();

    listingCardNode.props.onEdit(selectedListing);

    expect(states[4].value).toBe(null);
    expect(setTab).toHaveBeenCalledWith('browse');
    expect(onEdit).toHaveBeenCalledWith(selectedListing);

    keydownEffect?.();
    expect(global.window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

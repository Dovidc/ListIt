const path = require('path');

const listingFormsPath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'listing-forms.js'
);

const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;

function resetGlobals() {
  delete global.window;
  delete global.document;
  delete global.navigator;
  delete global.IntersectionObserver;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
}

function loadFactory() {
  global.window = { ListItApp: {}, innerHeight: 900 };
  global.document = { body: {} };
  global.navigator = { geolocation: { getCurrentPosition: jest.fn() } };

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(listingFormsPath);
  return global.window.ListItApp.features.listingForms.createListingFormsFeature;
}

function createReactMocks() {
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
      const value = typeof initial === 'function' ? initial() : initial;
      const setter = jest.fn();
      states.push({ value, setter });
      return [value, setter];
    }),
    useRef: jest.fn((initial) => {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    }),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
    }),
    useMemo: jest.fn((factory) => factory()),
    useCallback: jest.fn((fn) => fn)
  };

  return { React, states, refs, effects };
}

function createDependencies({ mobile = false } = {}) {
  const react = createReactMocks();
  const ReactDOM = {
    createPortal: jest.fn((node, target) => ({ node, target }))
  };

  const helpers = {
    isMobileDevice: jest.fn(() => mobile),
    fetchCoordsAndReverse: jest.fn(() => Promise.resolve({ lat: 1, lon: 2, display: 'Somewhere' }))
  };

  const uploads = {
    clearDraftCacheForFile: jest.fn(),
    uploadFileDraft: jest.fn().mockResolvedValue({ publicUrl: 'https://img', uploadToken: 'token' }),
    uploadFilesForListing: jest.fn().mockResolvedValue([]),
    useFilePreviews: jest.fn(() => []),
    AI_IMAGE_LIMIT: 3
  };

  const api = {
    aiAnalyze: jest.fn().mockResolvedValue({}),
    getListingImages: jest.fn().mockResolvedValue([]),
    reverseGeocode: jest.fn().mockResolvedValue({ lat: 1, lon: 2, display: 'City' }),
    createListing: jest.fn().mockResolvedValue({ id: 'listing-1' }),
    updateListing: jest.fn().mockResolvedValue({}),
    updateListingImages: jest.fn().mockResolvedValue({}),
    updateListingLocation: jest.fn().mockResolvedValue({}),
    updateListingTags: jest.fn().mockResolvedValue({}),
    updateListingNearby: jest.fn().mockResolvedValue({}),
    removeListingImage: jest.fn().mockResolvedValue({})
  };

  const components = {
    ListingForm: jest.fn(() => ({ rendered: 'ListingForm' })),
    ImageWithSkeleton: jest.fn(() => ({ rendered: 'ImageWithSkeleton' }))
  };

  return {
    React: react.React,
    ReactDOM,
    api,
    helpers,
    uploads,
    formatting: { price: jest.fn((value) => `$${value}`) },
    components,
    __mocks: { react }
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

beforeEach(() => {
  jest.resetModules();
  resetGlobals();
  global.setTimeout = jest.fn(() => 1);
  global.clearTimeout = jest.fn();
});

afterEach(() => {
  resetGlobals();
});

describe('listing forms feature integration', () => {
  test('registers factory and enforces dependency contract', () => {
    const createListingFormsFeature = loadFactory();

    expect(typeof createListingFormsFeature).toBe('function');
    expect(() => createListingFormsFeature()).toThrow('Listing forms feature requires React.');

    const React = { createElement: jest.fn() };
    expect(() => createListingFormsFeature({ React })).toThrow('Listing forms feature requires ReactDOM.');

    const ReactDOM = { createPortal: jest.fn() };
    expect(() => createListingFormsFeature({ React, ReactDOM })).toThrow('Listing forms feature requires an API client.');
  });

  test('ListingFormModal renders a portal with the desktop form', () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies();
    deps.ReactDOM.createPortal.mockReturnValue('portal');

    const feature = createListingFormsFeature(deps);
    const { ListingFormModal } = feature;

    const onClose = jest.fn();
    const onSaved = jest.fn();

    const result = ListingFormModal({
      isOpen: true,
      draft: null,
      onClose,
      onSaved,
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn()
    });

    expect(result).toBe('portal');
    expect(deps.helpers.isMobileDevice).toHaveBeenCalledTimes(1);
    expect(deps.ReactDOM.createPortal).toHaveBeenCalledTimes(1);
    const [modalTree, target] = deps.ReactDOM.createPortal.mock.calls[0];
    expect(target).toBe(global.document.body);
    expect(modalTree.type).toBe('div');

    const listingFormNode = findNode(modalTree, (node) => node?.type === deps.components.ListingForm);
    expect(listingFormNode).toBeTruthy();
    expect(listingFormNode.props).toEqual(
      expect.objectContaining({
        draft: null,
        onCancel: onClose,
        autoListEnabled: false,
        aiDescriptionEnabled: true,
        autoPostNearbyEnabled: false,
        backgroundQueueEnabled: false
      })
    );

    listingFormNode.props.onSaved();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('ListingFormModal renders the compact form for mobile devices', () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies({ mobile: true });

    const feature = createListingFormsFeature(deps);
    const { ListingFormModal, CompactListingForm } = feature;

    ListingFormModal({
      isOpen: true,
      draft: null,
      onClose: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: true,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: true,
      backgroundQueueEnabled: true,
      enqueueListingJob: jest.fn()
    });

    const [modalTree] = deps.ReactDOM.createPortal.mock.calls[0];
    const compactNode = findNode(modalTree, (node) => node?.type === CompactListingForm);

    expect(compactNode).toBeTruthy();
    expect(typeof compactNode.props.setShowTags).toBe('function');
    expect(compactNode.props.autoListEnabled).toBe(true);
  });

  test('SmartImage lazily activates and clears sources using IntersectionObserver', () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies();
    const { React } = deps;
    const { states, refs, effects } = deps.__mocks.react;

    const observe = jest.fn();
    const disconnect = jest.fn();
    let observerCallback;
    global.IntersectionObserver = jest.fn((callback) => {
      observerCallback = callback;
      return { observe, disconnect };
    });

    const feature = createListingFormsFeature(deps);
    const { SmartImage } = feature;

    const element = SmartImage({ src: 'https://cdn/item.jpg', dropFar: true });
    expect(element.type).toBe('div');
    expect(React.createElement).toHaveBeenCalled();

    refs[0].current = {};
    const cleanup = effects[0]();

    expect(global.IntersectionObserver).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(refs[0].current);

    observerCallback([
      {
        isIntersecting: true,
        boundingClientRect: { top: 0, bottom: 0 }
      }
    ]);
    expect(states[0].setter).toHaveBeenCalledWith('https://cdn/item.jpg');

    observerCallback([
      {
        isIntersecting: false,
        boundingClientRect: { top: 4000, bottom: 4200 }
      }
    ]);

    expect(global.setTimeout).toHaveBeenCalledTimes(1);
    const clearSrc = global.setTimeout.mock.calls[0][0];
    clearSrc();
    expect(states[0].setter).toHaveBeenCalledWith('');

    cleanup();
    expect(global.clearTimeout).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});


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
      const nextValue = stateOverrides.length ? stateOverrides.shift() : undefined;
      const stateRecord = { value: nextValue !== undefined ? nextValue : initialValue, setter: null };
      const setter = jest.fn((update) => {
        const resolved = typeof update === 'function' ? update(stateRecord.value) : update;
        stateRecord.value = resolved;
        return resolved;
      });
      stateRecord.setter = setter;
      states.push(stateRecord);
      return [stateRecord.value, setter];
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

function createDependencies({ mobile = false, stateOverrides } = {}) {
  const react = createReactMocks(stateOverrides ? [...stateOverrides] : []);
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

async function flushAsyncEffects() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
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
  global.alert = jest.fn();
});

afterEach(() => {
  resetGlobals();
  delete global.alert;
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

  test('CompactListingForm pickFiles filters invalid files and resets input', () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies();
    const { states, refs } = deps.__mocks.react;

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const valid = { name: 'chair.jpg', size: 1024, type: 'image/jpeg' };
    const oversized = { name: 'big.png', size: 25 * 1024 * 1024, type: 'image/png' };
    const notImage = { name: 'notes.pdf', size: 2048, type: 'application/pdf' };

    const fileInput = findNode(form, (node) => node?.type === 'input' && node?.props?.type === 'file');
    expect(fileInput).toBeTruthy();

    refs[0].current = { value: 'stale' };

    fileInput.props.onChange({ target: { files: [valid, oversized, notImage] } });

    expect(states[0].setter).toHaveBeenCalledTimes(1);
    expect(states[0].setter).toHaveBeenCalledWith([valid]);
    expect(states[0].value).toEqual([valid]);
    expect(refs[0].current.value).toBe('');
    expect(global.alert).toHaveBeenNthCalledWith(1, 'Each image must be under 20MB');
    expect(global.alert).toHaveBeenNthCalledWith(2, 'Only images are allowed');
  });

  test('CompactListingForm removeFile clears cache and updates state', () => {
    const createListingFormsFeature = loadFactory();
    const fileA = { name: 'a.jpg', size: 1000, type: 'image/jpeg' };
    const fileB = { name: 'b.jpg', size: 800, type: 'image/jpeg' };
    const deps = createDependencies({
      stateOverrides: [
        [fileA, fileB],
        [],
        []
      ]
    });

    deps.uploads.useFilePreviews.mockReturnValue([{ url: 'preview-a' }, { url: 'preview-b' }]);

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const { states } = deps.__mocks.react;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const removeButton = findNode(form, (node) => node?.type === 'button' && node?.props?.children === 'x');
    expect(removeButton).toBeTruthy();

    removeButton.props.onClick();

    expect(deps.uploads.clearDraftCacheForFile).toHaveBeenCalledTimes(1);
    expect(deps.uploads.clearDraftCacheForFile).toHaveBeenCalledWith(fileA);
    expect(states[0].setter).toHaveBeenCalledWith([fileB]);
    expect(states[0].value).toEqual([fileB]);
    expect(global.alert).not.toHaveBeenCalled();
  });

  test('CompactListingForm removeExistingImage updates existing URLs state', () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies({
      stateOverrides: [
        [],
        ['https://cdn/one.jpg', 'https://cdn/two.jpg'],
        ['https://cdn/one.jpg', 'https://cdn/two.jpg']
      ]
    });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const { states } = deps.__mocks.react;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const removeExistingButton = findNode(form, (node) => (
      node?.type === 'button'
      && node?.props?.children === 'x'
      && typeof node?.props?.onClick === 'function'
      && node.props.onClick.toString().includes('existingUrls')
    ));

    expect(removeExistingButton).toBeTruthy();

    removeExistingButton.props.onClick();

    expect(states[1].setter).toHaveBeenCalledWith(['https://cdn/two.jpg']);
    expect(states[1].value).toEqual(['https://cdn/two.jpg']);
    expect(deps.uploads.clearDraftCacheForFile).not.toHaveBeenCalled();
    expect(global.alert).not.toHaveBeenCalled();
  });

  test('CompactListingForm runAI uploads images, applies AI results, and respects limits', async () => {
    const createListingFormsFeature = loadFactory();
    const fileA = { name: 'a.jpg', size: 1024, type: 'image/jpeg' };
    const fileB = { name: 'b.jpg', size: 2048, type: 'image/jpeg' };
    const deps = createDependencies({
      stateOverrides: [
        [fileA, fileB],
        ['https://cdn/current.jpg'],
        ['https://cdn/original.jpg']
      ]
    });

    deps.uploads.uploadFileDraft
      .mockResolvedValueOnce({ publicUrl: 'https://uploads/a.jpg', uploadToken: 'tok-a' })
      .mockResolvedValueOnce({ publicUrl: 'https://uploads/b.jpg', uploadToken: 'tok-b' });
    deps.api.aiAnalyze.mockResolvedValue({
      title: 'AI Generated Title',
      tags: ['modern', 'sofa'],
      suggested_price: 129.99,
      description: 'Beautiful couch ready for a new home.'
    });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const { states } = deps.__mocks.react;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const runAiButton = findNode(form, (node) => node?.type === 'button' && node?.props?.children === 'Run AI analysis');
    expect(runAiButton).toBeTruthy();
    await runAiButton.props.onClick();

    expect(deps.uploads.uploadFileDraft).toHaveBeenCalledTimes(2);
    expect(deps.uploads.uploadFileDraft.mock.calls[0][0]).toBe(fileA);
    expect(deps.uploads.uploadFileDraft.mock.calls[1][0]).toBe(fileB);
    expect(deps.api.aiAnalyze).toHaveBeenCalledTimes(1);
    expect(deps.api.aiAnalyze).toHaveBeenCalledWith({
      images: ['https://uploads/a.jpg', 'https://uploads/b.jpg', 'https://cdn/current.jpg'],
      hint: ''
    });

    expect(states[8].setter).toHaveBeenNthCalledWith(1, true);
    expect(states[8].setter).toHaveBeenLastCalledWith(false);
    expect(states[9].setter).toHaveBeenCalledWith('');
    expect(states[3].setter).toHaveBeenCalledWith('AI Generated Title');
    expect(states[7].setter).toHaveBeenCalledWith('modern, sofa');
    expect(states[6].setter).toHaveBeenCalledWith('129.99');
    expect(states[4].setter).toHaveBeenCalledWith('Beautiful couch ready for a new home.');
    expect(global.alert).not.toHaveBeenCalled();
  });

  test('CompactListingForm runAI alerts when no sources are available', async () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies();

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const { states } = deps.__mocks.react;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const runAiButton = findNode(form, (node) => node?.type === 'button' && node?.props?.children === 'Run AI analysis');
    await runAiButton.props.onClick();

    expect(states[9].setter).toHaveBeenCalledWith('');
    expect(states[8].setter).toHaveBeenNthCalledWith(1, true);
    expect(states[8].setter).toHaveBeenLastCalledWith(false);
    expect(deps.api.aiAnalyze).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('No images available for AI analysis.');
  });

  test('CompactListingForm runAI surfaces description gating errors', async () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies({
      stateOverrides: [
        [{ name: 'photo.jpg', size: 500, type: 'image/jpeg' }],
        [],
        []
      ]
    });

    deps.uploads.uploadFileDraft.mockResolvedValue({ publicUrl: 'https://uploads/photo.jpg', uploadToken: 'tok-1' });
    deps.api.aiAnalyze.mockResolvedValue({
      title: 'Draft',
      tags: ['tag'],
      suggested_price: 50,
      description: 'Long AI description'
    });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const { states } = deps.__mocks.react;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: false,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const runAiButton = findNode(form, (node) => node?.type === 'button' && node?.props?.children === 'Run AI analysis');
    await runAiButton.props.onClick();

    expect(states[4].setter).not.toHaveBeenCalled();
    expect(states[9].setter).toHaveBeenLastCalledWith('Enable AI descriptions in your profile to apply AI-written descriptions.');
    expect(global.alert).not.toHaveBeenCalled();
  });

  test('CompactListingForm useMyLocation handles unsupported geolocation', async () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies();
    const { states } = deps.__mocks.react;

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const locationButton = findNode(form, (node) => node?.type === 'button' && node?.props?.children === 'Use my location');

    global.navigator = {};
    await locationButton.props.onClick();

    expect(states[13].setter).toHaveBeenNthCalledWith(1, '');
    expect(states[13].setter).toHaveBeenLastCalledWith('Geolocation not supported');
    expect(states[12].setter).not.toHaveBeenCalled();
  });

  test('CompactListingForm useMyLocation populates coordinates and handles API response', async () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies();
    const { states } = deps.__mocks.react;

    global.navigator.geolocation.getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 37.77, longitude: -122.41 } });
    });
    deps.api.reverseGeocode.mockResolvedValue({ lat: 37.8, lon: -122.4, display: 'San Francisco, CA' });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const locationButton = findNode(form, (node) => node?.type === 'button' && node?.props?.children === 'Use my location');
    await locationButton.props.onClick();

    expect(states[12].setter).toHaveBeenNthCalledWith(1, true);
    expect(states[12].setter).toHaveBeenLastCalledWith(false);
    expect(states[13].setter).toHaveBeenCalledWith('');
    expect(deps.api.reverseGeocode).toHaveBeenCalledWith(37.77, -122.41);
    expect(states[5].setter).toHaveBeenCalledWith('San Francisco, CA');
    expect(states[14].setter).toHaveBeenCalledWith(37.8);
    expect(states[15].setter).toHaveBeenCalledWith(-122.4);
    expect(global.alert).not.toHaveBeenCalled();
  });

  test('CompactListingForm submit requires at least one image', async () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies({
      stateOverrides: [
        [],
        [],
        [],
        'Title',
        'Description',
        'Location',
        '10',
        'tag'
      ]
    });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const submitEvent = { preventDefault: jest.fn() };
    await form.props.onSubmit(submitEvent);

    expect(submitEvent.preventDefault).toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Please add at least one image.');
    expect(deps.api.createListing).not.toHaveBeenCalled();
    expect(deps.api.updateListing).not.toHaveBeenCalled();
  });

  test('CompactListingForm submit updates an existing listing with uploads and deletions', async () => {
    const createListingFormsFeature = loadFactory();
    const newFile = { name: 'latest.jpg', size: 1000, type: 'image/jpeg' };
    const deps = createDependencies({
      stateOverrides: [
        [newFile],
        ['https://cdn/keep.jpg'],
        ['https://cdn/remove.jpg', 'https://cdn/keep.jpg'],
        'Draft title',
        'Draft description',
        'Draft location',
        '45',
        'tag1, tag2',
        false,
        '',
        false,
        true,
        false,
        '',
        12.3,
        45.6
      ]
    });

    deps.uploads.uploadFilesForListing.mockResolvedValue(undefined);

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const onSaved = jest.fn();

    const form = CompactListingForm({
      draft: { id: 'listing-42', enable_nearby: 1, lat: 12.3, lon: 45.6 },
      onCancel: jest.fn(),
      onSaved,
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const submitEvent = { preventDefault: jest.fn() };
    await form.props.onSubmit(submitEvent);

    expect(submitEvent.preventDefault).toHaveBeenCalled();
    expect(deps.api.updateListing).toHaveBeenCalledWith('listing-42', expect.objectContaining({
      title: 'Draft title',
      description: 'Draft description',
      location: 'Draft location',
      price: 45,
      tags: 'tag1, tag2',
      enable_nearby: 1,
      deletedImages: ['https://cdn/remove.jpg']
    }));
    expect(deps.uploads.uploadFilesForListing).toHaveBeenCalledWith('listing-42', [newFile]);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(deps.api.createListing).not.toHaveBeenCalled();
    expect(global.alert).not.toHaveBeenCalled();
  });

  test('CompactListingForm submit requires coordinates when enabling Nearby', async () => {
    const createListingFormsFeature = loadFactory();
    const deps = createDependencies({
      stateOverrides: [
        [],
        ['https://cdn/current.jpg'],
        ['https://cdn/current.jpg'],
        'Title',
        'Description',
        'Location',
        '15',
        'tag1',
        false,
        '',
        false,
        true,
        false,
        '',
        null,
        null
      ]
    });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;

    const form = CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved: jest.fn(),
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const submitEvent = { preventDefault: jest.fn() };
    await form.props.onSubmit(submitEvent);

    expect(submitEvent.preventDefault).toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith('Enable Nearby requires using your location.');
    expect(deps.api.createListing).not.toHaveBeenCalled();
  });

  test('CompactListingForm submit enqueues background job for new listings', async () => {
    const createListingFormsFeature = loadFactory();
    const queuedFile = { name: 'queued.jpg', size: 900, type: 'image/jpeg' };
    const deps = createDependencies({
      stateOverrides: [
        [queuedFile],
        [],
        [],
        'Title',
        'Desc',
        'City',
        '0',
        '',
        false,
        '',
        false,
        false,
        false,
        '',
        null,
        null
      ]
    });

    deps.uploads.uploadFileDraft.mockResolvedValue({ uploadToken: 'token-123' });
    deps.api.createListing.mockResolvedValue({ id: 'new-listing' });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const onCancel = jest.fn();
    const onSaved = jest.fn();
    const enqueueListingJob = jest.fn();

    const form = CompactListingForm({
      draft: null,
      onCancel,
      onSaved,
      autoListEnabled: false,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: true,
      enqueueListingJob,
      showTags: false,
      setShowTags: jest.fn()
    });

    const submitEvent = { preventDefault: jest.fn() };
    await form.props.onSubmit(submitEvent);

    expect(enqueueListingJob).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(deps.api.createListing).not.toHaveBeenCalled();
    expect(deps.uploads.uploadFileDraft).not.toHaveBeenCalled();

    const job = enqueueListingJob.mock.calls[0][0];
    expect(typeof job).toBe('function');
    await job();

    expect(deps.uploads.uploadFileDraft.mock.calls[0][0]).toBe(queuedFile);
    expect(deps.api.createListing).toHaveBeenCalledWith({
      title: 'Title',
      description: 'Desc',
      location: 'City',
      price: 0,
      tags: '',
      enable_nearby: 0,
      upload_tokens: ['token-123']
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(global.alert).not.toHaveBeenCalled();
  });

  test('CompactListingForm auto-list immediately uploads, enriches, and creates listing', async () => {
    const createListingFormsFeature = loadFactory();
    const autoFile = { name: 'auto.jpg', size: 1200, type: 'image/jpeg' };
    const deps = createDependencies({
      stateOverrides: [
        [autoFile]
      ]
    });

    deps.uploads.uploadFileDraft.mockResolvedValue({ publicUrl: 'https://uploads/auto.jpg', uploadToken: 'tok-auto' });
    deps.api.aiAnalyze.mockResolvedValue({
      title: 'AI Sofa',
      description: 'Comfy sofa with minimal wear.',
      suggested_price: 139.5,
      tags: ['living room', 'sofa']
    });
    deps.helpers.fetchCoordsAndReverse.mockResolvedValue({ lat: 51.5, lon: -0.12, display: 'London, UK' });
    deps.api.createListing.mockResolvedValue({ id: 'listing-ai' });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const onCancel = jest.fn();
    const onSaved = jest.fn();

    CompactListingForm({
      draft: null,
      onCancel,
      onSaved,
      autoListEnabled: true,
      aiDescriptionEnabled: true,
      autoPostNearbyEnabled: true,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const { effects, states, refs } = deps.__mocks.react;
    expect(effects.length).toBeGreaterThanOrEqual(2);
    effects[1]();
    await flushAsyncEffects();

    expect(states[10].setter).toHaveBeenNthCalledWith(1, true);
    expect(states[10].setter).toHaveBeenLastCalledWith(false);
    expect(deps.uploads.uploadFileDraft).toHaveBeenCalledTimes(1);
    expect(deps.uploads.uploadFileDraft.mock.calls[0][0]).toBe(autoFile);
    expect(deps.api.aiAnalyze).toHaveBeenCalledWith({ images: ['https://uploads/auto.jpg'], hint: '' }, { silent: true });
    expect(deps.helpers.fetchCoordsAndReverse).toHaveBeenCalledTimes(1);
    expect(deps.api.createListing).toHaveBeenCalledWith({
      title: 'AI Sofa',
      description: 'Comfy sofa with minimal wear.',
      location: 'London, UK',
      price: 139.5,
      tags: 'living room, sofa',
      enable_nearby: 1,
      upload_tokens: ['tok-auto'],
      lat: 51.5,
      lon: -0.12
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(global.alert).not.toHaveBeenCalled();
    expect(refs[1].current).toBe(false);
  });

  test('CompactListingForm auto-list alerts when create fails and resets state', async () => {
    const createListingFormsFeature = loadFactory();
    const autoFile = { name: 'auto.jpg', size: 2000, type: 'image/jpeg' };
    const deps = createDependencies({
      stateOverrides: [
        [autoFile]
      ]
    });

    deps.uploads.uploadFileDraft.mockResolvedValue({ publicUrl: 'https://uploads/auto.jpg', uploadToken: 'tok-auto' });
    deps.api.createListing.mockResolvedValue({});

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const onSaved = jest.fn();

    CompactListingForm({
      draft: null,
      onCancel: jest.fn(),
      onSaved,
      autoListEnabled: true,
      aiDescriptionEnabled: false,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: false,
      enqueueListingJob: jest.fn(),
      showTags: false,
      setShowTags: jest.fn()
    });

    const { effects, states, refs } = deps.__mocks.react;
    effects[1]();
    await flushAsyncEffects();

    expect(states[10].setter).toHaveBeenNthCalledWith(1, true);
    expect(states[10].setter).toHaveBeenLastCalledWith(false);
    expect(global.alert).toHaveBeenCalledWith('Auto-list failed: Create failed');
    expect(onSaved).not.toHaveBeenCalled();
    expect(refs[1].current).toBe(false);
  });

  test('CompactListingForm auto-list queues background job when background queue enabled', async () => {
    const createListingFormsFeature = loadFactory();
    const queued = { name: 'queue.jpg', size: 1500, type: 'image/jpeg' };
    const deps = createDependencies({
      stateOverrides: [
        [queued]
      ]
    });

    deps.uploads.uploadFileDraft.mockResolvedValue({ publicUrl: 'https://uploads/queue.jpg', uploadToken: 'tok-queue' });
    deps.api.createListing.mockResolvedValue({ id: 'background-job' });

    const feature = createListingFormsFeature(deps);
    const { CompactListingForm } = feature;
    const onCancel = jest.fn();
    const onSaved = jest.fn();
    const enqueueListingJob = jest.fn();

    CompactListingForm({
      draft: null,
      onCancel,
      onSaved,
      autoListEnabled: true,
      aiDescriptionEnabled: false,
      autoPostNearbyEnabled: false,
      backgroundQueueEnabled: true,
      enqueueListingJob,
      showTags: false,
      setShowTags: jest.fn()
    });

    const { effects, refs, states } = deps.__mocks.react;
    expect(effects.length).toBeGreaterThanOrEqual(2);
    effects[1]();

    expect(enqueueListingJob).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(states[10].setter).not.toHaveBeenCalled();
    expect(deps.uploads.uploadFileDraft).not.toHaveBeenCalled();
    expect(deps.api.createListing).not.toHaveBeenCalled();
    expect(deps.helpers.fetchCoordsAndReverse).not.toHaveBeenCalled();

    const job = enqueueListingJob.mock.calls[0][0];
    expect(typeof job).toBe('function');
    await job();

    expect(deps.helpers.fetchCoordsAndReverse).toHaveBeenCalledTimes(1);
    expect(deps.uploads.uploadFileDraft).toHaveBeenCalledTimes(1);
    expect(deps.uploads.uploadFileDraft.mock.calls[0][0]).toBe(queued);
    expect(deps.api.createListing).toHaveBeenCalledWith({
      title: 'Item for sale',
      description: 'No description',
      location: 'Somewhere',
      price: 0,
      tags: '',
      enable_nearby: 0,
      upload_tokens: ['tok-queue']
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(global.alert).not.toHaveBeenCalled();
    expect(refs[1].current).toBe(false);
  });
});


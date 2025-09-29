const path = require('path');

const uploadsFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'uploads.js'
);

function setupWindow(overrides = {}) {
  global.window = {
    ListItApp: {
      features: {
        uploads: {
          ...overrides
        }
      }
    }
  };
}

function teardownWindow() {
  delete global.window;
}

function loadFactory(overrides = {}) {
  setupWindow(overrides);
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(uploadsFeaturePath);
  return global.window.ListItApp.features.uploads.createUploadsFeature;
}

describe('uploads feature integration', () => {
  beforeEach(() => {
    jest.resetModules();
    teardownWindow();
  });

  afterEach(() => {
    teardownWindow();
  });

  test('requires an API client when creating the feature', () => {
    const utils = {
      dedupeImageUrls: jest.fn(),
      collectListingImages: jest.fn(),
      selectPrimaryListingImage: jest.fn(),
      filesToDataUrls: jest.fn(),
      fileToDataUrl: jest.fn(),
      AI_IMAGE_LIMIT: 3
    };
    const service = {
      clearDraftCacheForFile: jest.fn(),
      uploadFileDraft: jest.fn(),
      fetchListingImagesCached: jest.fn(),
      prepareListingForModal: jest.fn(),
      warmListingImages: jest.fn(),
      uploadFilesForListing: jest.fn(),
      uploadOneMessageImage: jest.fn(),
      listingImageCache: new Map(),
      listingImageInFlight: new Map()
    };

    const createUploadsFeature = loadFactory({
      createUploadsImageUtils: jest.fn(() => utils),
      createUploadsService: jest.fn(() => service)
    });

    expect(() => createUploadsFeature()).toThrow('Uploads feature requires an API client.');
  });

  test('throws when required namespace modules are missing', () => {
    const createUploadsFeature = loadFactory({});

    expect(() => createUploadsFeature({ api: {} })).toThrow(
      'Uploads feature requires the uploads image utils module.'
    );

    jest.resetModules();
    teardownWindow();

    const createUploadsFeatureWithoutService = loadFactory({
      createUploadsImageUtils: jest.fn(() => ({}))
    });

    expect(() => createUploadsFeatureWithoutService({ api: {} })).toThrow(
      'Uploads feature requires the uploads service module.'
    );
  });

  test('exposes utilities, services, and React hooks from namespace modules', () => {
    const utils = {
      dedupeImageUrls: jest.fn(),
      collectListingImages: jest.fn(),
      selectPrimaryListingImage: jest.fn(),
      filesToDataUrls: jest.fn(),
      fileToDataUrl: jest.fn(),
      AI_IMAGE_LIMIT: 5
    };

    const service = {
      clearDraftCacheForFile: jest.fn(),
      uploadFileDraft: jest.fn(),
      fetchListingImagesCached: jest.fn(),
      prepareListingForModal: jest.fn(),
      warmListingImages: jest.fn(),
      uploadFilesForListing: jest.fn(),
      uploadOneMessageImage: jest.fn(),
      listingImageCache: new Map(),
      listingImageInFlight: new Map()
    };

    const useFilePreviews = jest.fn(() => ['preview-a']);
    const React = { useState: jest.fn(), useEffect: jest.fn() };
    const api = { uploadDraft: jest.fn() };

    const createUploadsService = jest.fn(({ api: providedApi, utils: providedUtils }) => {
      expect(providedApi).toBe(api);
      expect(providedUtils).toBe(utils);
      return service;
    });

    const createUploadsFeature = loadFactory({
      createUploadsImageUtils: jest.fn(() => utils),
      createUploadsService,
      createUploadsHooks: jest.fn(() => ({ useFilePreviews }))
    });

    const feature = createUploadsFeature({ api, React });

    expect(feature.dedupeImageUrls).toBe(utils.dedupeImageUrls);
    expect(feature.collectListingImages).toBe(utils.collectListingImages);
    expect(feature.selectPrimaryListingImage).toBe(utils.selectPrimaryListingImage);
    expect(feature.filesToDataUrls).toBe(utils.filesToDataUrls);
    expect(feature.fileToDataUrl).toBe(utils.fileToDataUrl);
    expect(feature.AI_IMAGE_LIMIT).toBe(5);

    expect(feature.clearDraftCacheForFile).toBe(service.clearDraftCacheForFile);
    expect(feature.uploadFileDraft).toBe(service.uploadFileDraft);
    expect(feature.fetchListingImagesCached).toBe(service.fetchListingImagesCached);
    expect(feature.prepareListingForModal).toBe(service.prepareListingForModal);
    expect(feature.warmListingImages).toBe(service.warmListingImages);
    expect(feature.uploadFilesForListing).toBe(service.uploadFilesForListing);
    expect(feature.uploadOneMessageImage).toBe(service.uploadOneMessageImage);
    expect(feature.listingImageCache).toBe(service.listingImageCache);
    expect(feature.listingImageInFlight).toBe(service.listingImageInFlight);

    expect(feature.useFilePreviews()).toEqual(['preview-a']);
    expect(useFilePreviews).toHaveBeenCalledTimes(1);
  });

  test('useFilePreviews throws when React is not provided', () => {
    const utils = {
      dedupeImageUrls: jest.fn(),
      collectListingImages: jest.fn(),
      selectPrimaryListingImage: jest.fn(),
      filesToDataUrls: jest.fn(),
      fileToDataUrl: jest.fn(),
      AI_IMAGE_LIMIT: 3
    };

    const service = {
      clearDraftCacheForFile: jest.fn(),
      uploadFileDraft: jest.fn(),
      fetchListingImagesCached: jest.fn(),
      prepareListingForModal: jest.fn(),
      warmListingImages: jest.fn(),
      uploadFilesForListing: jest.fn(),
      uploadOneMessageImage: jest.fn(),
      listingImageCache: new Map(),
      listingImageInFlight: new Map()
    };

    const createUploadsFeature = loadFactory({
      createUploadsImageUtils: jest.fn(() => utils),
      createUploadsService: jest.fn(() => service),
      createUploadsHooks: jest.fn(() => ({ useFilePreviews: jest.fn() }))
    });

    const feature = createUploadsFeature({ api: {} });

    expect(() => feature.useFilePreviews()).toThrow(
      'useFilePreviews requires React to be provided to createUploadsFeature.'
    );
  });

  test('falls back to throwing hook when hooks factory is unavailable or incomplete', () => {
    const utils = {
      dedupeImageUrls: jest.fn(),
      collectListingImages: jest.fn(),
      selectPrimaryListingImage: jest.fn(),
      filesToDataUrls: jest.fn(),
      fileToDataUrl: jest.fn(),
      AI_IMAGE_LIMIT: 2
    };

    const service = {
      clearDraftCacheForFile: jest.fn(),
      uploadFileDraft: jest.fn(),
      fetchListingImagesCached: jest.fn(),
      prepareListingForModal: jest.fn(),
      warmListingImages: jest.fn(),
      uploadFilesForListing: jest.fn(),
      uploadOneMessageImage: jest.fn(),
      listingImageCache: new Map(),
      listingImageInFlight: new Map()
    };

    const React = { useState: jest.fn(), useEffect: jest.fn() };

    const createUploadsFeatureWithoutHooks = loadFactory({
      createUploadsImageUtils: jest.fn(() => utils),
      createUploadsService: jest.fn(() => service)
    });

    const featureWithoutHooks = createUploadsFeatureWithoutHooks({ api: {}, React });
    expect(() => featureWithoutHooks.useFilePreviews()).toThrow(
      'useFilePreviews requires React to be provided to createUploadsFeature.'
    );

    jest.resetModules();
    teardownWindow();

    const createUploadsFeatureWithIncompleteHooks = loadFactory({
      createUploadsImageUtils: jest.fn(() => utils),
      createUploadsService: jest.fn(() => service),
      createUploadsHooks: jest.fn(() => ({}))
    });

    const featureWithIncompleteHooks = createUploadsFeatureWithIncompleteHooks({ api: {}, React });
    expect(() => featureWithIncompleteHooks.useFilePreviews()).toThrow(
      'useFilePreviews requires React to be provided to createUploadsFeature.'
    );
  });
});

(() => {
  function createUploadsFeature({ api, React } = {}) {
    if (!api) {
      throw new Error('Uploads feature requires an API client.');
    }

    const root = typeof window !== 'undefined' ? window : {};
    const uploadsNamespace = root.ListItApp?.features?.uploads || {};
    const createUploadsImageUtils = uploadsNamespace.createUploadsImageUtils;
    const createUploadsService = uploadsNamespace.createUploadsService;
    const createUploadsHooks = uploadsNamespace.createUploadsHooks;

    if (typeof createUploadsImageUtils !== 'function') {
      throw new Error('Uploads feature requires the uploads image utils module.');
    }
    if (typeof createUploadsService !== 'function') {
      throw new Error('Uploads feature requires the uploads service module.');
    }

    const utils = createUploadsImageUtils();
    const service = createUploadsService({ api, utils });

    const hasReact = !!(React && typeof React.useState === 'function' && typeof React.useEffect === 'function');
    let useFilePreviews = () => {
      throw new Error('useFilePreviews requires React to be provided to createUploadsFeature.');
    };

    if (hasReact && typeof createUploadsHooks === 'function') {
      const hooks = createUploadsHooks({ React });
      if (hooks && typeof hooks.useFilePreviews === 'function') {
        useFilePreviews = hooks.useFilePreviews;
      }
    }

    return {
      dedupeImageUrls: utils.dedupeImageUrls,
      collectListingImages: utils.collectListingImages,
      selectPrimaryListingImage: utils.selectPrimaryListingImage,
      clearDraftCacheForFile: service.clearDraftCacheForFile,
      uploadFileDraft: service.uploadFileDraft,
      fetchListingImagesCached: service.fetchListingImagesCached,
      prepareListingForModal: service.prepareListingForModal,
      warmListingImages: service.warmListingImages,
      uploadFilesForListing: service.uploadFilesForListing,
      uploadOneMessageImage: service.uploadOneMessageImage,
      listingImageCache: service.listingImageCache,
      listingImageInFlight: service.listingImageInFlight,
      useFilePreviews,
      filesToDataUrls: utils.filesToDataUrls,
      fileToDataUrl: utils.fileToDataUrl,
      AI_IMAGE_LIMIT: utils.AI_IMAGE_LIMIT
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.uploads = window.ListItApp.features.uploads || {};
  window.ListItApp.features.uploads.createUploadsFeature = createUploadsFeature;
})();

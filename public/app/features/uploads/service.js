(() => {
  const core = (typeof ListItCore === 'object' && ListItCore !== null) ? ListItCore : null;
  if (!core || typeof core.createUploadsService !== 'function') {
    throw new Error('Shared core is missing createUploadsService export.');
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.uploads = window.ListItApp.features.uploads || {};
  window.ListItApp.features.uploads.createUploadsService = core.createUploadsService;
})();

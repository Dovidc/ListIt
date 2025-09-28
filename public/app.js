// public/app.js
//
// S3-first uploads (presign -> PUT -> finalize) + AI helper via local dataURLs
// Messages: paste/drag/attach images -> S3 URLs (kept!)
// Conversations list: red "x" delete button (kept!)
// CHANGE: All listing fields optional EXCEPT at least one image.
//         If price field empty/invalid, default to $0.00 and render the price in green.
// NEW: MassList -- pick multiple photos -> AI per image -> create multiple listings with uploads.
// NEW: Auto-list setting (Profile): when ON, attaching photos in the New listing form
//      will AI-analyze and immediately create the listing + upload photos automatically.
//      Includes "?" help modal with high-contrast text.
// NEW: Auto-list sub-toggle: "Also post to Nearby." When Auto-list is ON and this is enabled,
//      auto-created (and MassListed) items are created with enable_nearby=1 and lat/lon set.
//
// NEW (this file):
// - Thin-fetch + pagination for the Listings tab (75 per page, default sort=Newest)
//   * /api/listings uses ?noimg=1 (metadata only) with ?page=1&limit=75
//   * Batch prewarm first covers via /api/listings/covers
//   * Client guards against array OR {rows, hasNext, total, page} responses.

(() => {
  const runtimeReact = window.React;
  if (!runtimeReact) {
    throw new Error('React bundle failed to load.');
  }

  const runtimeReactDOM = window.ReactDOM;
  if (!runtimeReactDOM) {
    throw new Error('ReactDOM bundle failed to load.');
  }

  const createBrowserApp = window.ListItApp?.bootstrap?.createBrowserApp;
  if (typeof createBrowserApp !== 'function') {
    throw new Error('Browser app bundle failed to load.');
  }

  const app = createBrowserApp({
    React: runtimeReact,
    ReactDOM: runtimeReactDOM,
    core: window.ListItCore || {},
    appBundles: window.ListItApp
  });

  app.mount();
})();

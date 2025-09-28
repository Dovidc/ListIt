(() => {
  function createUploadsImageUtils() {
    const AI_IMAGE_LIMIT = 8;

    async function filesToDataUrls(files = []) {
      const toBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });

      const list = Array.isArray(files) ? files.slice(0, AI_IMAGE_LIMIT) : [];
      const out = [];
      for (const file of list) {
        out.push(await toBase64(file));
      }
      return out;
    }

    async function fileToDataUrl(file) {
      const list = await filesToDataUrls(file ? [file] : []);
      return Array.isArray(list) && list.length > 0 ? list[0] : undefined;
    }

    function dedupeImageUrls(input) {
      if (!Array.isArray(input)) return [];
      const seen = new Set();
      const out = [];
      for (const raw of input) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const key = trimmed.split('?')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
      }
      return out;
    }

    function collectListingImages(listing, primarySrc, options = {}) {
      const { includeDataFallback = true, includeListingFallbackFields = true, extra = [] } = options;
      const remote = [];
      let dataFallback = null;

      function push(url) {
        if (!url || typeof url !== 'string') return;
        const trimmed = url.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
          if (includeDataFallback && !dataFallback) dataFallback = trimmed;
        } else {
          remote.push(trimmed);
        }
      }

      const extras = Array.isArray(extra) ? extra : [extra];
      extras.forEach(push);
      push(primarySrc);

      if (listing) {
        if (Array.isArray(listing.images)) listing.images.forEach(push);
        if (includeListingFallbackFields) {
          push(listing.image_data);
          push(listing.thumb_url);
        }
      }

      const dedupedRemote = dedupeImageUrls(remote);
      if (dedupedRemote.length) return dedupedRemote;
      if (includeDataFallback && dataFallback) return [dataFallback];
      return [];
    }

    function selectPrimaryListingImage(listing, primarySrc) {
      const list = collectListingImages(listing, primarySrc, {
        includeListingFallbackFields: true,
        includeDataFallback: true
      });
      return Array.isArray(list) && list.length ? list[0] : '';
    }

    async function measureImageFile(file) {
      if (!(file instanceof File)) {
        return { width: null, height: null };
      }
      return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const dims = { width: img.naturalWidth || null, height: img.naturalHeight || null };
          URL.revokeObjectURL(objectUrl);
          resolve(dims);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve({ width: null, height: null });
        };
        img.src = objectUrl;
      });
    }

    return {
      AI_IMAGE_LIMIT,
      filesToDataUrls,
      fileToDataUrl,
      dedupeImageUrls,
      collectListingImages,
      selectPrimaryListingImage,
      measureImageFile
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.uploads = window.ListItApp.features.uploads || {};
  window.ListItApp.features.uploads.createUploadsImageUtils = createUploadsImageUtils;
})();

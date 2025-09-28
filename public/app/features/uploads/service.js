(() => {
  function createUploadsService({ api, utils } = {}) {
    if (!api) {
      throw new Error('Uploads service requires an API client.');
    }
    if (!utils) {
      throw new Error('Uploads service requires image utilities.');
    }

    const {
      measureImageFile,
      dedupeImageUrls,
      collectListingImages
    } = utils;

    const uploadDraftCache = new WeakMap();
    const listingImageCache = new Map();
    const listingImageInFlight = new Map();

    function createConcurrencyLimiter(maxConcurrent = 3) {
      let active = 0;
      const queue = [];

      const next = () => {
        if (active >= maxConcurrent || queue.length === 0) return;
        const { fn, resolve, reject } = queue.shift();
        active += 1;

        let finished = false;
        const finalize = () => {
          if (!finished) {
            finished = true;
            active -= 1;
            next();
          }
        };

        try {
          Promise.resolve(fn()).then(
            (value) => {
              finalize();
              resolve(value);
            },
            (err) => {
              finalize();
              reject(err);
            }
          );
        } catch (err) {
          finalize();
          reject(err);
        }
      };

      return function schedule(fn) {
        return new Promise((resolve, reject) => {
          queue.push({ fn, resolve, reject });
          next();
        });
      };
    }

    const s3UploadLimiter = createConcurrencyLimiter(3);

    function clearDraftCacheForFile(file) {
      if (uploadDraftCache.has(file)) uploadDraftCache.delete(file);
    }

    async function uploadFileDraft(file) {
      if (!file) throw new Error('file_required');

      if (!uploadDraftCache.has(file)) {
        const uploadPromise = s3UploadLimiter(async () => {
          const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
          if (sig?.error) throw new Error(sig.error);
          if (!sig?.uploadUrl || !sig?.publicUrl || !sig?.Key) throw new Error('invalid_presign');

          const putRes = await fetch(sig.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
          if (!putRes.ok) throw new Error('s3_put_failed');

          const dims = await measureImageFile(file);

          const finalizeRes = await api.finalizeUpload({
            key: sig.Key,
            url: sig.publicUrl,
            width: dims.width,
            height: dims.height,
            bytes: file.size
          }, { silent: true });

          if (finalizeRes?.error) throw new Error(finalizeRes.error);
          if (!finalizeRes?.uploadToken) throw new Error('missing_upload_token');

          return {
            uploadToken: finalizeRes.uploadToken,
            publicUrl: finalizeRes.url || sig.publicUrl,
            width: finalizeRes.width ?? dims.width ?? null,
            height: finalizeRes.height ?? dims.height ?? null,
            bytes: finalizeRes.bytes ?? file.size
          };
        }).catch((err) => {
          clearDraftCacheForFile(file);
          throw err;
        });

        uploadDraftCache.set(file, uploadPromise);
      }

      return uploadDraftCache.get(file);
    }

    async function fetchListingImagesCached(listingId, options = {}) {
      const minCount = Number(options.minCount) || 0;
      if (!Number.isFinite(Number(listingId))) return [];
      if (listingImageInFlight.has(listingId)) {
        return listingImageInFlight.get(listingId);
      }
      if (listingImageCache.has(listingId)) {
        const cached = listingImageCache.get(listingId);
        if (Array.isArray(cached) && cached.length >= minCount) {
          return cached;
        }
      }
      const promise = (async () => {
        try {
          const arr = await api.getListingImages(listingId);
          const safe = Array.isArray(arr) ? arr.filter(Boolean) : [];
          const deduped = dedupeImageUrls(safe);
          if (deduped.length) {
            listingImageCache.set(listingId, deduped);
          } else {
            listingImageCache.delete(listingId);
          }
          return deduped;
        } catch {
          listingImageCache.delete(listingId);
          return [];
        } finally {
          listingImageInFlight.delete(listingId);
        }
      })();
      listingImageInFlight.set(listingId, promise);
      return promise;
    }

    function prepareListingForModal(listing, coverHint) {
      if (!listing || typeof listing !== 'object') {
        return { payload: null, images: [], cover: '' };
      }

      const candidateSources = [];
      if (typeof coverHint === 'string') candidateSources.push(coverHint);
      if (typeof listing.image_data === 'string') candidateSources.push(listing.image_data);
      if (typeof listing.__cover === 'string') candidateSources.push(listing.__cover);
      if (typeof listing.thumb_url === 'string') candidateSources.push(listing.thumb_url);

      let cover = '';
      for (const src of candidateSources) {
        if (typeof src !== 'string') continue;
        const trimmed = src.trim();
        if (trimmed) {
          cover = trimmed;
          break;
        }
      }

      const payload = { ...listing };
      if (cover) payload.image_data = cover;

      const inline = collectListingImages(payload, cover);
      if (inline.length) {
        payload.images = inline;
        if (listing?.id) {
          listingImageCache.set(listing.id, inline);
        }
      }

      return { payload, images: inline, cover };
    }

    function warmListingImages(listingId, baseImages) {
      if (!Number.isFinite(Number(listingId))) return;
      const baseCount = Array.isArray(baseImages)
        ? baseImages.length
        : (Number.isFinite(Number(baseImages)) ? Number(baseImages) : 0);
      const minCount = baseCount + 1;
      fetchListingImagesCached(listingId, { minCount }).catch(() => {});
    }

    async function uploadOneImage(listingId, file) {
      const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
      if (sig?.error) throw new Error(sig.error);
      const putRes = await fetch(sig.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('s3_put_failed');

      const dims = await measureImageFile(file);

      await api.finalizeUpload({
        listingId,
        key: sig.Key,
        url: sig.publicUrl,
        width: dims.width,
        height: dims.height,
        bytes: file.size
      });

      return sig.publicUrl;
    }

    async function uploadFilesForListing(listingId, files = []) {
      const out = [];
      for (const f of files) {
        const url = await uploadOneImage(listingId, f);
        out.push(url);
      }
      return out;
    }

    async function uploadOneMessageImage(file) {
      const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
      if (sig.error) throw new Error(sig.error);

      const putRes = await fetch(sig.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('s3_put_failed');

      return sig.publicUrl;
    }

    return {
      clearDraftCacheForFile,
      uploadFileDraft,
      fetchListingImagesCached,
      prepareListingForModal,
      warmListingImages,
      uploadFilesForListing,
      uploadOneMessageImage,
      listingImageCache,
      listingImageInFlight
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.uploads = window.ListItApp.features.uploads || {};
  window.ListItApp.features.uploads.createUploadsService = createUploadsService;
})();

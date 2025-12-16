/**
 * Background Upload Service for Capacitor Native Apps
 *
 * Uses @capgo/capacitor-uploader for true background uploads that survive
 * app termination. Falls back to regular XHR uploads on web.
 *
 * Required Capacitor plugins:
 * - @capgo/capacitor-uploader
 * - @capacitor/filesystem
 */
(() => {
  function createBackgroundUploadService({ api } = {}) {
    if (!api) {
      throw new Error('Background upload service requires an API client.');
    }

    // Check if we're running in Capacitor native environment
    function isCapacitorNative() {
      return typeof window !== 'undefined' &&
        window.Capacitor &&
        window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform();
    }

    // Check if required plugins are available
    function hasBackgroundUploadSupport() {
      if (!isCapacitorNative()) return false;
      const plugins = window.Capacitor?.Plugins || {};
      return !!(plugins.Uploader && plugins.Filesystem);
    }

    // Track pending uploads for this session
    const pendingUploads = new Map();

    /**
     * Convert a Blob/File to a temporary file on the device filesystem.
     * Returns the file URI that can be used with native uploader.
     */
    async function writeToTempFile(blob, filename) {
      if (!isCapacitorNative()) {
        throw new Error('writeToTempFile requires Capacitor native environment');
      }

      const { Filesystem, Directory } = window.Capacitor.Plugins;

      // Convert blob to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          // Remove data URL prefix (data:image/jpeg;base64,)
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Generate unique filename
      const timestamp = Date.now();
      const safeName = filename.replace(/[^a-z0-9._-]/gi, '_');
      const tempFilename = `upload_${timestamp}_${safeName}`;

      // Write to cache directory
      const result = await Filesystem.writeFile({
        path: tempFilename,
        data: base64,
        directory: Directory.Cache
      });

      return result.uri;
    }

    /**
     * Delete a temporary file after upload completes.
     */
    async function deleteTempFile(uri) {
      if (!isCapacitorNative()) return;

      try {
        const { Filesystem } = window.Capacitor.Plugins;
        // Extract path from URI
        const path = uri.replace(/^file:\/\//, '');
        await Filesystem.deleteFile({ path });
      } catch (e) {
        // Ignore delete errors - file may already be cleaned up
        console.log('[BackgroundUpload] Could not delete temp file:', e.message);
      }
    }

    /**
     * Start a native background upload.
     * Returns immediately - upload continues even if app closes.
     */
    async function startNativeBackgroundUpload({
      fileUri,
      uploadUrl,
      publicUrl,
      key,
      listingId,
      slot,
      onProgress,
      onComplete,
      onError
    }) {
      const { Uploader } = window.Capacitor.Plugins;

      const uploadId = `listing_${listingId}_slot_${slot}_${Date.now()}`;

      // Track this upload
      pendingUploads.set(uploadId, {
        listingId,
        slot,
        publicUrl,
        key,
        fileUri,
        status: 'uploading',
        progress: 0
      });

      try {
        // Start the upload using native background session
        await Uploader.startUpload({
          id: uploadId,
          filePath: fileUri,
          serverUrl: uploadUrl,
          method: 'PUT',
          headers: {
            'Content-Type': 'image/jpeg'
          },
          // iOS: use background session
          // Android: use WorkManager
          backgroundUpload: true
        });

        // Listen for events
        Uploader.addListener('events', async (event) => {
          if (event.id !== uploadId) return;

          const upload = pendingUploads.get(uploadId);
          if (!upload) return;

          if (event.state === 'uploading') {
            upload.progress = event.percent || 0;
            upload.status = 'uploading';
            onProgress?.(event.percent || 0);
          }

          if (event.state === 'completed') {
            upload.status = 'completed';
            upload.progress = 100;

            // Finalize the upload on our server
            try {
              const finalizeResult = await api.finalizeUpload({
                listingId,
                key,
                url: publicUrl,
                width: null, // Will be determined server-side or later
                height: null,
                bytes: null
              }, { silent: true });

              onComplete?.({
                listingId,
                slot,
                publicUrl,
                imagesPending: finalizeResult?.images_pending ?? 0
              });
            } catch (err) {
              console.error('[BackgroundUpload] Finalize failed:', err);
              onError?.(err);
            }

            // Cleanup
            pendingUploads.delete(uploadId);
            deleteTempFile(fileUri);
          }

          if (event.state === 'failed') {
            upload.status = 'failed';
            upload.error = event.error;
            onError?.(new Error(event.error || 'Upload failed'));
            pendingUploads.delete(uploadId);
            deleteTempFile(fileUri);
          }
        });

        return uploadId;

      } catch (err) {
        pendingUploads.delete(uploadId);
        deleteTempFile(fileUri);
        throw err;
      }
    }

    /**
     * Upload via XHR (web fallback).
     * Doesn't survive page close but works everywhere.
     */
    async function startWebUpload({
      blob,
      uploadUrl,
      publicUrl,
      key,
      listingId,
      slot,
      onProgress,
      onComplete,
      onError
    }) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress?.(percent);
          }
        });

        xhr.addEventListener('load', async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              // Finalize the upload
              const finalizeResult = await api.finalizeUpload({
                listingId,
                key,
                url: publicUrl,
                width: null,
                height: null,
                bytes: blob.size
              }, { silent: true });

              onComplete?.({
                listingId,
                slot,
                publicUrl,
                imagesPending: finalizeResult?.images_pending ?? 0
              });
              resolve({ success: true });
            } catch (err) {
              onError?.(err);
              reject(err);
            }
          } else {
            const err = new Error(`Upload failed: ${xhr.status}`);
            onError?.(err);
            reject(err);
          }
        });

        xhr.addEventListener('error', () => {
          const err = new Error('Network error during upload');
          onError?.(err);
          reject(err);
        });

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', 'image/jpeg');
        xhr.send(blob);
      });
    }

    /**
     * Main entry point: Create a shell listing and start background uploads.
     *
     * @param {Object} options
     * @param {Array<Blob>} options.images - Compressed image blobs
     * @param {string} options.location - Location string
     * @param {string} options.title - Optional title
     * @param {string} options.description - Optional description
     * @param {number} options.price - Optional price
     * @param {boolean} options.enable_nearby - Show in nearby
     * @param {boolean} options.inquiry_enabled - Show offer banner
     * @param {number} options.lat - Latitude
     * @param {number} options.lon - Longitude
     * @param {Function} options.onListingCreated - Called when shell listing is created
     * @param {Function} options.onImageProgress - Called with (slot, percent)
     * @param {Function} options.onImageComplete - Called when an image finishes
     * @param {Function} options.onAllComplete - Called when all images finish
     * @param {Function} options.onError - Called on error
     */
    async function createListingWithBackgroundUpload({
      images,
      location,
      title,
      description,
      price,
      enable_nearby,
      inquiry_enabled,
      lat,
      lon,
      tags,
      onListingCreated,
      onImageProgress,
      onImageComplete,
      onAllComplete,
      onError
    }) {
      if (!images || !images.length) {
        throw new Error('At least one image is required');
      }

      if (!location) {
        throw new Error('Location is required');
      }

      const useNative = hasBackgroundUploadSupport();
      console.log(`[BackgroundUpload] Using ${useNative ? 'native' : 'web'} upload`);

      // Step 1: Create the shell listing (fast, ~200ms)
      let shellResponse;
      try {
        shellResponse = await api.createListingShell({
          location,
          title,
          description,
          price,
          enable_nearby,
          inquiry_enabled,
          lat,
          lon,
          tags,
          image_count: images.length
        });
      } catch (err) {
        onError?.(err);
        throw err;
      }

      const { listing_id, upload_slots } = shellResponse;
      console.log(`[BackgroundUpload] Created shell listing ${listing_id} with ${upload_slots.length} upload slots`);

      // Notify that listing is created
      onListingCreated?.({ listing_id, images_pending: images.length });

      // Step 2: Start uploads for each image
      let completedCount = 0;
      const totalImages = Math.min(images.length, upload_slots.length);

      const handleImageComplete = (result) => {
        completedCount++;
        onImageComplete?.(result);

        if (completedCount >= totalImages) {
          onAllComplete?.({ listing_id, total: totalImages });
        }
      };

      // Start all uploads in parallel
      const uploadPromises = [];

      for (let i = 0; i < totalImages; i++) {
        const blob = images[i];
        const slot = upload_slots[i];

        if (!slot) continue;

        const uploadOptions = {
          uploadUrl: slot.uploadUrl,
          publicUrl: slot.publicUrl,
          key: slot.key,
          listingId: listing_id,
          slot: i,
          onProgress: (percent) => onImageProgress?.(i, percent),
          onComplete: handleImageComplete,
          onError: (err) => {
            console.error(`[BackgroundUpload] Image ${i} failed:`, err);
            onError?.(err);
          }
        };

        if (useNative) {
          // Write to temp file and start native upload
          const tempFilePromise = writeToTempFile(blob, `image_${i}.jpg`)
            .then((fileUri) => {
              return startNativeBackgroundUpload({
                ...uploadOptions,
                fileUri
              });
            })
            .catch((err) => {
              console.error(`[BackgroundUpload] Native upload ${i} failed:`, err);
              // Fall back to web upload on error
              return startWebUpload({ ...uploadOptions, blob });
            });

          uploadPromises.push(tempFilePromise);
        } else {
          // Use web upload
          uploadPromises.push(startWebUpload({ ...uploadOptions, blob }));
        }
      }

      // Don't await - let uploads continue in background
      Promise.allSettled(uploadPromises).then((results) => {
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length) {
          console.warn(`[BackgroundUpload] ${failures.length}/${totalImages} uploads failed`);
        }
      });

      // Return immediately with listing_id
      return {
        listing_id,
        images_pending: totalImages,
        isBackgroundUpload: useNative
      };
    }

    /**
     * Get pending upload status for a listing.
     */
    function getPendingUploadsForListing(listingId) {
      const uploads = [];
      for (const [id, upload] of pendingUploads) {
        if (upload.listingId === listingId) {
          uploads.push({ id, ...upload });
        }
      }
      return uploads;
    }

    /**
     * Check if any uploads are pending.
     */
    function hasPendingUploads() {
      return pendingUploads.size > 0;
    }

    return {
      isCapacitorNative,
      hasBackgroundUploadSupport,
      createListingWithBackgroundUpload,
      getPendingUploadsForListing,
      hasPendingUploads,
      // Expose for testing
      writeToTempFile,
      startNativeBackgroundUpload,
      startWebUpload
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.uploads = window.ListItApp.features.uploads || {};
  window.ListItApp.features.uploads.createBackgroundUploadService = createBackgroundUploadService;
})();

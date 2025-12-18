(() => {
  function createListingFormsFeature({
    React,
    ReactDOM,
    api,
    helpers = {},
    uploads = {},
    formatting = {},
    components = {}
  } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Listing forms feature requires React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Listing forms feature requires ReactDOM.');
    }
    if (!api) {
      throw new Error('Listing forms feature requires an API client.');
    }

    const {
      isMobileDevice,
      isCapacitorNative,
      fetchCoordsAndReverse
    } = helpers;
    if (typeof isMobileDevice !== 'function') {
      throw new Error('Listing forms feature requires isMobileDevice helper.');
    }
    if (typeof fetchCoordsAndReverse !== 'function') {
      throw new Error('Listing forms feature requires fetchCoordsAndReverse helper.');
    }

    const {
      clearDraftCacheForFile,
      uploadFileDraft,
      uploadFilesForListing,
      useFilePreviews,
      AI_IMAGE_LIMIT,
      // Optional: background upload service for native apps
      backgroundUploadService
    } = uploads;

    if (typeof clearDraftCacheForFile !== 'function') {
      throw new Error('Listing forms feature requires clearDraftCacheForFile helper.');
    }
    if (typeof uploadFileDraft !== 'function') {
      throw new Error('Listing forms feature requires uploadFileDraft helper.');
    }
    if (typeof uploadFilesForListing !== 'function') {
      throw new Error('Listing forms feature requires uploadFilesForListing helper.');
    }
    if (typeof useFilePreviews !== 'function') {
      throw new Error('Listing forms feature requires useFilePreviews hook.');
    }
    if (!AI_IMAGE_LIMIT) {
      throw new Error('Listing forms feature requires AI_IMAGE_LIMIT.');
    }

    const { price } = formatting;
    if (typeof price !== 'function') {
      throw new Error('Listing forms feature requires price formatter.');
    }

    function formatLocationDisplay(result, fallback = '') {
      const safeFallback = typeof fallback === 'string' ? fallback : '';
      if (!result || typeof result !== 'object') return safeFallback;
      const city = typeof result.city === 'string' ? result.city.trim() : '';
      const state = typeof result.state === 'string' ? result.state.trim() : '';
      const country = typeof result.country === 'string' ? result.country.trim() : '';
      const joined = [city, state || country].filter(Boolean).join(', ');
      if (joined) return joined;
      const display = typeof result.display === 'string' ? result.display.trim() : '';
      return display || safeFallback;
    }

    const { ListingForm, ImageWithSkeleton } = components;
    if (typeof ListingForm !== 'function') {
      throw new Error('Listing forms feature requires ListingForm component.');
    }
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Listing forms feature requires ImageWithSkeleton component.');
    }

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);
    const {
      useEffect,
      useRef,
      useState
    } = React;

    const TOUCH_CONTROL_FONT_SIZE = 16;
    const TOUCH_CONTROL_LINE_HEIGHT = '24px';
    const TOUCH_CONTROL_STYLE = Object.freeze({
      fontSize: `${TOUCH_CONTROL_FONT_SIZE}px`,
      lineHeight: TOUCH_CONTROL_LINE_HEIGHT,
      padding: '10px'
    });
    const TOUCH_BUTTON_STYLE = Object.freeze({
      fontSize: `${TOUCH_CONTROL_FONT_SIZE}px`,
      padding: '10px'
    });

    // Shared helper used by mobile flows to fully create a listing without rendering
    // the edit screen. This uses the fire-and-forget API - images are uploaded,
    // then a background job is enqueued on the server. The listing will be created
    // even if the user closes the app. Callers can supply callbacks to react to
    // job submission or polling for completion.
    /**
     * Convert a File/Blob to base64 data URL
     */
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    /**
     * Compress an image file to reduce upload size.
     * Target: ~500KB for fast upload while maintaining quality.
     */
    async function compressImage(file, maxWidth = 1200, quality = 0.8) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            // Calculate dimensions
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }

            // Draw to canvas
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to blob
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  resolve({ blob, width, height });
                } else {
                  reject(new Error('Canvas toBlob failed'));
                }
              },
              'image/jpeg',
              quality
            );
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error('Image load failed'));

        // Load image from file
        const url = URL.createObjectURL(file);
        img.src = url;
      });
    }

    /**
     * Native background upload flow:
     * 1. Compress images to blobs
     * 2. Run AI analysis to get title/description/price/tags
     * 3. Create shell listing with AI-generated content
     * 4. Start native background uploads to S3
     * 5. User can close app - iOS/Android continue uploads
     * 6. When uploads complete, images attach to listing
     */
    async function runAutoListWithBackgroundUpload({
      files,
      location,
      autoPostNearbyEnabled,
      autoInquiryEnabled,
      enqueueListingJob,
      reloadMineRef,
      reloadAllRef,
      reloadMine,
      reloadAll,
      onCreated,
      onError,
      onJobQueued
    }) {
      const startTime = Date.now();

      // Convert files to array
      let fileArray;
      try {
        if (files instanceof FileList) {
          fileArray = Array.from(files);
        } else if (Array.isArray(files)) {
          fileArray = files;
        } else if (files && typeof files[Symbol.iterator] === 'function') {
          fileArray = Array.from(files);
        } else {
          fileArray = files ? [files] : [];
        }
      } catch (e) {
        console.error('[AutoList/BG] Error converting files:', e);
        fileArray = [];
      }

      const validFiles = fileArray.filter(f => f && (f instanceof Blob || f instanceof File || f.uri));
      console.log('[AutoList/BG] Valid files:', validFiles.length);

      if (!validFiles.length) {
        throw new Error('No images provided for auto-listing.');
      }

      // Step 1: Compress images to blobs (same as regular flow)
      console.log('[AutoList/BG] Compressing', validFiles.length, 'images...');
      const compressedBlobs = [];
      const base64Images = []; // For AI analysis

      for (let i = 0; i < Math.min(validFiles.length, 12); i++) {
        try {
          const { blob } = await compressImage(validFiles[i], 1200, 0.8);
          compressedBlobs.push(blob);

          // Also convert to base64 for AI (only first few images)
          if (i < AI_IMAGE_LIMIT) {
            const base64 = await fileToBase64(blob);
            base64Images.push(base64);
          }
        } catch (e) {
          console.warn(`[AutoList/BG] Failed to compress image ${i}:`, e);
          // Use original if compression fails
          compressedBlobs.push(validFiles[i]);
        }
      }

      if (!compressedBlobs.length) {
        throw new Error('Failed to process images');
      }

      console.log(`[AutoList/BG] Compressed ${compressedBlobs.length} images in ${Date.now() - startTime}ms`);

      // Step 2: Determine location (same as regular flow)
      const manualLocation = String(location || '').trim();
      let locAuto = manualLocation;
      let latAuto = null;
      let lonAuto = null;
      let enableNearbyAuto = false;

      if (autoPostNearbyEnabled || !locAuto) {
        try {
          const c = await fetchCoordsAndReverse({ silent: true });
          if (c && c.lat != null && c.lon != null) {
            if (autoPostNearbyEnabled) {
              enableNearbyAuto = true;
            }
            latAuto = c.lat;
            lonAuto = c.lon;
            if (!locAuto) locAuto = formatLocationDisplay(c, c.display || '');
          }
        } catch (err) {
          console.warn('[AutoList/BG] Location lookup failed:', err);
        }
      }

      if (!locAuto) {
        locAuto = 'Unknown location';
      }

      // Step 3: Run AI analysis to get title/description/price/tags
      let aiTitle = null;
      let aiDescription = null;
      let aiPrice = null;
      let aiTags = null;

      if (base64Images.length > 0 && typeof api.aiAnalyze === 'function') {
        console.log(`[AutoList/BG] Running AI analysis on ${base64Images.length} images...`);
        const aiStartTime = Date.now();

        try {
          const aiResult = await api.aiAnalyze({
            images: base64Images,
            hint: ''
          });

          if (aiResult) {
            aiTitle = aiResult.title || null;
            aiDescription = aiResult.description || null;
            aiPrice = typeof aiResult.price === 'number' ? aiResult.price : null;
            aiTags = Array.isArray(aiResult.tags) ? aiResult.tags : null;
          }

          console.log(`[AutoList/BG] AI analysis complete in ${Date.now() - aiStartTime}ms: "${aiTitle}"`);
        } catch (aiErr) {
          console.warn('[AutoList/BG] AI analysis failed (continuing without):', aiErr.message);
          // Continue without AI - listing will have no title/description
        }
      }

      // Step 4: Create shell listing with AI-generated content + background uploads
      try {
        const result = await backgroundUploadService.createListingWithBackgroundUpload({
          images: compressedBlobs,
          location: locAuto,
          title: aiTitle,
          description: aiDescription,
          price: aiPrice,
          enable_nearby: enableNearbyAuto,
          inquiry_enabled: typeof autoInquiryEnabled === 'boolean' ? autoInquiryEnabled : true,
          lat: latAuto,
          lon: lonAuto,
          tags: aiTags,

          onListingCreated: ({ listing_id, images_pending }) => {
            console.log(`[AutoList/BG] Shell listing ${listing_id} created, ${images_pending} images pending`);

            // Notify that job was "queued" - caller handles hiding "Keep app open" toast
            try {
              onJobQueued?.({ listing_id, status: 'uploading', images_pending });
            } catch (e) {
              console.warn('[AutoList/BG] onJobQueued callback error:', e);
            }
          },

          onImageProgress: (slot, percent) => {
            // Could update UI with progress here
            console.log(`[AutoList/BG] Image ${slot} upload: ${percent}%`);
          },

          onImageComplete: ({ listingId, slot, publicUrl, imagesPending }) => {
            console.log(`[AutoList/BG] Image ${slot} complete, ${imagesPending} remaining`);
          },

          onAllComplete: async ({ listing_id, total }) => {
            console.log(`[AutoList/BG] All ${total} images uploaded for listing ${listing_id}`);

            // Reload listings
            const mineFn = reloadMineRef?.current ?? reloadMine;
            const allFn = reloadAllRef?.current ?? reloadAll;

            try { await mineFn?.(); } catch { }
            try { await allFn?.({ preserveExisting: true }); } catch { }

            // Fetch the completed listing
            try {
              // TODO: Could fetch the listing here to pass to onCreated
              onCreated?.({ id: listing_id });
            } catch (e) {
              console.warn('[AutoList/BG] onCreated callback error:', e);
            }
          },

          onError: (err) => {
            console.error('[AutoList/BG] Upload error:', err);
            try { onError?.(err); } catch (e) { console.warn('[AutoList/BG] onError callback error:', e); }
          }
        });

        const totalTime = Date.now() - startTime;
        console.log(`[AutoList/BG] Listing ${result.listing_id} created in ${totalTime}ms, ${result.images_pending} images uploading in background`);

        return {
          queued: true,
          listingId: result.listing_id,
          isBackgroundUpload: result.isBackgroundUpload
        };

      } catch (err) {
        console.error('[AutoList/BG] Error:', err);
        onError?.(err);
        throw err;
      }
    }

    async function runAutoList({
      files,
      location,
      autoPostNearbyEnabled,
      autoInquiryEnabled,
      backgroundQueueEnabled,
      enqueueListingJob,
      reloadMineRef,
      reloadAllRef,
      reloadMine,
      reloadAll,
      onCreated,
      onError,
      onJobQueued
    } = {}) {
      try {
        // Check if native background upload is available
        const useNativeBackground = backgroundUploadService &&
          typeof backgroundUploadService.hasBackgroundUploadSupport === 'function' &&
          backgroundUploadService.hasBackgroundUploadSupport();

        if (useNativeBackground) {
          console.log('[AutoList] Using native background upload (shell + background images)');
          return await runAutoListWithBackgroundUpload({
            files,
            location,
            autoPostNearbyEnabled,
            autoInquiryEnabled,
            enqueueListingJob,
            reloadMineRef,
            reloadAllRef,
            reloadMine,
            reloadAll,
            onCreated,
            onError,
            onJobQueued
          });
        }

        console.log('[AutoList] Starting runAutoList (fast mode)');

        // Defensive: ensure files is an array
        let fileArray;
        try {
          if (files instanceof FileList) {
            fileArray = Array.from(files);
          } else if (Array.isArray(files)) {
            fileArray = files;
          } else if (files && typeof files[Symbol.iterator] === 'function') {
            fileArray = Array.from(files);
          } else {
            fileArray = files ? [files] : [];
          }
        } catch (e) {
          console.error('[AutoList] Error converting files:', e);
          fileArray = [];
        }

        const validFiles = fileArray.filter(f => f && (f instanceof Blob || f instanceof File || f.uri));
        console.log('[AutoList] Valid files:', validFiles.length);

        if (!validFiles.length) {
          throw new Error('No images provided for auto-listing.');
        }

        // Check if fast API is available
        if (typeof api.createAutoListingFast !== 'function') {
          console.error('api.createAutoListingFast not available');
          throw new Error('Fast auto-listing API not available');
        }

        // Step 1: Convert images to base64 (fast, ~100ms per image)
        // Compress images first to reduce upload size
        console.log('[AutoList] Compressing and converting', validFiles.length, 'images to base64...');
        const startTime = Date.now();

        const imagePromises = validFiles.slice(0, 12).map(async (file, i) => {
          try {
            // Compress image first
            const { blob, width, height } = await compressImage(file, 1200, 0.8);
            // Convert to base64
            const base64 = await fileToBase64(blob);
            return {
              data: base64,
              type: 'image/jpeg',
              name: file.name || `photo_${i}.jpg`,
              width,
              height
            };
          } catch (e) {
            console.warn(`[AutoList] Failed to process image ${i}:`, e);
            // Try without compression
            try {
              const base64 = await fileToBase64(file);
              return {
                data: base64,
                type: file.type || 'image/jpeg',
                name: file.name || `photo_${i}.jpg`,
                width: 0,
                height: 0
              };
            } catch (e2) {
              console.error(`[AutoList] Failed to convert image ${i}:`, e2);
              return null;
            }
          }
        });

        const imageResults = await Promise.all(imagePromises);
        const images = imageResults.filter(Boolean);
        console.log(`[AutoList] Converted ${images.length} images in ${Date.now() - startTime}ms`);

        if (!images.length) {
          throw new Error('Failed to process images');
        }

        // Step 2: Determine location and coordinates (should be cached, fast)
        const manualLocation = String(location || '').trim();
        let locAuto = manualLocation;
        let latAuto = null;
        let lonAuto = null;
        let enableNearbyAuto = false;
        let cachedCoords = null;

        async function ensureCoords() {
          if (cachedCoords) return cachedCoords;
          try {
            cachedCoords = await fetchCoordsAndReverse({ silent: true });
            return cachedCoords;
          } catch (err) {
            console.warn('[AutoList] Failed to get coords:', err);
            return null;
          }
        }

        if (autoPostNearbyEnabled) {
          try {
            const c = await ensureCoords();
            if (c && c.lat != null && c.lon != null) {
              enableNearbyAuto = true;
              latAuto = c.lat;
              lonAuto = c.lon;
              if (!locAuto) locAuto = formatLocationDisplay(c, c.display || '');
            }
          } catch (err) {
            console.warn('[AutoList] Nearby coords failed:', err);
            enableNearbyAuto = false;
          }
        }

        if (!locAuto) {
          try {
            const c = await ensureCoords();
            if (c) {
              locAuto = formatLocationDisplay(c, c?.display || '');
              if (enableNearbyAuto) {
                latAuto = c.lat;
                lonAuto = c.lon;
              }
            }
          } catch (err) {
            console.warn('[AutoList] Location lookup failed:', err);
          }
        }

        if (!locAuto) {
          locAuto = 'Unknown location';
        }

        // Step 3: Build payload with base64 images
        const payload = {
          images,
          location: locAuto,
          hint: '',
          enable_nearby: enableNearbyAuto,
          inquiry_enabled: typeof autoInquiryEnabled === 'boolean' ? autoInquiryEnabled : true
        };

        if (enableNearbyAuto && latAuto != null && lonAuto != null) {
          payload.lat = latAuto;
          payload.lon = lonAuto;
        }

        // Step 4: Send to server - this is the fire-and-forget moment
        // Once this completes, the server has everything and will create the listing
        console.log('[AutoList] Sending to server (fast mode)...');

        // Add auth token for beacon-style auth
        const token = typeof api.getAuthToken === 'function' ? api.getAuthToken() : null;
        if (token) {
          payload._authToken = token;
        }

        // Use fetch to send to server
        // Note: keepalive has a 64KB body limit, so we can't use it with base64 images
        let result = null;
        let serverError = null;
        try {
          const response = await fetch('/api/listings/auto-fast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'include'
          });
          if (response.ok) {
            result = await response.json();
          } else {
            const errText = await response.text();
            console.error('[AutoList] Server error:', response.status, errText);
            // Parse error message from server
            try {
              const errJson = JSON.parse(errText);
              serverError = errJson.error || errText;
            } catch {
              serverError = errText;
            }
            // If it's a validation/moderation error, throw immediately
            if (serverError && (serverError.includes('Invalid file') || serverError.includes('moderation') || serverError.includes('flagged'))) {
              throw new Error(serverError);
            }
          }
        } catch (fetchErr) {
          // Re-throw validation/moderation errors
          if (fetchErr?.message?.includes('Invalid file') || fetchErr?.message?.includes('moderation') || fetchErr?.message?.includes('flagged')) {
            throw fetchErr;
          }
          console.warn('[AutoList] Fetch failed:', fetchErr);
        }

        // Fallback to regular API if fetch failed
        if (!result) {
          try {
            result = await api.createAutoListingFast(payload);
          } catch (apiErr) {
            console.error('[AutoList] API call failed:', apiErr);
            throw apiErr;
          }
        }

        if (!result?.job_id) {
          console.error('[AutoList] No job_id in response:', result);
          throw new Error('Failed to enqueue auto-listing job');
        }

        const totalTime = Date.now() - startTime;
        console.log(`[AutoList] Job ${result.job_id} created in ${totalTime}ms (server: ${result.processing_time_ms}ms)`);

        // Notify caller that job was queued - caller handles hiding "Keep app open" toast
        try { onJobQueued?.(result); } catch (e) { console.warn('[AutoList] onJobQueued callback error:', e); }

        // Step 5: Poll for completion (optional, for immediate feedback)
        const mineFn = reloadMineRef?.current ?? reloadMine;
        const allFn = reloadAllRef?.current ?? reloadAll;

        if (mineFn || allFn || onCreated) {
          pollAutoListingJob({
            jobId: result.job_id,
            onCompleted: async (listing) => {
              try { await mineFn?.(); } catch { }
              try { await allFn?.({ preserveExisting: true }); } catch { }
              try { onCreated?.(listing); } catch (e) { console.warn('[AutoList] onCreated callback error:', e); }
            },
            onFailed: (error) => {
              console.error('Auto-listing job failed:', error);
              try { onError?.(new Error(error || 'Auto-listing failed')); } catch (e) { console.warn('[AutoList] onError callback error:', e); }
            }
          });
        }

        return { queued: true, jobId: result.job_id };
      } catch (err) {
        console.error('[AutoList] Error:', err);
        throw err;
      }
    }

    // Poll for auto-listing job completion
    // This runs in the background and calls callbacks when the job completes
    // Returns a stop function that can be called to cancel polling
    function pollAutoListingJob({ jobId, onCompleted, onFailed, maxAttempts = 60, intervalMs = 2000 }) {
      if (!jobId || typeof api.getAutoListingStatus !== 'function') {
        console.warn('[AutoList] Cannot poll - missing jobId or API method');
        return () => {};
      }

      let attempts = 0;
      let stopped = false;
      let timeoutId = null;

      // Return stop function
      const stop = () => {
        stopped = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const poll = async () => {
        if (stopped) return;
        attempts++;

        try {
          const status = await api.getAutoListingStatus(jobId, { silent: true });

          if (status?.status === 'completed' && status.listing) {
            stopped = true;
            try { onCompleted?.(status.listing); } catch (e) { console.warn('[AutoList] onCompleted error:', e); }
            return;
          }

          if (status?.status === 'failed') {
            stopped = true;
            try { onFailed?.(status.error || 'Job failed'); } catch (e) { console.warn('[AutoList] onFailed error:', e); }
            return;
          }

          // Still pending or processing - continue polling
          if (attempts < maxAttempts && !stopped) {
            timeoutId = setTimeout(poll, intervalMs);
          } else if (!stopped) {
            console.warn(`[AutoList] Job ${jobId} polling timed out after ${maxAttempts} attempts`);
          }
        } catch (err) {
          console.error('[AutoList] Poll error:', err);
          if (attempts < maxAttempts && !stopped) {
            timeoutId = setTimeout(poll, intervalMs * 2); // Back off on errors
          }
        }
      };

      // Start polling after a short delay (give server time to start processing)
      timeoutId = setTimeout(poll, 1500);

      return stop;
    }

    function SmartImage({
      src,
      alt = '',
      br = 8,
      onClick,
      dropFar = true,
      initialAR = 4 / 3,
      lockAR = true,
      fetchPriority = 'auto'
    }) {
      const wrapRef = useRef(null);
      const imgRef = useRef(null);

      const [activeSrc, setActiveSrc] = useState('');
      const [ratio, setRatio] = useState(initialAR);
      const [loaded, setLoaded] = useState(false);

      useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        let clearTo = null;

        const io = new IntersectionObserver((entries) => {
          const e = entries[0];
          if (!e) return;

          if (e.isIntersecting) {
            setActiveSrc(src);
          } else if (dropFar) {
            const top = e.boundingClientRect.top;
            const bottom = e.boundingClientRect.bottom;
            const dist = top > 0 ? top : -bottom;
            if (dist > window.innerHeight * 3.5) {
              clearTimeout(clearTo);
              clearTo = setTimeout(() => setActiveSrc(''), 120);
            }
          }
        }, { root: null, rootMargin: '600px 0px' });

        io.observe(el);
        return () => { clearTimeout(clearTo); io.disconnect(); };
      }, [src, dropFar]);

      useEffect(() => {
        setLoaded(false);
      }, [activeSrc]);

      function onLoad(e) {
        setLoaded(true);
        if (lockAR) return;
        const w = e.currentTarget.naturalWidth || 0;
        const h = e.currentTarget.naturalHeight || 0;
        if (w && h) setRatio(w / h);
      }

      return H('div', {
        ref: wrapRef,
        style: {
          position: 'relative',
          width: '100%',
          aspectRatio: `${ratio} / 1`,
          borderRadius: br,
          overflow: 'hidden',
          background: '#f3f4f6'
        }
      },
        !loaded && activeSrc && H('div', {
          style: {
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(120deg, #f3f4f6 15%, #e5e7eb 35%, #f3f4f6 55%)',
            backgroundSize: '200% 200%',
            animation: 'img-shimmer 1s ease-in-out infinite'
          }
        }),
        activeSrc && H('img', {
          ref: imgRef,
          src: activeSrc,
          alt,
          loading: 'lazy',
          decoding: 'async',
          fetchpriority: fetchPriority,
          onLoad,
          style: {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            cursor: onClick ? 'pointer' : 'default',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 180ms ease'
          },
          onClick
        })
      );
    }

    function ListingFormModal({ isOpen, draft, onClose, onSaved, autoListEnabled, autoPostNearbyEnabled, autoInquiryEnabled, backgroundQueueEnabled, enqueueListingJob, reloadMine, reloadAll, initialFiles = [], onModerationError }) {
      if (!isOpen) return null;

      const isMobile = isMobileDevice();
      const [showTags, setShowTags] = useState(false);

      useEffect(() => {
        if (!isOpen) return;
        setShowTags(false);
      }, [isOpen, draft?.id]);

      const heading = draft ? 'Edit Listing' : 'New Listing';

      const form = isMobile
        ? H(CompactListingForm, {
          draft,
          onCancel: onClose,
          onSaved: (createdListing) => { onSaved?.(createdListing); onClose(); },
          autoListEnabled,
          autoPostNearbyEnabled,
          autoInquiryEnabled,
          backgroundQueueEnabled,
          enqueueListingJob,
          reloadMine,
          reloadAll,
          showTags,
          setShowTags,
          initialFiles,
          onModerationError
        })
        : H(ListingForm, {
          draft,
          onCancel: onClose,
          onSaved: (createdListing) => { onSaved?.(createdListing); onClose(); },
          autoListEnabled,
          autoPostNearbyEnabled,
          autoInquiryEnabled,
          backgroundQueueEnabled,
          enqueueListingJob,
          reloadMine,
          reloadAll,
          initialFiles,
          onModerationError
        });

      return H('section', {
        className: 'listing-form-screen',
        role: 'region',
        'aria-label': heading
      },
        H('div', { className: 'listing-form-screen__body', style: { paddingTop: 16 } },
          H('div', { className: 'listing-form-screen__content' }, form)
        )
      );
    }

    function CompactListingForm({ draft, onCancel, onSaved, autoListEnabled, autoPostNearbyEnabled, autoInquiryEnabled, backgroundQueueEnabled, enqueueListingJob, reloadMine, reloadAll, showTags, setShowTags, initialFiles = [] }) {
      const fileRef = useRef();
      const [files, setFiles] = useState(() => Array.isArray(initialFiles) ? initialFiles.slice() : []);
      const [existingUrls, setExistingUrls] = useState([]);
      const [originalUrls, setOriginalUrls] = useState([]);
      const filePreviews = useFilePreviews(files);

      const [title, setTitle] = useState(draft?.title || '');
      const [description, setDescription] = useState(draft?.description || '');
      const [location, setLocation] = useState(draft?.location || '');
      const [priceVal, setPriceVal] = useState(draft?.price?.toString?.() || '');
      const [tags, setTags] = useState(() => {
        if (!draft?.tags) return '';
        if (Array.isArray(draft.tags)) return draft.tags.join(', ');
        return String(draft.tags);
      });

      const [aiBusy, setAiBusy] = useState(false);
      const [aiErr, setAiErr] = useState('');
      const autoRunning = useRef(false);
      const [autoBusy, setAutoBusy] = useState(false);
      const mountedRef = useRef(true);
      const [showModerationModal, setShowModerationModal] = useState(false);

      // Track mounted state to avoid setState on unmounted component
      useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
      }, []);

      // Use refs to ensure background jobs always have access to latest reload functions
      const reloadMineRef = useRef(reloadMine);
      const reloadAllRef = useRef(reloadAll);
      useEffect(() => { reloadMineRef.current = reloadMine; }, [reloadMine]);
      useEffect(() => { reloadAllRef.current = reloadAll; }, [reloadAll]);

      const hasFixedGps = !!draft?.lat;
      const [enableNearby, setEnableNearby] = useState(!!draft?.enable_nearby);
      const [geoBusy, setGeoBusy] = useState(false);
      const [geoErr, setGeoErr] = useState('');
      const [lat, setLat] = useState(draft?.lat ?? null);
      const [lon, setLon] = useState(draft?.lon ?? null);
      const [inquiryEnabled, setInquiryEnabled] = useState(() => {
        if (draft?.inquiry_enabled != null) return !!draft.inquiry_enabled;
        if (typeof autoInquiryEnabled === 'boolean') return autoInquiryEnabled;
        return !!autoListEnabled;
      });
      const [showInquiryHelp, setShowInquiryHelp] = useState(false);

      useEffect(() => {
        if (!Array.isArray(initialFiles)) return;
        if (initialFiles.length === 0) {
          setFiles([]);
          if (fileRef.current) fileRef.current.value = '';
          return;
        }
        setFiles(initialFiles.slice());
        if (fileRef.current) fileRef.current.value = '';
      }, [initialFiles]);

      function pickFiles(e) {
        const MAX_MB = 20;
        const selected = Array.from(e.target.files || []);
        const next = [...files];
        for (const f of selected) {
          if (f.size > MAX_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_MB}MB`); continue; }
          if (!f.type.startsWith('image/')) { alert('Only images are allowed'); continue; }
          next.push(f);
        }
        setFiles(next);
        if (fileRef.current) fileRef.current.value = '';
      }

      function removeFile(i) {
        const next = [...files];
        const [removed] = next.splice(i, 1);
        if (removed) clearDraftCacheForFile(removed);
        setFiles(next);
      }

      // Load existing images only when draft.id changes (separate effect to avoid
      // re-fetching when autoListEnabled/autoInquiryEnabled change)
      useEffect(() => {
        console.log('[CompactListingForm] Image load effect running, draft.id:', draft?.id);
        (async () => {
          if (draft?.id) {
            try {
              const arr = await api.getListingImages(draft.id);
              console.log('[CompactListingForm] Loaded images from DB:', arr);
              setExistingUrls(arr || []);
              setOriginalUrls(arr || []);
            }
            catch {
              setExistingUrls([]);
              setOriginalUrls([]);
            }
          } else {
            setExistingUrls([]);
            setOriginalUrls([]);
          }
        })();
      }, [draft?.id]);

      // Set inquiry default only for new listings
      useEffect(() => {
        if (!draft?.id) {
          if (!autoListEnabled) {
            setInquiryEnabled(false);
          } else if (typeof autoInquiryEnabled === 'boolean') {
            setInquiryEnabled(autoInquiryEnabled);
          } else {
            setInquiryEnabled(true);
          }
        }
      }, [draft?.id, autoListEnabled, autoInquiryEnabled]);

      async function runAI() {
        setAiErr('');
        setAiBusy(true);
        try {
          const sources = [];

          console.log('[runAI] Starting. files:', files.length, 'existingUrls:', existingUrls.length, existingUrls);

          // Upload new files first
          if (files.length) {
            for (const file of files) {
              if (sources.length >= AI_IMAGE_LIMIT) break;
              try {
                console.log('[runAI] Uploading file:', file?.name);
                const upload = await uploadFileDraft(file);
                console.log('[runAI] Upload result:', upload?.publicUrl);
                if (upload?.publicUrl) {
                  sources.push(upload.publicUrl);
                }
              } catch (err) {
                console.error('AI draft upload failed:', err);
              }
            }
          }

          // Only use existing URLs if we need more images
          // Note: existingUrls should be empty if user removed all existing images
          if (sources.length < AI_IMAGE_LIMIT && existingUrls.length) {
            console.log('[runAI] Adding existing URLs:', existingUrls);
            for (const url of existingUrls) {
              if (sources.length >= AI_IMAGE_LIMIT) break;
              if (typeof url === 'string' && url.trim()) {
                sources.push(url);
              }
            }
          }

          console.log('[runAI] Final sources to analyze:', sources);

          if (!sources.length) {
            alert('No images available for AI analysis.');
            return;
          }

          // Don't send existing title/description as hint - it biases AI toward old content
          // Only send hint if user explicitly typed something new (not from AI)
          const res = await api.aiAnalyze({
            images: sources.slice(0, AI_IMAGE_LIMIT),
            hint: ''
          });

          if (res.title) setTitle(res.title);
          if (Array.isArray(res.tags)) setTags(res.tags.join(', '));
          if (typeof res.suggested_price === 'number' && !Number.isNaN(res.suggested_price)) {
            setPriceVal(String(res.suggested_price));
          }
          // AI descriptions disabled
        } catch (e) {
          setAiErr(e.message || 'AI failed');
        } finally {
          setAiBusy(false);
        }
      }

      async function useMyLocation() {
        setGeoErr('');
        setGeoBusy(true);
        try {
          let coords;
          // Use Capacitor Geolocation on native, browser API on web
          if (typeof isCapacitorNative === 'function' && isCapacitorNative()) {
            const { Geolocation } = window.Capacitor.Plugins;
            const position = await Geolocation.getCurrentPosition({
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 60000
            });
            coords = { lat: position.coords.latitude, lon: position.coords.longitude };
          } else {
            if (!('geolocation' in navigator)) { setGeoErr('Geolocation not supported'); setGeoBusy(false); return; }
            coords = await new Promise((res, rej) =>
              navigator.geolocation.getCurrentPosition(
                p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
                err => rej(err),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
              )
            );
          }
          const r = await api.reverseGeocode(coords.lat, coords.lon);
          const fallback = `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`;
          setLocation(formatLocationDisplay(r, fallback));
          setLat(r?.lat ?? coords.lat);
          setLon(r?.lon ?? coords.lon);
        } catch {
          setGeoErr('Could not get your location');
        }
        finally {
          setGeoBusy(false);
        }
      }

      useEffect(() => {
        if (!autoListEnabled) return;
        if (draft) return;
        if (!files || files.length === 0) return;
        if (autoRunning.current) return;

        autoRunning.current = true;
        setAutoBusy(true);

        runAutoList({
          files,
          location,
          autoPostNearbyEnabled,
          autoInquiryEnabled: inquiryEnabled,
          backgroundQueueEnabled,
          enqueueListingJob,
          reloadMineRef,
          reloadAllRef,
          onCreated: (created) => {
            if (mountedRef.current) onSaved?.(created);
          },
          onError: (err) => {
            if (mountedRef.current) {
              const msg = err?.message || String(err);
              if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
                setShowModerationModal(true);
              }
              setAutoBusy(false);
            }
          }
        }).then((result) => {
          if (result?.queued) {
            // Job is queued on server - close the form
            // Don't update state after this since component will unmount
            onCancel?.();
          }
        }).catch((err) => {
          console.error('Auto-list failed:', err);
          if (mountedRef.current) {
            const msg = err?.message || String(err);
            if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
              setShowModerationModal(true);
            } else {
              alert(`Auto-list failed: ${msg}`);
            }
            setAutoBusy(false);
          }
        }).finally(() => {
          autoRunning.current = false;
          // Only update state if still mounted
          if (mountedRef.current) {
            setAutoBusy(false);
          }
        });
      }, [autoListEnabled, autoPostNearbyEnabled, inquiryEnabled, backgroundQueueEnabled, draft, enqueueListingJob, files, onCancel, onSaved, location]);

      async function submit(e) {
        e.preventDefault();
        try {
          const totalImages = existingUrls.length + files.length;
          if (totalImages === 0) {
            alert('Please add at least one image.');
            return;
          }

          const trimmedLocation = String(location || '').trim();
          if (!trimmedLocation) {
            alert('Location is required.');
            return;
          }

          const parsedPrice = Number(priceVal);
          const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

          const basePayload = {
            title: String(title || '').trim(),
            description: String(description || 'No description').trim(),
            location: trimmedLocation,
            price: safePrice,
            tags: String(tags || '').trim(),
            enable_nearby: enableNearby ? 1 : 0
          };

          if (draft || inquiryEnabled) {
            basePayload.inquiry_enabled = inquiryEnabled ? 1 : 0;
          }

          if (enableNearby && !hasFixedGps) {
            basePayload.lat = lat;
            basePayload.lon = lon;
          }

          if (basePayload.enable_nearby && !hasFixedGps && (basePayload.lat == null || basePayload.lon == null)) {
            // Location fetch still in progress or failed - disable nearby for this listing instead of blocking
            basePayload.enable_nearby = 0;
            basePayload.lat = null;
            basePayload.lon = null;
          }

          if (draft) {
            const payload = { ...basePayload };
            const deletedImages = originalUrls.filter(url => !existingUrls.includes(url));
            if (deletedImages.length > 0) {
              payload.deletedImages = deletedImages;
            }
            await api.updateListing(draft.id, payload);
            if (files.length) await uploadFilesForListing(draft.id, files);
            onSaved?.();
            return;
          }

          const filesSnapshot = files.slice();
          const runCreate = async () => {
            const payload = { ...basePayload };
            if (filesSnapshot.length) {
              const uploads = await Promise.all(filesSnapshot.map(uploadFileDraft));
              const tokens = uploads.map((u) => u.uploadToken).filter(Boolean);
              if (!tokens.length) {
                throw new Error('Image upload failed');
              }
              payload.upload_tokens = tokens;
            }

            const created = await api.createListing(payload);
            if (!created?.id) { throw new Error('Create failed'); }
            if (inquiryEnabled && created?.id) {
              try {
                await api.updateListing(created.id, { inquiry_enabled: 1 });
              } catch (err) {
                console.error('Failed to mark listing as inquiry-enabled:', err);
              }
            }
            return created;
          };

          if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
            enqueueListingJob(async () => {
              try {
                const created = await runCreate();
                // Refresh listings directly (like MassList does) instead of relying on callback chain
                // Use refs to get the latest function references
                try { await reloadMineRef?.current?.(); } catch { }
                try { await reloadAllRef?.current?.({ preserveExisting: true }); } catch { }
                onSaved?.(created);
              } catch (err) {
                console.error('Create/save failed:', err);
                const msg = err?.message || String(err);
                if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
                  setShowModerationModal(true);
                } else {
                  alert(`Create/save failed: ${msg}`);
                }
              }
            });
            onCancel?.();
            return;
          }

          const createdListing = await runCreate();
          onSaved?.(createdListing);
        } catch (err) {
          console.error('Create/save failed:', err);
          const msg = err?.message || String(err);
          if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
            setShowModerationModal(true);
          } else {
            alert(`Create/save failed: ${msg}`);
          }
        }
      }

      const isFree = !priceVal || !Number.isFinite(Number(priceVal)) || Number(priceVal) === 0;
      const showInquiryText = !!inquiryEnabled;
      const formattedPrice = isFree ? price(0) : price(Number(priceVal));

      const allImages = [
        ...existingUrls.map((url, i) => ({ type: 'existing', url, index: i })),
        ...filePreviews.map(({ url }, i) => ({ type: 'new', url, index: i }))
      ];

      return H('form', {
        className: 'compact-listing-form',
        onSubmit: submit,
        style: { display: 'flex', flexDirection: 'column', gap: 20 }
      },
        // Hidden file input
        H('input', {
          ref: fileRef,
          type: 'file',
          accept: 'image/*',
          multiple: true,
          onChange: pickFiles,
          style: { display: 'none' }
        }),

        // ==================== PHOTOS SECTION ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          H('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            H('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' } }, 'Photos'),
            H('span', { style: { fontSize: 13, color: '#64748b' } }, `${allImages.length} photo${allImages.length !== 1 ? 's' : ''}`)
          ),

          // Image grid - large images
          allImages.length > 0 && H('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 10
            }
          },
            ...allImages.map((img, idx) =>
              H('div', {
                key: `${img.type}-${img.index}`,
                style: {
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: '#f1f5f9'
                }
              },
                H(ImageWithSkeleton, {
                  src: img.url,
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }
                }),
                // Small X button
                H('button', {
                  type: 'button',
                  onClick: () => {
                    if (img.type === 'existing') {
                      const next = [...existingUrls];
                      next.splice(img.index, 1);
                      setExistingUrls(next);
                    } else {
                      removeFile(img.index);
                    }
                  },
                  style: {
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'rgba(239, 68, 68, 0.9)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                  }
                }, '×')
              )
            )
          ),

          // Add Photos button
          H('button', {
            type: 'button',
            onClick: () => fileRef.current?.click(),
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '16px 20px',
              border: '2px dashed #cbd5e1',
              borderRadius: 12,
              background: '#f8fafc',
              color: '#475569',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }
          },
            H('svg', {
              width: 22,
              height: 22,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
              H('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
              H('polyline', { points: '21 15 16 10 5 21' })
            ),
            allImages.length > 0 ? 'Add More Photos' : 'Add Photos'
          )
        ),

        // ==================== AI ANALYSIS ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          H('button', {
            type: 'button',
            className: 'btn',
            disabled: aiBusy,
            onClick: runAI,
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px 20px',
              background: aiBusy ? '#e2e8f0' : 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
              color: aiBusy ? '#64748b' : '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              cursor: aiBusy ? 'not-allowed' : 'pointer'
            }
          },
            H('svg', {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' })
            ),
            aiBusy ? 'Analyzing...' : 'Auto-fill with AI'
          ),
          aiErr && H('p', { style: { margin: 0, color: '#dc2626', fontSize: 13 } }, aiErr)
        ),

        // ==================== DETAILS SECTION ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          H('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' } }, 'Details'),

          // Title
          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'Title'),
            H('input', {
              value: title,
              maxLength: 80,
              onChange: e => setTitle(e.target.value),
              placeholder: 'What are you selling?',
              style: { ...TOUCH_CONTROL_STYLE, borderRadius: 10 }
            })
          ),

          // Description
          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'Description'),
            H('textarea', {
              value: description,
              maxLength: 400,
              rows: 4,
              onChange: e => setDescription(e.target.value),
              placeholder: 'Describe your item, condition, features...',
              style: { ...TOUCH_CONTROL_STYLE, lineHeight: '1.5', resize: 'none', borderRadius: 10 }
            })
          ),

          // Price
          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'Price'),
            H('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
              H('div', { style: { position: 'relative', flex: 1 } },
                H('span', { style: { position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 16, fontWeight: 500 } }, '$'),
                H('input', {
                  value: priceVal,
                  inputMode: 'decimal',
                  onChange: e => setPriceVal(e.target.value.replace(/[^0-9.]/g, '')),
                  placeholder: '0.00',
                  style: { ...TOUCH_CONTROL_STYLE, paddingLeft: 28, borderRadius: 10, width: '100%' }
                })
              ),
              showInquiryText && H('span', {
                style: {
                  fontSize: 12,
                  padding: '6px 10px',
                  background: '#fef3c7',
                  color: '#92400e',
                  borderRadius: 6,
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }
              }, 'Wants offers')
            )
          ),

          // Inquiry toggle
          H('label', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: '#f8fafc',
              borderRadius: 10,
              cursor: 'pointer'
            }
          },
            H('input', {
              type: 'checkbox',
              checked: inquiryEnabled,
              onChange: e => setInquiryEnabled(e.target.checked),
              style: { width: 20, height: 20, accentColor: '#2563eb' }
            }),
            H('div', { style: { flex: 1 } },
              H('div', { style: { fontSize: 14, fontWeight: 600, color: '#0f172a' } }, 'Display offer banner'),
              H('div', { style: { fontSize: 12, color: '#64748b' } }, 'Buyers will be more likely to make a lower offer')
            ),
            H('button', {
              type: 'button',
              onClick: (e) => { e.preventDefault(); e.stopPropagation(); setShowInquiryHelp(true); },
              style: {
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '1px solid #e5e7eb',
                background: '#fff',
                fontSize: 13,
                fontWeight: 600,
                color: '#64748b',
                cursor: 'pointer'
              }
            }, '?')
          )
        ),

        // ==================== LOCATION SECTION ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          H('h2', { style: { fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' } }, 'Location'),

          H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('label', { style: { fontSize: 14, fontWeight: 600, color: '#374151' } }, 'City or area'),
            H('input', {
              value: location,
              maxLength: 80,
              onChange: e => setLocation(e.target.value),
              placeholder: 'e.g. Brooklyn, NY',
              style: { ...TOUCH_CONTROL_STYLE, borderRadius: 10 }
            })
          ),

          H('button', {
            type: 'button',
            onClick: useMyLocation,
            disabled: geoBusy,
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 16px',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              background: '#fff',
              color: '#374151',
              fontSize: 14,
              fontWeight: 500,
              cursor: geoBusy ? 'not-allowed' : 'pointer'
            }
          },
            H('svg', {
              width: 18,
              height: 18,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('polygon', { points: '3 11 22 2 13 21 11 13 3 11' })
            ),
            geoBusy ? 'Getting location...' : 'Use my current location'
          ),
          geoErr && H('p', { style: { margin: 0, color: '#dc2626', fontSize: 13 } }, geoErr),

          // Nearby toggle
          H('label', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: '#f8fafc',
              borderRadius: 10,
              cursor: 'pointer'
            }
          },
            H('input', {
              type: 'checkbox',
              checked: enableNearby,
              onChange: e => {
                const checked = e.target.checked;
                setEnableNearby(checked);
                if (checked && !hasFixedGps) useMyLocation();
              },
              style: { width: 20, height: 20, accentColor: '#2563eb' }
            }),
            H('div', { style: { flex: 1 } },
              H('div', { style: { fontSize: 14, fontWeight: 600, color: '#0f172a' } }, 'Show in Nearest searches'),
              H('div', { style: { fontSize: 12, color: '#64748b' } }, 'Buyers can see the items distance from them')
            )
          )
        ),

        // ==================== TAGS SECTION (COLLAPSIBLE) ====================
        H('section', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          H('button', {
            type: 'button',
            onClick: () => setShowTags(!showTags),
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              background: '#f8fafc',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              color: '#374151',
              cursor: 'pointer'
            }
          },
            H('span', null, 'Search tags (optional)'),
            H('span', { style: { color: '#64748b' } }, showTags ? '▲' : '▼')
          ),
          showTags && H('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            H('input', {
              placeholder: 'e.g. vintage, electronics, furniture',
              value: tags,
              onChange: e => setTags(e.target.value),
              style: { ...TOUCH_CONTROL_STYLE, borderRadius: 10 }
            }),
            H('p', { style: { margin: 0, fontSize: 12, color: '#64748b' } }, 'Separate tags with commas. Helps buyers find your listing.')
          )
        ),

        // ==================== ACTION BUTTONS ====================
        H('section', { style: { display: 'flex', gap: 12, paddingTop: 8 } },
          H('button', {
            className: 'btn',
            type: 'button',
            onClick: onCancel,
            disabled: autoBusy,
            style: {
              flex: 1,
              padding: '14px 20px',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              background: '#fff',
              color: '#374151',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer'
            }
          }, 'Cancel'),
          H('button', {
            type: 'submit',
            disabled: autoBusy,
            style: {
              flex: 1,
              padding: '14px 20px',
              border: 'none',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              cursor: autoBusy ? 'not-allowed' : 'pointer',
              opacity: autoBusy ? 0.6 : 1
            }
          }, draft ? 'Save Changes' : 'Create Listing')
        ),
        showInquiryHelp && H('div', {
          style: {
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,24,39,0.65)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 120
          },
          onClick: (e) => { if (e.target === e.currentTarget) setShowInquiryHelp(false); }
        },
          H('div', {
            style: {
              background: '#fff',
              borderRadius: 12,
              padding: 16,
              width: 'min(320px, 90vw)',
              boxShadow: '0 18px 40px rgba(15, 23, 42, 0.18)'
            }
          },
            H('div', { style: { fontWeight: 700, fontSize: 16, marginBottom: 8 } }, 'Offer Banner'),
            H('p', { style: { margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 } },
              'Enable offer banner if you want an item gone ASAP.'
            ),
            H('button', {
              type: 'button',
              className: 'btn primary',
              style: { width: '100%' },
              onClick: () => setShowInquiryHelp(false)
            }, 'Got it')
          )
        ),

        // Moderation flagged modal
        showModerationModal && H('div', {
          className: 'modal-backdrop',
          style: {
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,24,39,0.7)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 130
          },
          onClick: (e) => { if (e.target === e.currentTarget) setShowModerationModal(false); }
        },
          H('div', {
            style: {
              background: '#fff',
              borderRadius: 16,
              padding: 24,
              width: 'min(360px, 90vw)',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
              textAlign: 'center'
            }
          },
            H('div', {
              style: {
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#fef3c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px'
              }
            },
              H('svg', {
                width: 28,
                height: 28,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: '#d97706',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              },
                H('circle', { cx: 12, cy: 12, r: 10 }),
                H('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
                H('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 })
              )
            ),
            H('h3', { style: { margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: '#0f172a' } }, 'Content Under Review'),
            H('p', { style: { margin: '0 0 20px', fontSize: 14, lineHeight: 1.6, color: '#64748b' } },
              'Your submission has been flagged and is being reviewed by our administrators. This helps us keep the platform safe for everyone.'
            ),
            H('button', {
              type: 'button',
              className: 'btn primary',
              style: { width: '100%', padding: '14px 20px', fontSize: 16 },
              onClick: () => {
                setShowModerationModal(false);
                onCancel?.();
              }
            }, 'I Understand')
          )
        )
      );
    }

    /**
     * Desktop-only modal for creating a new listing.
     * Shows just an image picker - once images are selected, runs auto-list flow,
     * then redirects to edit page when listing is created.
     */
    function DesktopNewListingModal({
      isOpen,
      onClose,
      onListingCreated,
      autoPostNearbyEnabled,
      autoInquiryEnabled,
      backgroundQueueEnabled,
      enqueueListingJob,
      reloadMine,
      reloadAll,
      onModerationError
    }) {
      const fileRef = useRef(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [status, setStatus] = useState('');
      const mountedRef = useRef(true);
      const reloadMineRef = useRef(reloadMine);
      const reloadAllRef = useRef(reloadAll);

      useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
      }, []);

      useEffect(() => { reloadMineRef.current = reloadMine; }, [reloadMine]);
      useEffect(() => { reloadAllRef.current = reloadAll; }, [reloadAll]);

      // Reset state when modal opens
      useEffect(() => {
        if (isOpen) {
          setBusy(false);
          setError('');
          setStatus('');
        }
      }, [isOpen]);

      const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose?.();
        }
      };

      const handleFileSelect = async (e) => {
        const selectedFiles = e.target.files;
        if (!selectedFiles || selectedFiles.length === 0) return;

        setBusy(true);
        setError('');
        setStatus('Processing images...');

        try {
          await runAutoList({
            files: selectedFiles,
            location: '',
            autoPostNearbyEnabled,
            autoInquiryEnabled,
            backgroundQueueEnabled,
            enqueueListingJob,
            reloadMineRef,
            reloadAllRef,
            onCreated: (created) => {
              if (mountedRef.current) {
                setBusy(false);
                setStatus('');
                onListingCreated?.(created);
              }
            },
            onError: (err) => {
              if (mountedRef.current) {
                const msg = err?.message || String(err);
                if (msg.includes('moderation_flagged') || msg.includes('flagged') || msg.includes('Invalid file')) {
                  onModerationError?.();
                  onClose?.();
                } else {
                  setError(msg || 'Failed to create listing');
                }
                setBusy(false);
                setStatus('');
              }
            },
            onJobQueued: () => {
              if (mountedRef.current) {
                setStatus('Creating listing...');
              }
            }
          });
        } catch (err) {
          if (mountedRef.current) {
            setError(err?.message || 'Failed to create listing');
            setBusy(false);
            setStatus('');
          }
        }

        // Reset file input
        if (fileRef.current) fileRef.current.value = '';
      };

      const handleChooseFiles = () => {
        if (busy) return;
        fileRef.current?.click();
      };

      if (!isOpen) return null;

      return H('div', {
        className: 'modal-backdrop',
        style: {
          position: 'fixed',
          inset: 0,
          background: 'rgba(17, 24, 39, 0.7)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 130
        },
        onClick: handleOverlayClick
      },
        H('div', {
          style: {
            background: '#fff',
            borderRadius: 16,
            padding: 32,
            width: 'min(440px, 90vw)',
            boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
            textAlign: 'center'
          }
        },
          // Close button
          !busy && H('button', {
            type: 'button',
            onClick: onClose,
            style: {
              position: 'absolute',
              top: 16,
              right: 16,
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#64748b',
              lineHeight: 1
            }
          }, '\u00D7'),

          // Icon
          H('div', {
            style: {
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px'
            }
          },
            H('svg', {
              width: 32,
              height: 32,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: '#fff',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
              H('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
              H('polyline', { points: '21 15 16 10 5 21' })
            )
          ),

          // Title
          H('h2', {
            style: {
              margin: '0 0 8px',
              fontSize: 22,
              fontWeight: 700,
              color: '#0f172a'
            }
          }, 'New Listing'),

          // Subtitle
          H('p', {
            style: {
              margin: '0 0 24px',
              fontSize: 14,
              color: '#64748b',
              lineHeight: 1.5
            }
          }, 'Select photos and AI will generate your listing automatically. You can edit details after.'),

          // Error message
          error && H('div', {
            style: {
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              color: '#dc2626',
              fontSize: 14
            }
          }, error),

          // Status message
          busy && status && H('div', {
            style: {
              marginBottom: 16,
              color: '#6366f1',
              fontSize: 14,
              fontWeight: 500
            }
          }, status),

          // Hidden file input
          H('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/*',
            multiple: true,
            style: { display: 'none' },
            onChange: handleFileSelect
          }),

          // Main action button
          H('button', {
            type: 'button',
            className: 'btn primary',
            onClick: handleChooseFiles,
            disabled: busy,
            style: {
              width: '100%',
              padding: '14px 24px',
              fontSize: 16,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10
            }
          },
            busy
              ? H('span', {
                style: {
                  display: 'inline-block',
                  width: 18,
                  height: 18,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }
              })
              : H('svg', {
                width: 20,
                height: 20,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              },
                H('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
                H('polyline', { points: '17 8 12 3 7 8' }),
                H('line', { x1: 12, y1: 3, x2: 12, y2: 15 })
              ),
            busy ? 'Creating...' : 'Choose Photos'
          ),

          // Cancel link
          !busy && H('button', {
            type: 'button',
            onClick: onClose,
            style: {
              background: 'none',
              border: 'none',
              marginTop: 16,
              color: '#64748b',
              fontSize: 14,
              cursor: 'pointer'
            }
          }, 'Cancel')
        )
      );
    }

    return {
      SmartImage,
      ListingFormModal,
      CompactListingForm,
      DesktopNewListingModal,
      runAutoList,
      pollAutoListingJob
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.listingForms = {
    createListingFormsFeature
  };
})();

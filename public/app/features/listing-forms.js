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
      AI_IMAGE_LIMIT
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

    function ListingFormModal({ isOpen, draft, onClose, onSaved, autoListEnabled, aiDescriptionEnabled, autoPostNearbyEnabled, autoInquiryEnabled, backgroundQueueEnabled, enqueueListingJob, initialFiles = [] }) {
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
          onSaved: () => { onSaved?.(); onClose(); },
          autoListEnabled,
          aiDescriptionEnabled,
          autoPostNearbyEnabled,
          autoInquiryEnabled,
          backgroundQueueEnabled,
          enqueueListingJob,
          showTags,
          setShowTags,
          initialFiles
        })
        : H(ListingForm, {
          draft,
          onCancel: onClose,
          onSaved: () => { onSaved?.(); onClose(); },
          autoListEnabled,
          aiDescriptionEnabled,
          autoPostNearbyEnabled,
          autoInquiryEnabled,
          backgroundQueueEnabled,
          enqueueListingJob,
          initialFiles
        });

      return H('section', {
        className: 'listing-form-screen',
        role: 'region',
        'aria-label': heading
      },
        H('header', {
          className: 'listing-form-screen__header'
        },
          H('button', {
            type: 'button',
            className: 'btn listing-form-screen__dismiss',
            onClick: onClose
          }, 'Cancel'),
          H('h1', { className: 'listing-form-screen__title' }, heading),
          H('div', { className: 'listing-form-screen__spacer', 'aria-hidden': 'true' })
        ),
        H('div', { className: 'listing-form-screen__body' },
          H('div', { className: 'listing-form-screen__content' }, form)
        )
      );
    }

    function CompactListingForm({ draft, onCancel, onSaved, autoListEnabled, aiDescriptionEnabled, autoPostNearbyEnabled, autoInquiryEnabled, backgroundQueueEnabled, enqueueListingJob, showTags, setShowTags, initialFiles = [] }) {
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

      useEffect(() => {
        (async () => {
          if (draft?.id) {
            try {
              const arr = await api.getListingImages(draft.id);
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

          if (files.length) {
            for (const file of files) {
              if (sources.length >= AI_IMAGE_LIMIT) break;
              try {
                const upload = await uploadFileDraft(file);
                if (upload?.publicUrl) sources.push(upload.publicUrl);
              } catch (err) {
                console.error('AI draft upload failed:', err);
              }
            }
          }

          if (sources.length < AI_IMAGE_LIMIT && existingUrls.length) {
            for (const url of existingUrls) {
              if (sources.length >= AI_IMAGE_LIMIT) break;
              if (typeof url === 'string' && url.trim()) {
                sources.push(url);
              }
            }
          }

          if (!sources.length) {
            alert('No images available for AI analysis.');
            return;
          }

          const res = await api.aiAnalyze({
            images: sources.slice(0, AI_IMAGE_LIMIT),
            hint: `${title} ${description}`.trim()
          });

          if (res.title) setTitle(res.title);
          if (Array.isArray(res.tags)) setTags(res.tags.join(', '));
          if (typeof res.suggested_price === 'number' && !Number.isNaN(res.suggested_price)) {
            setPriceVal(String(res.suggested_price));
          }
          if (typeof res.description === 'string' && res.description.trim()) {
            if (aiDescriptionEnabled) {
              setDescription(res.description.trim().slice(0, 400));
            } else {
              setAiErr('Enable AI descriptions in your profile to apply AI-written descriptions.');
            }
          }
        } catch (e) {
          setAiErr(e.message || 'AI failed');
        } finally {
          setAiBusy(false);
        }
      }

      async function useMyLocation() {
        setGeoErr('');
        if (!('geolocation' in navigator)) { setGeoErr('Geolocation not supported'); return; }
        setGeoBusy(true);
        try {
          const coords = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(
              p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
              err => rej(err),
              { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
            )
          );
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

        const runAutoListJob = async () => {
          const uploads = await Promise.all(files.map(uploadFileDraft));
          if (!uploads.length) throw new Error('No images to upload');

          let ai = {};
          let aiDescription = '';
          try {
            const aiSources = uploads.map((u) => u.publicUrl).filter(Boolean).slice(0, AI_IMAGE_LIMIT);
            if (aiSources.length) {
              ai = await api.aiAnalyze({ images: aiSources, hint: '' }, { silent: true }) || {};
            }
          } catch (_) {}

          const parsedPrice = Number(ai.suggested_price);
          const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

          const rawDescription = (typeof ai.description === 'string' ? ai.description.trim() : '');
          if (rawDescription && aiDescriptionEnabled) {
            aiDescription = rawDescription.slice(0, 400);
          }

          const manualLocation = String(location || '').trim();
          let locAuto = manualLocation;
          let latAuto = null;
          let lonAuto = null;
          let enableNearbyAuto = 0;
          let cachedCoords = null;

          async function ensureCoords() {
            if (cachedCoords) return cachedCoords;
            cachedCoords = await fetchCoordsAndReverse();
            return cachedCoords;
          }

          if (autoPostNearbyEnabled) {
            try {
              const c = await ensureCoords();
              enableNearbyAuto = 1;
              latAuto = c.lat; lonAuto = c.lon;
              if (!locAuto) locAuto = formatLocationDisplay(c, c.display || '');
            } catch (_) {
              enableNearbyAuto = 0;
            }
          }

          if (!locAuto) {
            try {
              const c = await ensureCoords();
              locAuto = formatLocationDisplay(c, c?.display || '');
              if (enableNearbyAuto && c) {
                latAuto = c.lat;
                lonAuto = c.lon;
              }
            } catch (_) {}
          }

          if (!locAuto) {
            locAuto = 'Unknown location';
          }

          const payload = {
            title: (ai.title || 'Item for sale').toString().slice(0, 80),
            description: aiDescription || 'No description',
            location: locAuto || '',
            price: safePrice,
            tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
            enable_nearby: enableNearbyAuto,
            upload_tokens: uploads.map((u) => u.uploadToken)
          };
          if (enableNearbyAuto) { payload.lat = latAuto; payload.lon = lonAuto; }

          const created = await api.createListing(payload);
          if (!created?.id) throw new Error('Create failed');
          if (inquiryEnabled && created?.id) {
            try {
              await api.updateListing(created.id, { inquiry_enabled: 1 });
            } catch (err) {
              console.error('Failed to mark auto-listed item as inquiry-enabled:', err);
            }
          }
        };

        if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
          enqueueListingJob(async () => {
            try {
              await runAutoListJob();
              onSaved?.();
            } catch (err) {
              console.error('Auto-list failed:', err);
              alert(`Auto-list failed: ${err?.message || err}`);
            } finally {
              autoRunning.current = false;
            }
          });
          onCancel?.();
          return;
        }

        setAutoBusy(true);
        (async () => {
          try {
            await runAutoListJob();
            onSaved?.();
          } catch (err) {
            console.error('Auto-list failed:', err);
            alert(`Auto-list failed: ${err?.message || err}`);
          } finally {
            setAutoBusy(false);
            autoRunning.current = false;
          }
        })();
      }, [autoListEnabled, autoPostNearbyEnabled, aiDescriptionEnabled, inquiryEnabled, backgroundQueueEnabled, draft, enqueueListingJob, files, onCancel, onSaved]);

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
            alert('Enable Nearby requires using your location.');
            return;
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
          };

          if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
            enqueueListingJob(async () => {
              try {
                await runCreate();
                onSaved?.();
              } catch (err) {
                console.error('Create/save failed:', err);
                alert(`Create/save failed: ${err?.message || err}`);
              }
            });
            onCancel?.();
            return;
          }

          await runCreate();
          onSaved?.();
        } catch (err) {
          console.error('Create/save failed:', err);
          alert(`Create/save failed: ${err?.message || err}`);
        }
      }

      const isFree = !priceVal || !Number.isFinite(Number(priceVal)) || Number(priceVal) === 0;
      const showInquiryText = !!inquiryEnabled;
      const formattedPrice = isFree ? price(0) : price(Number(priceVal));

      return H('form', {
        className: 'compact-listing-form',
        onSubmit: submit
      },
        H('div', { className: 'row', style: { gap: 6, alignItems: 'center' } },
          H('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/*',
            multiple: true,
            onChange: pickFiles,
            style: { ...TOUCH_CONTROL_STYLE, flex: 1 }
          }),
          H('button', {
            className: 'btn',
            type: 'button',
            onClick: () => fileRef.current?.click(),
            style: TOUCH_BUTTON_STYLE
          }, 'Pick images')
        ),

        filePreviews.length > 0 && H('div', {
          className: 'row',
          style: { gap: 3, flexWrap: 'wrap', marginTop: 3 }
        },
          ...filePreviews.map(({ url }, i) =>
            H('div', { key: i, style: { position: 'relative' } },
              H(ImageWithSkeleton, {
                src: url,
                style: { width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' }
              }),
              H('button', {
                className: 'btn danger',
                type: 'button',
                style: { position: 'absolute', top: -2, right: -2, padding: '0px 3px', fontSize: 9, lineHeight: '12px' },
                onClick: () => removeFile(i)
              }, 'x')
            )
          )
        ),

        (existingUrls.length > 0) && H('div', null,
          H('div', { className: 'muted', style: { fontSize: 11, marginBottom: 2 } }, 'Current:'),
          H('div', { className: 'row', style: { gap: 3, flexWrap: 'wrap' } },
            ...existingUrls.map((src, i) =>
              H('div', { key: i, style: { position: 'relative' } },
                H(ImageWithSkeleton, { src, style: { width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' } }),
                H('button', {
                  className: 'btn danger',
                  type: 'button',
                  style: { position: 'absolute', top: -2, right: -2, padding: '0px 3px', fontSize: 9, lineHeight: '12px' },
                  onClick: () => {
                    const next = [...existingUrls];
                    next.splice(i, 1);
                    setExistingUrls(next);
                  }
                }, 'x')
              )
            )
          )
        ),

        H('button', {
          type: 'button',
          className: `btn ${aiBusy ? '' : 'primary'}`,
          disabled: aiBusy,
          onClick: runAI,
          style: { ...TOUCH_BUTTON_STYLE, width: '100%' }
        }, aiBusy ? 'Analyzing...' : 'Run AI analysis'),

        aiErr && H('span', { className: 'muted', style: { color: '#b91c1c', fontSize: 11 } }, aiErr),

        H('input', {
          value: title,
          maxLength: 80,
          onChange: e => setTitle(e.target.value),
          placeholder: 'Title (optional)',
          style: TOUCH_CONTROL_STYLE
        }),

        H('textarea', {
          value: description,
          maxLength: 400,
          rows: 2,
          onChange: e => setDescription(e.target.value),
          placeholder: 'Description (optional)',
          style: { ...TOUCH_CONTROL_STYLE, lineHeight: '1.5', resize: 'none' }
        }),

        H('input', {
          value: location,
          maxLength: 80,
          onChange: e => setLocation(e.target.value),
          placeholder: 'Location (required)',
          style: TOUCH_CONTROL_STYLE
        }),

        H('button', {
          type: 'button',
          className: 'btn',
          onClick: useMyLocation,
          disabled: geoBusy,
          style: { ...TOUCH_BUTTON_STYLE, width: '100%' }
        },
          geoBusy ? 'Locating...' : 'Use my location'
        ),
        geoErr && H('span', { className: 'muted', style: { color: '#b91c1c', fontSize: 11 } }, geoErr),

        H('label', {
          className: 'toggle-card',
          style: { marginTop: 4, gap: 6, alignItems: 'flex-start', fontSize: 12, padding: '6px 8px' }
        },
          H('input', {
            type: 'checkbox',
            className: 'toggle-input',
            checked: enableNearby,
            onChange: e => {
              const checked = e.target.checked;
              setEnableNearby(checked);
              if (checked && !hasFixedGps) useMyLocation();
            }
          }),
          H('span', { className: 'toggle-slider', 'aria-hidden': true }),
          H('div', { className: 'toggle-copy' },
            H('div', { style: { fontWeight: 700, fontSize: 12 } }, 'Enable Nearby searches'),
            H('div', { className: 'muted', style: { fontSize: 11 } }, 'Shows distance in feet/miles to buyers.')
          )
        ),

        H('div', { className: 'row', style: { alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          H('div', { className: 'row', style: { alignItems: 'center', gap: 6, flex: 1 } },
            H('input', {
              value: priceVal,
              inputMode: 'decimal',
              onChange: e => setPriceVal(e.target.value.replace(/[^0-9.]/g, '')),
              placeholder: 'Price (empty = $0.00)',
              style: { ...TOUCH_CONTROL_STYLE, flex: 1 }
            }),
            showInquiryText
              ? H('span', { className: 'inquiry-badge', style: { fontSize: 11, padding: '3px 8px' } }, 'Seller wants an offer')
              : H('span', { style: { fontSize: 11, color: isFree ? '#16a34a' : '#6b7280', fontWeight: 700 } }, formattedPrice)
          ),
          H('div', { className: 'row', style: { alignItems: 'center', gap: 4 } },
            H('label', { className: 'toggle-card', style: { padding: '4px 8px', fontSize: 11 } },
              H('input', {
                type: 'checkbox',
                className: 'toggle-input',
                checked: showInquiryText,
                onChange: e => setInquiryEnabled(e.target.checked)
              }),
              H('span', { className: 'toggle-slider', 'aria-hidden': true }),
              H('div', { className: 'toggle-copy' },
                H('div', { style: { fontWeight: 600, fontSize: 11 } }, 'Offer Message'),
                H('div', { className: 'muted', style: { fontSize: 10 } }, 'show offer msg')
              )
            ),
            H('button', {
              type: 'button',
              onClick: (e) => { e.preventDefault(); e.stopPropagation(); setShowInquiryHelp(true); },
              title: 'Inquiry mode info',
              style: {
                width: 22,
                height: 22,
                lineHeight: '20px',
                borderRadius: 11,
                border: '1px solid #e5e7eb',
                background: '#fff',
                fontSize: 12,
                cursor: 'pointer'
              }
            }, '?')
          )
        ),

        H('button', {
          type: 'button',
          onClick: () => setShowTags(!showTags),
          style: {
            width: '100%',
            padding: '6px',
            background: '#f9f9f9',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            textAlign: 'left',
            fontSize: 11,
            color: '#6b7280'
          }
        }, showTags ? 'v Hide search tags' : '> Show search tags (optional)'),

        showTags && H('input', {
          placeholder: 'e.g. car, suv, 4x4',
          value: tags,
          onChange: e => setTags(e.target.value),
          style: TOUCH_CONTROL_STYLE
        }),

        H('div', { className: 'row', style: { gap: 6, marginTop: 6 } },
          H('button', {
            className: 'btn primary',
            type: 'submit',
            disabled: autoBusy,
            style: { ...TOUCH_BUTTON_STYLE, flex: 1, fontWeight: 600 }
          },
            draft ? 'Save' : 'Create'
          ),
          H('button', {
            className: 'btn',
            type: 'button',
            onClick: onCancel,
            disabled: autoBusy,
            style: { ...TOUCH_BUTTON_STYLE, flex: 1 }
          },
            'Cancel'
          )
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
            H('div', { style: { fontWeight: 700, fontSize: 16, marginBottom: 8 } }, 'Inquiry mode'),
            H('p', { style: { margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 } },
              'When inquiry is enabled it will replace the price field with a message inviting buyers to make an offer.'
            ),
            H('button', {
              type: 'button',
              className: 'btn primary',
              style: { width: '100%' },
              onClick: () => setShowInquiryHelp(false)
            }, 'Got it')
          )
        )
      );
    }

    return {
      SmartImage,
      ListingFormModal,
      CompactListingForm
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.listingForms = {
    createListingFormsFeature
  };
})();

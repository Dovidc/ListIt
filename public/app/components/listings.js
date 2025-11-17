(() => {
  function createListingComponents({
    React,
    ReactDOM,
    api,
    uploads = {},
    helpers = {},
    components = {},
    formatting = {}
  } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Listing components require React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Listing components require ReactDOM.');
    }
    if (!api) {
      throw new Error('Listing components require an API client.');
    }

    const {
      clearDraftCacheForFile,
      uploadFileDraft,
      uploadFilesForListing,
      useFilePreviews,
      AI_IMAGE_LIMIT,
      collectListingImages,
      dedupeImageUrls,
      fetchListingImagesCached,
      listingImageCache,
      listingImageInFlight
    } = uploads;

    if (typeof clearDraftCacheForFile !== 'function') {
      throw new Error('Listing components require clearDraftCacheForFile.');
    }
    if (typeof uploadFileDraft !== 'function') {
      throw new Error('Listing components require uploadFileDraft.');
    }
    if (typeof uploadFilesForListing !== 'function') {
      throw new Error('Listing components require uploadFilesForListing.');
    }
    if (typeof useFilePreviews !== 'function') {
      throw new Error('Listing components require useFilePreviews.');
    }
    if (typeof collectListingImages !== 'function') {
      throw new Error('Listing components require collectListingImages helper.');
    }
    if (typeof dedupeImageUrls !== 'function') {
      throw new Error('Listing components require dedupeImageUrls helper.');
    }
    if (typeof fetchListingImagesCached !== 'function') {
      throw new Error('Listing components require fetchListingImagesCached helper.');
    }
    if (!listingImageCache) {
      throw new Error('Listing components require listingImageCache.');
    }
    if (!listingImageInFlight) {
      throw new Error('Listing components require listingImageInFlight.');
    }

    const {
      isMobileDevice,
      createConcurrencyLimiter,
      fetchCoordsAndReverse,
      getUserCoordsOnce,
      useBodyScrollLock,
      haversineMeters,
      asArray,
      selectPrimaryListingImage
    } = helpers;

    if (typeof isMobileDevice !== 'function') {
      throw new Error('Listing components require isMobileDevice helper.');
    }
    if (typeof createConcurrencyLimiter !== 'function') {
      throw new Error('Listing components require createConcurrencyLimiter helper.');
    }
    if (typeof getUserCoordsOnce !== 'function') {
      throw new Error('Listing components require getUserCoordsOnce helper.');
    }
    if (typeof useBodyScrollLock !== 'function') {
      throw new Error('Listing components require useBodyScrollLock helper.');
    }
    if (typeof haversineMeters !== 'function') {
      throw new Error('Listing components require haversineMeters helper.');
    }
    if (typeof asArray !== 'function') {
      throw new Error('Listing components require asArray helper.');
    }
    if (typeof selectPrimaryListingImage !== 'function') {
      throw new Error('Listing components require selectPrimaryListingImage helper.');
    }

    const { ImageWithSkeleton, ResponsiveImage, ListingsGrid, SupporterBadge } = components;
    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Listing components require ImageWithSkeleton component.');
    }
    if (typeof ResponsiveImage !== 'function') {
      throw new Error('Listing components require ResponsiveImage component.');
    }
    if (typeof SupporterBadge !== 'function') {
      throw new Error('Listing components require SupporterBadge component.');
    }
    // ListingsGrid is optional - will fall back to custom rendering if not available

    const price = formatting?.price;
    if (typeof price !== 'function') {
      throw new Error('Listing components require price formatter.');
    }
    const fmtDistance = formatting?.fmtDistance;
    if (typeof fmtDistance !== 'function') {
      throw new Error('Listing components require distance formatter.');
    }

    const {
      useState,
      useEffect,
      useRef,
      useMemo,
      useCallback
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function formatLocationDisplay(result, fallback = '') {
      const safeFallback = typeof fallback === 'string' ? fallback : '';
      if (!result || typeof result !== 'object') return safeFallback;
      const city = typeof result.city === 'string' ? result.city.trim() : '';
      const state = typeof result.state === 'string' ? result.state.trim() : '';
      const country = typeof result.country === 'string' ? result.country.trim() : '';
      const primary = city;
      const secondary = state || country;
      const joined = [primary, secondary].filter(Boolean).join(', ');
      if (joined) return joined;
      const display = typeof result.display === 'string' ? result.display.trim() : '';
      return display || safeFallback;
    }

    async function fetchCoordsAndReverseInternal() {
      if (typeof fetchCoordsAndReverse === 'function') {
        return fetchCoordsAndReverse();
      }

      if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
      const { coords } = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
      );
      const r = await api.reverseGeocode(coords.latitude, coords.longitude);
      const fallback = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
      return {
        lat: r?.lat ?? coords.latitude,
        lon: r?.lon ?? coords.longitude,
        display: formatLocationDisplay(r, fallback)
      };
    }

    // --- MultiFilePicker (for S3 uploads) ---
    function MultiFilePicker({ files, onChange }) {
      const ref = useRef();
      const MAX_MB = 20;
      const previews = useFilePreviews(files);

      function pick(e) {
        const selected = Array.from(e.target.files || []);
        const next = [...files];
        for (const f of selected) {
          if (f.size > MAX_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_MB}MB`); continue; }
          if (!f.type.startsWith('image/')) { alert('Only images are allowed'); continue; }
          next.push(f);
        }
        onChange(next);
        if (ref.current) ref.current.value = '';
      }
      function removeAt(i) {
        const next = [...files];
        const [removed] = next.splice(i,1);
        if (removed) clearDraftCacheForFile(removed);
        onChange(next);
      }

      return H('div', null,
        H('div', { className:'row' },
        H('input', { type:'file', accept:'image/*', multiple:true, ref, onChange: pick }),
        H('span', { className:'muted' }, `${(files||[]).length} file(s)`)
      ),
      H('div', { className:'row', style:{ flexWrap:'wrap', gap:8, marginTop:8 } },
        ...previews.map(({ url }, i)=> H('div', { key:i, style:{ position:'relative' } },
          H(ImageWithSkeleton, {
            src: url,
            style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #ddd' }
          }),
          H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, onClick:()=>removeAt(i) }, 'x')
        ))
      )
      );
    }

    // --- Shared help modal shell (high-contrast layout) ---
    function InfoHelpModal({ title, intro, bullets, footer, onClose }) {
      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: (e) => { if (e.target.classList.contains('modal')) onClose?.(); },
          style: { background: 'rgba(0,0,0,0.5)' }
        },
          H('div', {
            className: 'modal-inner',
            style: {
              display: 'block',
              width: 'min(520px, 92vw)',
              background: '#111',
              color: '#fff',
              borderRadius: 16,
              padding: 16,
              boxShadow: '0 16px 48px rgba(0,0,0,.45)',
              lineHeight: 1.55,
              position: 'relative'
            }
          },
            H('button', {
              type: 'button',
              onClick: onClose,
              'aria-label': 'Close',
              style: {
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '44px',
                height: '44px',
                fontSize: '32px',
                lineHeight: '32px',
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: '#fff', cursor: 'pointer',
                fontWeight: 'bold'
              }
            }, '✕'),
            H('div', { style: { paddingTop: '28px', fontWeight: 800, fontSize: 16, marginBottom: 8 } }, title),
            H('div', null,
              intro && H('p', { style: { margin: '6px 0 10px', opacity: 0.9 } }, intro),
              Array.isArray(bullets) && bullets.length > 0 && H('ul', {
                style: {
                  paddingLeft: 18,
                  margin: '0 0 12px',
                  listStyle: 'disc'
                }
              }, bullets.map((line, idx) => H('li', { key: idx }, line))),
              footer && H('div', {
                style: {
                  fontSize: 13,
                  opacity: 0.9,
                  borderTop: '1px solid rgba(255,255,255,0.12)',
                  paddingTop: 10
                }
              }, footer)
            )
          )
        ),
        document.body
      );
    }

    // --- Auto-list help modal (clean single-column layout) ---
    function AutoListHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'About Auto-list',
        intro: 'When enabled, Auto-List will:',
        bullets: [
          'Allow AI to suggest title, tags and price .',
          'Immediately create the listing for you.',
          'Upload all selected photos to that listing.'
        ],
        footer: 'You can still edit or delete the listing afterwards.'
      });
    }

    // --- AI description help modal (matches Auto-list styling) ---
    function AiDescriptionHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'About AI descriptions',
        intro: 'When enabled, AI descriptions will:',
        bullets: [
          'Analyze your uploaded photos to draft a description for you.',
          'Include the AI-written text right in the description field.',

        ],
        footer: 'The more photos you upload, the better the AI can understand your item.'
      });
    }

    function InquiryHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'Offer Message',
        intro: 'When Offer is enabled it will:',
        bullets: [
          'Overlay the listing image with a message inviting buyers to make an offer.'
        ],
        footer: 'Disable Offer Message to allow only the price.'
      });
    }

    // --- Listing Form (S3-first) ---
    function ListingForm({ draft, onCancel, onSaved, autoListEnabled, aiDescriptionEnabled, autoPostNearbyEnabled, autoInquiryEnabled, backgroundQueueEnabled, enqueueListingJob, initialFiles = [] }) {
      const [files, setFiles] = useState(() => Array.isArray(initialFiles) ? initialFiles.slice() : []); // Files to upload to S3
      const [existingUrls, setExistingUrls] = useState([]); // Show current images (editable)
      const [originalUrls, setOriginalUrls] = useState([]);

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

      // auto-list guard
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

      const isMobile = isMobileDevice();

      useEffect(() => {
        if (!Array.isArray(initialFiles)) return;
        if (initialFiles.length === 0) {
          setFiles([]);
          return;
        }
        setFiles(initialFiles.slice());
      }, [initialFiles]);

      // Load current images (URLs/base64; new uploads use files[])
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

      // UPDATED: AI analysis that works with both new files and S3 URLs
      async function runAI(){
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
            alert('No images available for AI analysis. Please add new images or ensure existing images are accessible.');
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
        } catch { setGeoErr('Could not get your location'); }
        finally { setGeoBusy(false); }
      }

      // Auto-list effect
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
              ai = await api.aiAnalyze({ images: aiSources, hint: '' }, { silent:true }) || {};
            }
          } catch (_) {}

          const parsedPrice = Number(ai.suggested_price);
          const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

          const rawDescription = (typeof ai.description === 'string' ? ai.description.trim() : '');
          if (rawDescription && aiDescriptionEnabled) {
            aiDescription = rawDescription.slice(0, 400);
          }

          // Nearby preference (sub-toggle)
          const manualLocation = String(location || '').trim();
          let locAuto = manualLocation;
          let latAuto = null;
          let lonAuto = null;
          let enableNearbyAuto = 0;
          let cachedCoords = null;

          async function ensureCoords() {
            if (cachedCoords) return cachedCoords;
            cachedCoords = await fetchCoordsAndReverseInternal();
            return cachedCoords;
          }

          if (autoPostNearbyEnabled) {
            try {
              const c = await ensureCoords();
              enableNearbyAuto = 1;
              latAuto = c.lat; lonAuto = c.lon;
              if (!locAuto) locAuto = formatLocationDisplay(c, c?.display || '');
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

      // UPDATED: Submit function that handles image changes properly
      // Update the submit function (remove the duplicate and fix it):
      async function submit(e){
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

      return H('form', { onSubmit: submit, className:'row', style:{flexDirection:'column', gap:12, position:'relative'}},

        // Auto-list overlay while it works
        autoBusy && H('div', {
          style:{
            position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
            display:'grid', placeItems:'center', zIndex:5, borderRadius:12
          }
        }, H('div', null, H('div', {className:'spinner'}), H('div', {style:{marginTop:6, fontWeight:700}}, 'Auto-listing...'))),

        // New uploads (go to S3)
        H(MultiFilePicker, { files, onChange:setFiles }),

        // UPDATED: Existing images with delete capability
        (existingUrls.length > 0) && H('div', null,
          H('div', { className:'muted', style:{ marginBottom:8 } }, 'Existing images:'),
          H('div', { className:'row', style:{ gap:8, flexWrap:'wrap' } },
            ...existingUrls.map((src, i) =>
              H('div', { key:i, style:{ position:'relative' } },
                H(ImageWithSkeleton, { src, style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #ddd' } }),
                H('button', {
                  className:'btn danger',
                  type:'button',
                  style:{ position:'absolute', top:4, right:4, padding:'4px 8px' },
                  onClick:() => {
                    const next = [...existingUrls];
                    next.splice(i, 1);
                    setExistingUrls(next);
                  }
                }, 'x')
              )
            )
          )
        ),

        H('div', { className:'row', style:{ gap:8 } },
          H('button', { type:'button', className:`btn ${aiBusy?'':'primary'}`, disabled:aiBusy, onClick:runAI }, aiBusy ? 'Analyzing...' : 'Run AI analysis'),
          aiErr && H('span', { className:'muted', style:{ color:'#b91c1c' } }, aiErr),
          H('span', { className:'muted' }, 'Only images are required. AI can suggest title/tags/price.')
        ),

        H('label', null, 'Title (optional)'),
        H('input', { value:title, maxLength:80, onChange:e=>setTitle(e.target.value), placeholder:'Optional' }),

        H('label', null, 'Description (optional)'),
        H('textarea', { value:description, maxLength:400, onChange:e=>setDescription(e.target.value), placeholder:'Optional' }),

        H('label', null, 'Location (required)'),
        H('div', { className:'row', style:{ gap:8 } },
          H('input', { value:location, maxLength:80, onChange:e=>setLocation(e.target.value), placeholder:'Required (City, State)' }),
          H('button', { type:'button', className:'btn', onClick:useMyLocation, disabled:geoBusy }, geoBusy ? 'Locating...' : 'Use my location'),
          geoErr && H('span', { className:'muted', style:{ color:'#b91c1c' } }, geoErr)
        ),

        isMobile && H('label', {
          className:'toggle-card',
          style:{ marginTop:4, gap:8, alignItems:'flex-start' }
        },
          H('input', {
            type:'checkbox',
            className:'toggle-input',
            checked:enableNearby,
            onChange:e=>{
              const checked = e.target.checked;
              setEnableNearby(checked);
              if (checked && !hasFixedGps) useMyLocation();
            }
          }),
          H('span', { className:'toggle-slider', 'aria-hidden': true }),
          H('div', { className:'toggle-copy' },
            H('div', { style:{ fontWeight:700 } }, 'Enable Nearby searches'),
            H('div', { className:'muted', style:{ fontSize:12 } }, 'Shows distance in feet/miles to buyers.')
          )
        ),
        (enableNearby && hasFixedGps) && H('span', { className:'muted', style:{ marginTop:4 } }, 'Nearby GPS fixed at creation; cannot change.'),

        H('label', null, 'Price (optional)'),
        H('div', { className:'row', style:{ alignItems:'center', gap:12, flexWrap:'wrap' } },
          H('div', { className:'row', style:{ alignItems:'center', gap:8 } },
            H('input', {
              value:priceVal,
              inputMode:'decimal',
              onChange:e=>setPriceVal(e.target.value.replace(/[^0-9.]/g,'')),
              placeholder:'Leave empty for $0.00'
            }),
            showInquiryText
              ? H('span', { className:'inquiry-badge' }, 'Seller wants an offer')
              : H('span', {
                  className:'muted',
                  style:{ fontWeight:700, color: isFree ? '#16a34a' : '#6b7280' }
                }, formattedPrice)
          ),
          H('div', { className:'row', style:{ alignItems:'center', gap:6 } },
            H('label', { className:'toggle-card', style:{ padding:'6px 10px' } },
              H('input', {
                type:'checkbox',
                className:'toggle-input',
                checked:showInquiryText,
                onChange:e=>setInquiryEnabled(e.target.checked)
              }),
              H('span', { className:'toggle-slider', 'aria-hidden': true }),
              H('div', { className:'toggle-copy' },
                H('div', { style:{ fontWeight:700 } }, 'Offer Message'),
                H('div', { className:'muted', style:{ fontSize:12 } }, 'show offer message')
              )
            ),
            H('button', {
              type:'button',
              onClick:(e)=>{ e.preventDefault(); e.stopPropagation(); setShowInquiryHelp(true); },
              title:'Inquiry mode info',
              style:{
                width:24, height:24, lineHeight:'22px',
                borderRadius:12, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer'
              }
            }, '?')
          )
        ),

        H('div', { className:'card', style:{ padding:12, background:'#fafafa' } },
          H('div', { style:{ fontWeight:600, marginBottom:6 } }, 'Search tags (private, optional)'),
          H('div', { className:'muted', style:{ marginBottom:6 } }, 'Not shown publicly; help others find your item. Example:"car, suv, 4x4".'),
          H('input', { placeholder:'e.g. car, suv, 4x4', value:tags, onChange:e=>setTags(e.target.value) })
        ),

        H('div', { className:'row' },
          H('button', { className:'btn primary', type:'submit', disabled:autoBusy }, draft ? 'Save changes' : 'Create listing'),
          H('button', { className:'btn', type:'button', onClick:onCancel, disabled:autoBusy }, 'Cancel')
        ),
        showInquiryHelp && H(InquiryHelpModal, { onClose: () => setShowInquiryHelp(false) })
      );
    }

    // --- MassList Modal (fixed) ---
    function MassListModal({ onClose, onDone, reloadAll, reloadMine, user, autoPostNearbyEnabled, aiDescriptionEnabled, autoInquiryEnabled, onLockedAction, backgroundQueueEnabled, enqueueListingJob, initialFiles = [] }) {
      const [files, setFiles] = useState(() => Array.isArray(initialFiles) ? initialFiles.slice() : []);
      const [busy, setBusy] = useState(false);
      const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
      const filePreviews = useFilePreviews(files);

      const fileRef = useRef();

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

      function pick(e){
        const MAX_EACH_MB = 20;
        const selected = Array.from(e.target.files || []);
        const next = [...files];
        for (const f of selected) {
          if (!f.type?.startsWith?.('image/')) { alert('Only images are allowed'); continue; }
          if (f.size > MAX_EACH_MB * 1024 * 1024) { alert(`Each image must be under ${MAX_EACH_MB}MB`); continue; }
          next.push(f);
        }
        setFiles(next);
        if (fileRef.current) fileRef.current.value = '';
      }
      function removeAt(i){
        const next=[...files];
        const [removed] = next.splice(i,1);
        if (removed) clearDraftCacheForFile(removed);
        setFiles(next);
      }

      const executeMassList = async ({ filesSnapshot, trackProgress }) => {
        const total = filesSnapshot.length;
        let failedCount = 0;
        let doneCount = 0;

        const updateProgress = trackProgress
          ? (nextDone, nextFailed) => setProgress({ done: nextDone, total, failed: nextFailed })
          : () => {};

        updateProgress(0, 0);

        let sharedNearby = { ok:false, lat:null, lon:null, display:'' };
        if (autoPostNearbyEnabled) {
          try {
            const c = await fetchCoordsAndReverseInternal();
            sharedNearby = { ok:true, lat:c.lat, lon:c.lon, display:c.display };
          } catch (_) {
            sharedNearby = { ok:false, lat:null, lon:null, display:'' };
          }
        }

        const nearbyLocation = sharedNearby.display ? String(sharedNearby.display).trim() : '';
        const presetLocation = typeof user?.location_preset === 'string'
          ? user.location_preset.trim()
          : '';
        // MassList runs without a manual location field, so when auto-nearby is
        // disabled we still need to send a non-empty location string. The API
        // rejects blank locations, which is what caused the failure. Prefer the
        // fresh nearby label when available, fall back to the saved profile
        // preset, and finally use the generic placeholder that matches the
        // single-listing flow.
        const normalizedLocation = nearbyLocation || presetLocation || 'Unknown location';

        const limiter = createConcurrencyLimiter(3);

        const jobs = filesSnapshot.map((file) => limiter(async () => {
          let encounteredError = false;
          try {
            const upload = await uploadFileDraft(file);

            let ai = {};
            let aiDescription = '';
            try {
              ai = await api.aiAnalyze({ images: [upload.publicUrl], hint: '' }, { silent:true }) || {};
            } catch (_) {
              /* ignore AI failure; fallback below */
            }

            const safePrice = (Number.isFinite(ai.suggested_price) && ai.suggested_price >= 0) ? ai.suggested_price : 0;
            const rawDescription = (typeof ai.description === 'string' ? ai.description.trim() : '');
            if (rawDescription && aiDescriptionEnabled) {
              aiDescription = rawDescription.slice(0, 400);
            }
            const payload = {
              title: (ai.title || 'Item for sale').toString().slice(0, 80),
              description: aiDescription || 'No description',
              location: normalizedLocation,
              price: safePrice,
              tags: Array.isArray(ai.tags) ? ai.tags.join(', ') : '',
              enable_nearby: sharedNearby.ok ? 1 : 0,
              upload_tokens: [upload.uploadToken]
            };
            if (autoInquiryEnabled) payload.inquiry_enabled = 1;
            if (sharedNearby.ok) { payload.lat = sharedNearby.lat; payload.lon = sharedNearby.lon; }

            const created = await api.createListing(payload);
            if (!created?.id) throw new Error('create_failed');
            if (autoInquiryEnabled && created?.id) {
              try {
                await api.updateListing(created.id, { inquiry_enabled: 1 });
              } catch (err) {
                console.error('Failed to mark mass-listed item as inquiry-enabled:', err);
              }
            }

          } catch (err) {
            encounteredError = true;
            failedCount += 1;
            console.error('MassList failed:', err);
          } finally {
            doneCount += 1;
            updateProgress(doneCount, failedCount);
          }

          return !encounteredError;
        }));

        await Promise.allSettled(jobs);

        try { await reloadMine(); } catch {}
        try { await reloadAll({ preserveExisting: true }); } catch {}

        return { total, created: total - failedCount, failed: failedCount };
      };

      async function runMassList(){
        if (!user) { alert('Log in to create listings.'); return; }
        if (user.account_status === 'locked') { onLockedAction?.(); return; }
        if (!files.length) { alert('Pick at least one image.'); return; }

        const filesSnapshot = files.slice();

        const runJob = async (trackProgress) => {
          const stats = await executeMassList({ filesSnapshot, trackProgress });
          onDone && onDone(stats);
        };

        if (backgroundQueueEnabled && typeof enqueueListingJob === 'function') {
          enqueueListingJob(async () => {
            try {
              await runJob(false);
            } catch (err) {
              console.error('MassList failed:', err);
              alert(`MassList failed: ${err?.message || err}`);
            }
          });
          onClose?.();
          return;
        }

        setBusy(true);
        setProgress({ done: 0, total: filesSnapshot.length, failed: 0 });
        try {
          await runJob(true);
          onClose?.();
        } catch (err) {
          console.error('MassList failed:', err);
          alert(`MassList failed: ${err?.message || err}`);
        } finally {
          setBusy(false);
        }
      }

      const modal = H('div', { className:'modal open', onClick:(e)=>{ if(e.target.classList.contains('modal')) onClose(); } },
        H('div', { className:'modal-inner', style:{ width:'min(680px, 92vw)', background:'#fff', borderRadius:24, overflow:'hidden' } },
          H('button', { className:'close', onClick:onClose }, 'x'),
          H('div', { style:{ padding:16 } },
            H('div', { style:{ fontWeight:800, fontSize:18, marginBottom:6 } }, 'MassList'),
            H('div', { className:'muted', style:{ marginBottom:12 } }, 'Pick multiple photos from your gallery. We will create one listing per photo using AI for title, tags, and price (you can edit later).'),

            H('div', { className:'row', style:{ gap:8, alignItems:'center' } },
              H('input', { type:'file', accept:'image/*', multiple:true, ref:fileRef, onChange: pick }),
              H('span', { className:'muted' }, `${files.length} selected`)
            ),

            filePreviews.length > 0 && H('div', { className:'row', style:{ gap:8, flexWrap:'wrap', marginTop:12 } },
              ...filePreviews.map(({ url },i) =>
                H('div', { key:i, style:{ position:'relative' } },
                  H(ImageWithSkeleton, { src: url, style:{ width:96, height:96, objectFit:'cover', borderRadius:12, border:'1px solid #e5e7eb' }, loading:'lazy', decoding:'async' }),
                  H('button', { className:'btn danger', type:'button', style:{ position:'absolute', top:4, right:4, padding:'4px 8px' }, onClick:()=>removeAt(i) }, 'x')
                )
              )
            ),

            H('div', { className:'row', style:{ marginTop:16 } },
              H('button', { className:'btn', onClick:onClose, disabled:busy }, 'Cancel'),
              H('button', { className:`btn primary`, onClick:runMassList, disabled:busy || files.length===0 }, busy ? 'Working...' : 'Confirm MassList')
            )
          ),

          // Progress overlay
          busy && H('div', {
            style:{
              position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
              display:'grid', placeItems:'center', zIndex:10, textAlign:'center', padding:'16px'
            }
          },
            H('div', null,
              H('div', { className:'spinner' }),
              H('div', { style:{ fontWeight:800, marginTop:6 } }, 'MassList in progress...'),
              H('div', { className:'muted', style:{ marginTop:4 } }, `${progress.done}/${progress.total} completed`),
              progress.failed>0 && H('div', { className:'muted', style:{ marginTop:2, color:'#b91c1c' } }, `${progress.failed} failed`)
            )
          )
        )
      );

      return ReactDOM.createPortal(modal, document.body);
    }

    const REPORT_REASON_OPTIONS = [
      { value: 'fraud', label: 'Fraud or scam' },
      { value: 'spam', label: 'Spam or advertising' },
      { value: 'inappropriate', label: 'Inappropriate content' },
      { value: 'harassment', label: 'Harassment or abusive behavior' },
      { value: 'other', label: 'Other' }
    ];

    function makeReportCaptcha() {
      return {
        a: 2 + Math.floor(Math.random() * 7),
        b: 2 + Math.floor(Math.random() * 7)
      };
    }

    function ReportSellerModal({ open, listing, onClose, onReported }) {
      const [selected, setSelected] = useState(() => new Set());
      const [details, setDetails] = useState('');
      const [captcha, setCaptcha] = useState(() => makeReportCaptcha());
      const [answer, setAnswer] = useState('');
      const [error, setError] = useState('');
      const [submitting, setSubmitting] = useState(false);
      const [submitted, setSubmitted] = useState(false);

      useEffect(() => {
        if (!open) return;
        setSelected(new Set());
        setDetails('');
        setCaptcha(makeReportCaptcha());
        setAnswer('');
        setError('');
        setSubmitted(false);
      }, [open, listing?.id]);

      useEffect(() => {
        if (!open) return;
        const onKey = (ev) => { if (ev.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, onClose]);

      const toggleReason = (value) => {
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          return next;
        });
      };

      const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting || submitted) return;
        setError('');
        const reasons = Array.from(selected);
        if (!reasons.length) {
          setError('Select at least one reason.');
          return;
        }
        if (reasons.includes('other') && !details.trim()) {
          setError('Please include details for "Other".');
          return;
        }
        const expected = captcha.a + captcha.b;
        if (Number(answer) !== expected) {
          setError('Captcha answer is incorrect.');
          setCaptcha(makeReportCaptcha());
          setAnswer('');
          return;
        }
        setSubmitting(true);
        try {
          await api.reportSeller({
            reported_user_id: listing?.user_id,
            listing_id: listing?.id,
            reasons,
            details: details.trim() || undefined,
            captcha: { a: captcha.a, b: captcha.b, answer: Number(answer) }
          });
          setSubmitted(true);
          onReported?.();
        } catch (err) {
          setError(err.message || 'Unable to submit report.');
          setCaptcha(makeReportCaptcha());
          setAnswer('');
        } finally {
          setSubmitting(false);
        }
      };

      if (!open) return null;

      const sellerName = listing?.owner_username ? listing.owner_username : 'this seller';

      const modal = H('div', {
        className: 'modal open',
        onClick: (e) => { if (e.target.classList.contains('modal')) onClose?.(); }
      },
        H('div', { className: 'modal-inner', style: { maxWidth: '520px', padding: '24px', background: '#fff', color: '#111' } },
          H('button', { className: 'close', onClick: onClose, disabled: submitting && !submitted }, 'X'),
          H('h2', { style: { margin: '0 0 16px', fontSize: 24, fontWeight: 700 } }, `Report ${sellerName}`),
          submitted ?
            H('div', { className: 'muted', style: { marginBottom: 16 } }, 'Thank you. We will review this report shortly.') :
            H('form', { onSubmit: handleSubmit, style: { display: 'grid', gap: 12 } },
              H('div', { style: { fontWeight: 600 } }, 'Why are you reporting this seller?'),
              REPORT_REASON_OPTIONS.map(opt => H('label', {
                key: opt.value,
                style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }
              },
                H('input', {
                  type: 'checkbox',
                  checked: selected.has(opt.value),
                  disabled: submitting,
                  onChange: () => toggleReason(opt.value)
                }),
                opt.label
              )),
              H('textarea', {
                placeholder: 'Additional details (optional)',
                value: details,
                onChange: (e) => setDetails(e.target.value),
                disabled: submitting,
                rows: 3,
                style: { width: '100%', fontSize: 13, padding: 8 }
              }),
              H('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                H('span', null, `What is ${captcha.a} + ${captcha.b}?`),
                H('input', {
                  type: 'number',
                  value: answer,
                  onChange: (e) => setAnswer(e.target.value),
                  disabled: submitting,
                  style: { width: 80 }
                })
              ),
              error && H('div', { style: { color: '#b91c1c', fontSize: 13 } }, error),
              H('div', { className: 'row', style: { gap: 8, marginTop: 4 } },
                H('button', { className: 'btn primary', type: 'submit', disabled: submitting, style: { flex: 1 } }, submitting ? 'Submitting...' : 'Submit report'),
                H('button', { className: 'btn', type: 'button', onClick: onClose, disabled: submitting, style: { flex: 1 } }, 'Cancel')
              )
            ),
          submitted && H('div', { style: { marginTop: 16 } },
            H('button', { className: 'btn primary', onClick: onClose }, 'Close')
          )
        )
      );

      return ReactDOM.createPortal(modal, document.body);
    }

    function ListingModal({ open, item, onClose, cardProps = {} }) {
      useBodyScrollLock(open);

      React.useEffect(() => {
        if (!open) return;
        const handler = (evt) => {
          if (evt.key === 'Escape') {
            evt.preventDefault();
            onClose?.();
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [open, onClose]);

      if (!open || !item) return null;

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: (evt) => {
            if (evt.target === evt.currentTarget || evt.target.classList.contains('modal')) {
              onClose?.();
            }
          }
        },
          H('div', {
            className: 'modal-inner listing-modal',
            onClick: (evt) => evt.stopPropagation()
          },
            H('button', { className: 'close', onClick: onClose }, 'x'),
            H(ListingCard, { item, viewContext: 'modal', ...cardProps })
          )
        ),
        document.body
      );
    }

    function ListingGalleryModal({ open, images, index, onClose, onIndex, loading = false }) {
      useBodyScrollLock(open);

      const list = Array.isArray(images) ? images.filter(Boolean) : [];
      const len = list.length;
      const safeIndex = len ? Math.min(Math.max(Number(index) || 0, 0), len - 1) : 0;
      const canNavigate = len > 1 && typeof onIndex === 'function';
      const currentSrc = len ? list[safeIndex] : '';

      const [stageLoaded, setStageLoaded] = React.useState(false);

      React.useEffect(() => {
        if (!open) {
          setStageLoaded(false);
          return;
        }
        setStageLoaded(false);
      }, [open, currentSrc]);

      const handleStageSettled = React.useCallback(() => {
        setStageLoaded(true);
      }, []);

      React.useEffect(() => {
        if (!open) return;
        if (index !== safeIndex) {
          onIndex?.(safeIndex);
        }
      }, [open, safeIndex, index, onIndex]);

      React.useEffect(() => {
        if (!open) return;
        const handler = (evt) => {
          if (evt.key === 'Escape') {
            evt.preventDefault();
            onClose?.();
            return;
          }
          if (!canNavigate) return;
          if (evt.key === 'ArrowRight') {
            evt.preventDefault();
            onIndex?.((safeIndex + 1) % len);
          } else if (evt.key === 'ArrowLeft') {
            evt.preventDefault();
            onIndex?.((safeIndex - 1 + len) % len);
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [open, canNavigate, safeIndex, len, onClose, onIndex]);

      const handleBackdropClick = React.useCallback((evt) => {
        if (evt.target.classList.contains('lightbox-backdrop') ||
            evt.target.classList.contains('lightbox-overlay')) {
          onClose?.();
        }
      }, [onClose]);

      if (!open) return null;

      const stageOverlay = (!stageLoaded && currentSrc) || (loading && !len)
        ? H('div', { className: 'lightbox-stage-skeleton', 'aria-hidden': true })
        : null;

      const imageContent = len
        ? H('div', { className: 'lightbox-main' },
            H(ResponsiveImage, {
              src: currentSrc,
              alt: `Listing image ${safeIndex + 1}`,
              widths: [480, 720, 1080, 1440],
              sizes: '100vw',
              loading: 'eager',
              fetchPriority: 'high',
              className: 'lightbox-img',
              onLoad: handleStageSettled,
              onError: handleStageSettled,
              style: { opacity: stageLoaded ? 1 : 0, transition: 'opacity 180ms ease' }
            })
          )
        : H('div', { className: 'lightbox-main' },
            H('div', { className: 'lightbox-empty' }, loading ? null : 'No images available')
          );

      const thumbsContent = len
        ? H('div', { className: 'lightbox-thumbs' },
            ...list.map((img, i) => H(ImageWithSkeleton, {
              key: String(i),
              src: img,
              alt: `Thumbnail ${i + 1}`,
              className: i === safeIndex ? 'active' : '',
              onClick: () => onIndex?.(i)
            }))
          )
        : (loading
            ? H('div', { className: 'lightbox-thumbs loading', 'aria-hidden': true },
                ...Array.from({ length: 4 }).map((_, i) =>
                  H('div', { key: `s-${i}`, className: 'lightbox-thumb-skeleton' })
                )
              )
            : H('div', { className: 'lightbox-thumbs empty' },
                H('span', null, 'No photos yet')
              )
          );

      const overlayContent = H('div', { className: 'lightbox-content', role: 'dialog', 'aria-modal': true },
        H('button', { className: 'lightbox-close', onClick: onClose, 'aria-label': 'Close gallery' }, '×'),
        stageOverlay,
        imageContent,
        thumbsContent,
        canNavigate && H('div', { className: 'lightbox-nav' },
          H('button', { className: 'nav prev', onClick: () => onIndex?.((safeIndex - 1 + len) % len), 'aria-label': 'Previous' }, '‹'),
          H('button', { className: 'nav next', onClick: () => onIndex?.((safeIndex + 1) % len), 'aria-label': 'Next' }, '›')
        )
      );

      return ReactDOM.createPortal(
        H('div', {
          className: 'lightbox-overlay open',
          role: 'presentation',
          onClick: handleBackdropClick
        },
          H('div', { className: 'lightbox-backdrop' }),
          overlayContent
        ),
        document.body
      );
    }

    function ListingCard({
      item,
      canEdit,
      onEdit,
      onDelete,
      user,
      onMessage,
      onAdminDelete,
      onViewSeller,
      onToggleSold,
      onSupporterClick,
      showDistance = false,
      viewContext = 'grid'
    }) {

      const fallbackImages = useMemo(() => collectListingImages(item, item?.__cover), [item, item?.__cover]);
      const baseGallery = useMemo(() => {
        const fallbackList = Array.isArray(fallbackImages) ? fallbackImages : [];
        const inlineList = Array.isArray(item?.images) ? item.images : [];
        return dedupeImageUrls([...fallbackList, ...inlineList]);
      }, [item?.images, fallbackImages]);

      const [galleryImages, setGalleryImages] = useState(baseGallery);
      const [galleryOpen, setGalleryOpen] = useState(false);
      const [galleryIndex, setGalleryIndex] = useState(0);
      const [galleryLoading, setGalleryLoading] = useState(false);
      const [showReport, setShowReport] = useState(false);
      const [derivedMeters, setDerivedMeters] = React.useState(null);
      const [showProfilePreview, setShowProfilePreview] = useState(false);
      const [profileData, setProfileData] = useState(null);

      const isModalView = viewContext === 'modal';

      const normalizedBaseGallery = useMemo(() => {
        if (Array.isArray(baseGallery) && baseGallery.length) return baseGallery;
        const fallbackCover = item.image_data || item.__cover || item.thumb_url || '';
        return fallbackCover ? [fallbackCover] : [];
      }, [baseGallery, item.image_data, item.__cover, item.thumb_url]);

      const sameList = useCallback((a, b) => {
        if (a === b) return true;
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return false;
        }
        return true;
      }, []);

      const baseImageCount = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery.length : 0;

      const prefetchImages = useCallback(() => {
        if (!item?.id) return;
        if (listingImageInFlight.has(item.id)) return;
        const minCount = baseImageCount + 1;
        const cached = listingImageCache.get(item.id);
        if (Array.isArray(cached) && cached.length >= minCount) return;
        fetchListingImagesCached(item.id, { minCount });
      }, [item?.id, baseImageCount]);

      React.useEffect(() => {
        const baseList = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery : [];
        setGalleryImages(prev => {
          const prevList = Array.isArray(prev) ? prev : [];
          return sameList(prevList, baseList) ? prevList : baseList;
        });
      }, [normalizedBaseGallery, sameList]);

      React.useEffect(() => {
        if (!item?.id) return;
        const cached = listingImageCache.get(item.id);
        if (Array.isArray(cached) && cached.length) {
          const cachedList = dedupeImageUrls(cached);
          setGalleryImages(prev => sameList(prev, cachedList) ? prev : cachedList);
        }
      }, [item?.id, sameList]);

      const handleOpenGallery = useCallback(async (start = 0) => {
        const baseList = Array.isArray(normalizedBaseGallery) ? normalizedBaseGallery : [];
        setGalleryIndex(Number.isFinite(start) ? start : 0);
        setGalleryImages(prev => {
          const prevList = Array.isArray(prev) ? prev : [];
          return sameList(prevList, baseList) ? prevList : baseList;
        });
        setGalleryOpen(true);
        prefetchImages();

        if (!item?.id) return;

        setGalleryLoading(true);
        try {
          const fetched = await fetchListingImagesCached(item.id, { minCount: baseList.length + 1 });
          const merged = dedupeImageUrls([...baseList, ...(Array.isArray(fetched) ? fetched : [])]);
          if (merged.length) {
            listingImageCache.set(item.id, merged);
          }
          setGalleryImages(prev => sameList(prev, merged) ? prev : merged);
        } catch (err) {
          console.warn('Failed to load gallery images for listing', item?.id, err);
        } finally {
          setGalleryLoading(false);
        }
      }, [item?.id, normalizedBaseGallery, sameList, prefetchImages]);

      React.useEffect(() => {
        if (!item?.id) return;
        if (!Array.isArray(galleryImages) || !galleryImages.length) return;
        const baseLen = baseImageCount;
        if (galleryImages.length <= baseLen) return;
        listingImageCache.set(item.id, galleryImages);
      }, [galleryImages, item?.id, baseImageCount]);

      React.useEffect(() => {
        if (!galleryOpen) return;
        const len = Array.isArray(galleryImages) ? galleryImages.length : 0;
        if (!len) {
          if (galleryIndex !== 0) setGalleryIndex(0);
          return;
        }
        if (galleryIndex >= len) {
          setGalleryIndex(len - 1);
        } else if (galleryIndex < 0) {
          setGalleryIndex(0);
        }
      }, [galleryOpen, galleryImages, galleryIndex]);

      React.useEffect(() => {
        if (!showDistance) {
          setDerivedMeters(null);
          return;
        }
        let fromServer = null;
        if (Number.isFinite(item?.distance_m)) fromServer = item.distance_m;
        if (Number.isFinite(item?.distance_ft)) fromServer = item.distance_ft / 3.28084;
        if (fromServer != null) {
          setDerivedMeters(fromServer);
          return;
        }

        if (Number.isFinite(item?.lat) && Number.isFinite(item?.lon)) {
          getUserCoordsOnce().then(coords => {
            if (!coords) return;
            const m = haversineMeters(coords.lat, coords.lon, item.lat, item.lon);
            setDerivedMeters(m);
          });
        } else {
          setDerivedMeters(null);
        }
      }, [showDistance, item?.id, item?.lat, item?.lon]);

      const isFree = Number(item?.price ?? 0) === 0;
      const wantsOffer = !!item?.inquiry_enabled;
      const [soldBusy, setSoldBusy] = useState(false);
      const galleryCount = Array.isArray(galleryImages) ? galleryImages.length : 0;
      const coverSrc = item.image_data || (galleryCount ? galleryImages[0] : '');

      const controls = [];
      if (!user || user.id !== item.user_id) {
        controls.push(H('button', {
          key: 'm',
          className: 'btn primary',
          onClick: () => onMessage?.(item)
        }, 'Message seller'));
      }
      if (user && user.id !== item.user_id) {
        controls.push(H('button', {
          key: 'report',
          className: 'btn',
          onClick: () => setShowReport(true)
        }, 'Report seller'));
      }
      if (canEdit) {
        controls.push(H('button', {
          key: 'e',
          className: 'btn',
          onClick: () => onEdit?.(item)
        }, 'Edit'));
        if (onToggleSold) {
          const isSold = !!item?.sold;
          controls.push(H('button', {
            key: 'sold-toggle',
            className: 'btn',
            onClick: async () => {
              if (soldBusy) return;
              try {
                setSoldBusy(true);
                await onToggleSold(item, !isSold);
              } finally {
                setSoldBusy(false);
              }
            },
            disabled: soldBusy,
            style: {
              background: isSold ? '#D1FAE5' : '#059669',
              color: isSold ? '#047857' : '#fff',
              borderColor: '#059669'
            }
          }, isSold ? 'Mark as unsold' : 'Mark as sold'));
        }
        controls.push(H('button', {
          key: 'd',
          className: 'btn danger',
          onClick: () => onDelete?.(item)
        }, 'Remove Listing'));
      }
      if (user?.is_admin) {
        controls.push(H('button', {
          key: 'admin-del',
          className: 'btn danger',
          onClick: async () => {
            if (!confirm('Admin: Delete this listing?')) return;
            await api.adminDeleteListing(item.id);
            onAdminDelete?.(item.id);
          }
        }, 'Admin Delete'));
      }

      const supporterData = item?.owner_supporter_badge ? {
        username: item?.owner_username ? item.owner_username : null,
        since: item?.owner_supporter_since || null,
        badge: item?.owner_supporter_badge || null
      } : null;

      const handleSupporterBadgeClick = () => {
        if (!supporterData) return;
        const payload = {
          username: supporterData.username || (item?.owner_username ? item.owner_username : 'This seller'),
          since: supporterData.since || null
        };
        onSupporterClick?.(payload);
      };

      const handleShowProfilePreview = useCallback(async (userId) => {
        if (!api || typeof api.getUser !== 'function') return;
        try {
          const userData = await api.getUser(userId, { silent: true });
          setProfileData(userData);
          setShowProfilePreview(true);
        } catch (err) {
          console.warn('Failed to load profile data:', err);
        }
      }, [api]);

      const renderSellerInfo = () => {
        if (!item.owner_username) {
          return '--';
        }

        const sellerNode = onViewSeller
          ? H('button', {
              onClick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleShowProfilePreview(item.user_id);
              },
              style: {
                background: 'none',
                border: 'none',
                color: '#111',
                fontWeight: 600,
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                font: 'inherit'
              }
            }, item.owner_username)
          : H('span', { style: { fontWeight: 600, color: '#111' } }, item.owner_username);

        if (!supporterData || viewContext === 'grid') {
          return sellerNode;
        }

        return H('span', {
          style: { display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
        },
          sellerNode,
          H(SupporterBadge, {
            size: 'sm',
            since: supporterData.since,
            badge: supporterData.badge,
            onClick: handleSupporterBadgeClick
          })
        );
      };

      const openGalleryFromEvent = useCallback((evt) => {
        if (evt && typeof evt.preventDefault === 'function') {
          evt.preventDefault();
        }
        if (evt && typeof evt.stopPropagation === 'function') {
          evt.stopPropagation();
        }
        handleOpenGallery(0);
      }, [handleOpenGallery]);

      const cardEventProps = isModalView ? {} : {
        onMouseEnter: prefetchImages,
        onFocus: prefetchImages,
        onPointerDown: prefetchImages,
        onTouchStart: prefetchImages
      };

      return H('div', { className: 'card', ...cardEventProps, tabIndex: -1 },
        H('div', {
          className: 'aspect',
          onClick: openGalleryFromEvent,
          style: {
            cursor: 'zoom-in',
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 8
          }
        },
          coverSrc
            ? H(ResponsiveImage, {
                src: coverSrc,
                alt: item.title || 'Listing image',
                style: { width: '100%', height: '100%', objectFit: 'cover' },
                sizes: '(min-width: 1024px) 280px, (min-width: 640px) 45vw, 90vw',
                loading: isModalView ? 'eager' : 'lazy',
                fetchPriority: isModalView ? 'high' : 'auto',
                onClick: openGalleryFromEvent
              })
            : H('div', {
                style: {
                  width: '100%',
                  height: '100%',
                  background: '#f3f4f6',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#6b7280',
                  fontWeight: 600
                }
              }, 'No image'),
          item.sold ? H('div', {
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }
          },
            H('div', {
              style: {
                transform: 'rotate(-18deg)',
                padding: '6px 18px',
                textTransform: 'uppercase',
                letterSpacing: '6px',
                fontWeight: 800,
                fontSize: 26,
                color: 'rgba(4, 120, 87, 0.85)',
                border: '3px solid rgba(16, 185, 129, 0.55)',
                background: 'rgba(229, 255, 244, 0.82)',
                borderRadius: 999
              }
            }, 'Sold')
          ) : null,
          wantsOffer ? H('span', {
            className: 'inquiry-badge',
            style: {
              position: 'absolute',
              bottom: 8,
              right: 8,
              fontSize: 11,
              pointerEvents: 'none'
            }
          }, 'Seller wants an offer') : null
        ),
        H('div', { style: { padding: 16 } },
          H('div', {
            className: 'row',
            style: { justifyContent: 'space-between', alignItems: 'start' }
          },
            H('div', { style: { flex: '1 1 auto', minWidth: 0 } },
              H('div', { style: { fontWeight: 800 } }, item.title || 'Item for sale'),
              H('div', { className: 'muted listing-description' }, item.description)
            ),
            H('div', {
              style: {
                fontWeight: 800,
                textAlign: 'right',
                color: isFree ? '#16a34a' : '#111',
                flexShrink: 0
              }
            }, price(item.price))
          ),

          H('div', { className: 'muted' }, item.location || 'No location'),

          (showDistance && derivedMeters != null) &&
            H('div', { className: 'distance' }, fmtDistance(derivedMeters) + ' away'),

          H('div', { className: 'muted' },
            'Seller: ',
            renderSellerInfo()
          ),

          H('div', {
            className: 'row',
            style: { marginTop: 8, justifyContent: 'flex-start', gap: 8 }
          }, ...controls)
        ),

        showReport && H(ReportSellerModal, {
          open: showReport,
          listing: item,
          onClose: () => setShowReport(false)
        }),

        showProfilePreview && H(ProfilePreviewModal, {
          sellerInfo: profileData,
          activeListingCount: item.activeListingCount || 0,
          soldListingCount: item.soldListingCount || 0,
          onClose: () => setShowProfilePreview(false),
          onVisitProfile: () => {
            setShowProfilePreview(false);
            onViewSeller?.(item.user_id, item.owner_username);
          },
          onMessage: () => onMessage?.(item),
          onSupporterClick
        }),

        H(ListingGalleryModal, {
          open: galleryOpen,
          images: galleryImages,
          index: galleryIndex,
          onClose: () => setGalleryOpen(false),
          onIndex: setGalleryIndex,
          loading: galleryLoading
        })
      );
    }

    const formatElapsedSince = (input) => {
      if (!input) return null;
      const date = new Date(input);
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
      let diff = Date.now() - date.getTime();
      if (!Number.isFinite(diff) || diff <= 0) return 'just now';
      const units = [
        { label: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
        { label: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
        { label: 'week', ms: 1000 * 60 * 60 * 24 * 7 },
        { label: 'day', ms: 1000 * 60 * 60 * 24 },
        { label: 'hour', ms: 1000 * 60 * 60 },
        { label: 'minute', ms: 1000 * 60 }
      ];
      for (const unit of units) {
        const value = Math.floor(diff / unit.ms);
        if (value >= 1) {
          return `${value} ${unit.label}${value === 1 ? '' : 's'} ago`;
        }
      }
      return 'just now';
    };

    // --- Profile Preview Modal (Discord-like) ---
    function ProfilePreviewModal({ sellerInfo, activeListingCount, soldListingCount, onClose, onVisitProfile, onMessage, onSupporterClick }) {
      if (!sellerInfo) return null;

      const sellerJoinedText = sellerInfo.created_at ? formatElapsedSince(sellerInfo.created_at) : null;
      const sellerSupporter = sellerInfo.supporter_badge
        ? {
            username: sellerInfo.username,
            since: sellerInfo.supporter_since,
            badge: sellerInfo.supporter_badge
          }
        : null;
      const avatarBorderColor = sellerInfo.profile_avatar_border_color || '#ffffff';
      const avatarBorderStyle = sellerInfo.profile_avatar_border_style === 'dashed' ? 'dashed' : 'solid';
      const bgImageUrlSource = sellerInfo.profile_bg_image_url || sellerInfo.profile_bg_video_url;
      const bgImageUrl = typeof bgImageUrlSource === 'string' && bgImageUrlSource.trim()
        ? bgImageUrlSource.trim()
        : null;
      const avatarUrl = typeof sellerInfo.profile_picture_url === 'string' && sellerInfo.profile_picture_url.trim()
        ? sellerInfo.profile_picture_url.trim()
        : null;
      const username = sellerInfo.username || 'Seller';
      const initials = username.trim().slice(0, 1).toUpperCase() || 'S';
      const activeCount = Math.max(0, Number(activeListingCount) || 0);
      const soldCount = Math.max(0, Number(soldListingCount) || 0);
      const karmaValue = Number.isFinite(Number(sellerInfo.karma)) ? Number(sellerInfo.karma) : null;
      const stats = [
        { label: 'Active listings', value: activeCount },
        { label: 'Sold', value: soldCount }
      ];
      if (karmaValue && karmaValue > 0) {
        stats.push({ label: 'Karma', value: karmaValue });
      }
      const avatarSize = 96;
      const avatarOverlap = 34;
      const avatarBorderWidth = 4;
      const sellerAboutText = typeof sellerInfo.profile_about === 'string' && sellerInfo.profile_about.trim()
        ? sellerInfo.profile_about.trim()
        : null;

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const statCard = (stat) => H('div', {
        key: stat.label,
        style: {
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: 14,
          padding: '12px 14px',
          minWidth: 0
        }
      },
        H('div', {
          style: {
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#94a3b8'
          }
        }, stat.label),
        H('div', {
          style: {
            marginTop: 4,
            fontSize: 22,
            fontWeight: 800,
            color: '#f8fafc'
          }
        }, Number.isFinite(stat.value) ? stat.value.toLocaleString() : '0')
      );

      const pillStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        border: '1px solid rgba(148, 163, 184, 0.4)',
        background: 'rgba(51, 65, 85, 0.35)',
        fontSize: 12,
        color: '#cbd5f5',
        fontWeight: 600
      };

      return ReactDOM.createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick,
          style: { background: 'rgba(0, 0, 0, 0.75)', padding: 12 }
        },
          H('div', {
            className: 'modal-inner',
            role: 'dialog',
            'aria-modal': true,
            style: {
              padding: 0,
              width: 'min(420px, 94vw)',
              background: 'transparent',
              borderRadius: 24,
              boxShadow: 'none'
            }
          },
            H('div', {
              style: {
                background: '#0f172a',
                borderRadius: 24,
                color: '#f8fafc',
                overflow: 'auto',
                position: 'relative',
                boxShadow: '0 35px 90px rgba(0, 0, 0, 0.55)',
                fontFamily: 'Inter, system-ui',
                maxHeight: '85vh',
                maxWidth: '600px',
                width: '90vw'
              }
            },
              H('button', {
                type: 'button',
                onClick: () => onClose?.(),
                style: {
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '1px solid rgba(148, 163, 184, 0.4)',
                  background: 'rgba(15, 23, 42, 0.45)',
                  color: '#f8fafc',
                  fontSize: 18,
                  cursor: 'pointer'
                }
              }, '×'),
              H('div', {
                style: {
                  position: 'relative',
                  minHeight: 200,
                  paddingBottom: avatarOverlap + 10
                }
              },
                H('div', {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    borderTopLeftRadius: 24,
                    borderTopRightRadius: 24,
                    background: 'linear-gradient(120deg, #1d1f3b, #3730a3)'
                  }
                },
                  bgImageUrl
                    ? H(ImageWithSkeleton, {
                        key: bgImageUrl,
                        src: bgImageUrl,
                        alt: `${username} banner`,
                        style: {
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }
                      })
                    : H('div', {
                        style: {
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 48,
                          color: 'rgba(248, 250, 252, 0.5)'
                        }
                      }, '🖼️'),
                  H('div', {
                    style: {
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(180deg, rgba(2, 6, 23, 0) 40%, rgba(2, 6, 23, 0.9) 100%)'
                    }
                  })
                ),
                H('div', {
                  style: {
                    position: 'absolute',
                    left: 24,
                    bottom: -avatarOverlap,
                    width: avatarSize,
                    height: avatarSize,
                    borderRadius: '50%',
                    border: `${avatarBorderWidth}px ${avatarBorderColor} ${avatarBorderStyle}`,
                    background: '#0f172a',
                    boxShadow: '0 18px 45px rgba(0, 0, 0, 0.45)',
                    overflow: 'hidden'
                  }
                },
                  avatarUrl
                    ? H('img', {
                        src: avatarUrl,
                        alt: `${username} avatar`,
                        style: { width: '100%', height: '100%', objectFit: 'cover' }
                      })
                    : H('span', {
                        style: {
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 36,
                          fontWeight: 800,
                          color: '#e2e8f0'
                        }
                      }, initials)
                )
              ),
              H('div', {
                style: {
                  padding: `${avatarOverlap + 36}px 24px 26px`,
                  display: 'grid',
                  gap: 18
                }
              },
                H('div', {
                  style: {
                    display: 'grid',
                    gap: 4
                  }
                },
                  H('div', {
                    style: {
                      fontSize: 22,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap'
                    }
                  }, username,
                    sellerSupporter && (() => {
                      const sinceDate = sellerSupporter.since ? new Date(sellerSupporter.since) : null;
                      const now = Date.now();
                      const timeDiff = sinceDate ? now - sinceDate.getTime() : 0;
                      const monthsSince = Math.floor(timeDiff / (1000 * 60 * 60 * 24 * 30));
                      const yearsSince = Math.floor(monthsSince / 12);
                      const remainingMonths = monthsSince % 12;

                      let durationText = '';
                      if (yearsSince > 0) {
                        durationText = yearsSince === 1
                          ? `1 year${remainingMonths > 0 ? ` ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}` : ''}`
                          : `${yearsSince} years${remainingMonths > 0 ? ` ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}` : ''}`;
                      } else {
                        durationText = monthsSince === 1 ? '1 month' : `${monthsSince} months`;
                      }

                      let badgeStyle = {
                        Bronze: { gradient: 'linear-gradient(135deg, #ff6b35, #f7931e, #ffb84d)', glow: 'rgba(255, 107, 53, 0.9)' },
                        Silver: { gradient: 'linear-gradient(135deg, #c0c0c0, #e8e8e8, #d0d0d0)', glow: 'rgba(192, 192, 192, 0.9)' },
                        Gold: { gradient: 'linear-gradient(135deg, #ffd700, #ffed4e, #ffa500)', glow: 'rgba(255, 215, 0, 0.9)' },
                        Platinum: { gradient: 'linear-gradient(135deg, #00bfff, #00d4ff, #00ffff)', glow: 'rgba(0, 212, 255, 0.9)' },
                        Diamond: { gradient: 'linear-gradient(135deg, #b366ff, #d699ff, #e6ccff)', glow: 'rgba(179, 102, 255, 0.9)' },
                        Emerald: { gradient: 'linear-gradient(135deg, #00ff41, #39ff14, #00ff00)', glow: 'rgba(0, 255, 65, 0.9)' },
                        Ruby: { gradient: 'linear-gradient(135deg, #ff1744, #ff5252, #ff6e40)', glow: 'rgba(255, 23, 68, 0.9)' },
                        Opal: { gradient: 'linear-gradient(135deg, #87ceeb, #4fc3f7, #81d4fa)', glow: 'rgba(135, 206, 235, 0.9)' }
                      };

                      let tier = 'Bronze';
                      if (monthsSince >= 72) tier = 'Opal';
                      else if (monthsSince >= 60) tier = 'Ruby';
                      else if (monthsSince >= 36) tier = 'Emerald';
                      else if (monthsSince >= 24) tier = 'Diamond';
                      else if (monthsSince >= 12) tier = 'Platinum';
                      else if (monthsSince >= 6) tier = 'Gold';
                      else if (monthsSince >= 3) tier = 'Silver';

                      const style = badgeStyle[tier];
                      const [showTooltip, setShowTooltip] = React.useState(false);
                      const tooltipText = `${tier} Supporter - ${durationText}`;

                      return H('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', position: 'relative' } },
                        H('div', {
                          style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: style.gradient,
                            border: '1px solid rgba(255, 255, 255, 0.8)',
                            cursor: 'pointer',
                            position: 'relative',
                            fontSize: 12,
                            fontWeight: 900,
                            color: '#fff',
                            textShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
                            boxShadow: `0 0 12px ${style.glow}, 0 0 24px ${style.glow}`,
                            animation: 'badge-shine 2.5s ease-in-out infinite',
                            title: tooltipText,
                            transition: 'transform 0.2s ease',
                            zIndex: 1
                          },
                          onMouseEnter: (e) => {
                            e.target.style.transform = 'scale(1.25)';
                            setShowTooltip(true);
                          },
                          onMouseLeave: (e) => {
                            e.target.style.transform = 'scale(1)';
                            setShowTooltip(false);
                          }
                        },
                          'T'
                        ),
                        showTooltip && H('div', {
                          style: {
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginBottom: 8,
                            background: 'rgba(0, 0, 0, 0.9)',
                            color: '#fff',
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            zIndex: 1000,
                            pointerEvents: 'none',
                            border: `1px solid ${style.glow}`
                          }
                        }, tooltipText)
                      );
                    })()
                  ),
                  sellerJoinedText && H('div', {
                    style: { fontSize: 13, color: '#cbd5f5' }
                  }, `Trovelr since ${sellerJoinedText}`),
                  H('div', {
                    style: {
                      marginTop: 10,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap'
                    }
                  },
                    H('span', { style: pillStyle }, `🛍️ ${activeCount} active`),
                    H('span', { style: pillStyle }, `✅ ${soldCount} sold`)
                  )
                ),
                H('div', {
                  style: {
                    padding: '14px 18px',
                    background: 'rgba(15, 23, 42, 0.7)',
                    borderRadius: 18,
                    border: '1px solid rgba(148, 163, 184, 0.35)'
                  }
                },
                  H('div', { style: { fontSize: 13, color: '#94a3b8', marginBottom: 6, fontWeight: 700 } }, 'About this seller'),
                  H('p', {
                    style: {
                      margin: 0,
                      fontSize: 14,
                      color: '#e2e8f0',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word'
                    }
                  },
                    sellerAboutText
                      ? sellerAboutText
                      : (activeCount > 0
                        ? `Currently listing ${activeCount} ${activeCount === 1 ? 'item' : 'items'} with ${soldCount} sold overall.`
                        : 'No active listings right now, but their sold history speaks for itself.')
                  )
                ),
                H('div', {
                  style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12
                  }
                },
                  H('button', {
                    type: 'button',
                    onClick: () => {
                      onMessage?.();
                      onClose?.();
                    },
                    style: {
                      flex: '1 1 150px',
                      padding: '12px 16px',
                      borderRadius: 14,
                      border: 'none',
                      background: '#5865F2',
                      color: '#fff',
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 10px 25px rgba(88, 101, 242, 0.4)'
                    }
                  }, 'Message'),
                  H('button', {
                    type: 'button',
                    onClick: () => onVisitProfile?.(),
                    style: {
                      flex: '1 1 150px',
                      padding: '12px 16px',
                      borderRadius: 14,
                      border: '1px solid rgba(148, 163, 184, 0.4)',
                      background: 'rgba(15, 23, 42, 0.5)',
                      color: '#f8fafc',
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }
                  }, 'View profile')
                )
              )
            )
          )
        ),
        document.body
      );
    }

    function SellerProfile({ sellerId, sellerUsername, onBack, user, onMessage, onAdminDelete, onSupporterClick }) {
      const [listings, setListings] = useState([]);
      const [loading, setLoading] = useState(true);
      const [selectedListing, setSelectedListing] = useState(null);
      const [error, setError] = useState(null);
      const [tab, setTab] = useState('active');
      const [sellerInfo, setSellerInfo] = useState(null);
      const [coverById, setCoverById] = useState(() => (Object.create(null)));

      useEffect(() => {
        if (!Number.isFinite(Number(sellerId))) {
          setSellerInfo(null);
          return undefined;
        }
        if (!api || typeof api.getUser !== 'function') {
          setSellerInfo(null);
          return undefined;
        }

        let mounted = true;
        setSellerInfo(null);

        (async () => {
          try {
            const info = await api.getUser(sellerId, { silent: true });
            if (!mounted) return;
            if (info && typeof info === 'object') {
              setSellerInfo(info);
            }
          } catch (err) {
            if (!mounted) return;
            console.warn('Failed to load seller info:', err);
            setSellerInfo(null);
          }
        })();

        return () => { mounted = false; };
      }, [api, sellerId]);

      useEffect(() => {
        let mounted = true;

        async function fetchSellerListings() {
          if (!Number.isFinite(Number(sellerId))) {
            setListings([]);
            setError('User not found');
            setLoading(false);
            return;
          }

          try {
            setLoading(true);
            const items = await api.listByUser(sellerId);
            if (!mounted) return;
            const itemsArray = asArray(items);
            setListings(itemsArray);
            setError(null);

            // Batch fetch cover images for first 24 listings
            if (itemsArray.length) {
              try {
                const ids = itemsArray.slice(0, 24).map(r => r.id);
                if (ids.length) {
                  const covers = await api.getCoversBatch(ids, { silent: true });
                  if (!mounted) return;
                  if (Array.isArray(covers) && covers.length) {
                    const patch = {};
                    covers.forEach(r => {
                      if (!r || r.id == null) return;
                      if (r.image_data) patch[r.id] = { url: r.image_data };
                    });
                    if (Object.keys(patch).length) {
                      setCoverById(prev => ({ ...prev, ...patch }));
                    }
                  }
                }
              } catch (coverErr) {
                console.warn('Failed to fetch cover images:', coverErr);
              }
            }
          } catch (err) {
            if (!mounted) return;
            console.error('Failed to fetch seller listings:', err);
            const message = (err && err.message) ? String(err.message) : '';
            if (message.toLowerCase().includes('not found')) {
              setError('User not found');
            } else {
              setError('Failed to load listings');
            }
            setListings([]);
          } finally {
            if (mounted) setLoading(false);
          }
        }

        fetchSellerListings();

        return () => { mounted = false; };
      }, [sellerId]);

      useEffect(() => {
        if (!selectedListing) return undefined;
        const onKey = (evt) => {
          if (evt.key === 'Escape') {
            evt.preventDefault();
            setSelectedListing(null);
          }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [selectedListing]);

      useEffect(() => {
        setTab('active');
      }, [sellerId]);

      const ensureCover = useCallback(async (id) => {
        if (id == null) return;
        if (Object.prototype.hasOwnProperty.call(coverById, id)) return;
        try {
          const arr = await api.getListingImages(id, { silent: true });
          let obj = null;
          if (Array.isArray(arr) && arr.length) {
            obj = typeof arr[0] === 'string'
              ? { url: arr[0], w: null, h: null }
              : { url: arr[0]?.url, w: arr[0]?.w ?? null, h: arr[0]?.h ?? null };
          }
          setCoverById((prev) => ({ ...prev, [id]: obj }));
        } catch {
          setCoverById((prev) => ({ ...prev, [id]: null }));
        }
      }, [coverById, api]);

      const activeListings = useMemo(
        () => listings.filter((item) => !item?.sold),
        [listings]
      );
      const soldListings = useMemo(
        () => listings.filter((item) => !!item?.sold),
        [listings]
      );
      const rawShownListings = tab === 'sold' ? soldListings : activeListings;

      const shownListings = useMemo(() => {
        return (rawShownListings || []).map(it => {
          const cached = coverById[it.id];
          const inline = cached?.url || selectPrimaryListingImage(it, it?.image_data || it?.thumb_url || (Array.isArray(it?.images) ? it.images[0] : null));
          const url = inline || '';
          const ar = (cached?.w && cached?.h) ? (cached.w / cached.h) : 1;
          return { ...it, __cover: url, __ar: ar };
        });
      }, [rawShownListings, coverById]);

      const handleListingSelected = useCallback((item) => {
        if (!item) return;
        const cover = item.image_data || item.__cover || '';
        const inlineImages = collectListingImages(item, cover);
        const payload = { ...item };
        if (inlineImages.length) payload.images = inlineImages;
        if (cover) payload.image_data = cover;
        setSelectedListing(payload);
        if (item.id) {
          const cacheList = inlineImages.length ? inlineImages : null;
          if (cacheList && cacheList.length) {
            listingImageCache.set(item.id, cacheList);
          }
          fetchListingImagesCached(item.id).then((arr) => {
            if (Array.isArray(arr) && arr.length) {
              listingImageCache.set(item.id, arr);
            }
          }).catch(() => {});
        }
      }, []);

      const handleAdminDeleteInternal = useCallback((id) => {
        setListings((prev) => prev.filter((it) => it.id !== id));
        if (typeof onAdminDelete === 'function') {
          onAdminDelete(id);
        }
      }, [onAdminDelete]);

      const modalContent = selectedListing
        ? H('div', {
            className: 'modal open',
            onClick: (evt) => {
              if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
                setSelectedListing(null);
              }
            }
          },
            H('div', { className: 'modal-inner listing-modal' },
              H('button', { className: 'close', onClick: () => setSelectedListing(null) }, 'x'),
              H(ListingCard, {
                item: selectedListing,
                user,
                canEdit: false,
                onMessage: (listing) => {
                  setSelectedListing(null);
                  onMessage?.(listing);
                },
                onAdminDelete: (id) => {
                  handleAdminDeleteInternal(id);
                  setSelectedListing(null);
                },
                showDistance: false,
                onViewSeller: null,
                onSupporterClick,
                viewContext: 'modal'
              })
            )
          )
        : null;

      if (loading) {
        return H('div', { style: { padding: '24px', textAlign: 'center' } },
          H('div', { className: 'spinner' }),
          H('div', { style: { marginTop: '12px' } }, 'Loading seller profile...')
        );
      }

      if (error) {
        return H('div', { style: { padding: '24px', textAlign: 'center' } },
          H('div', { className: 'muted' }, error),
          H('button', { className: 'btn', onClick: onBack }, '<- Back')
        );
      }

      const isMobile = isMobileDevice();
      const gridColumns = isMobile ? 3 : 4;

      const sellerDisplayName = (sellerInfo && sellerInfo.username) || sellerUsername || '';
      const sellerLabel = sellerDisplayName || 'Seller';
      const sellerJoinedText = sellerInfo && sellerInfo.created_at ? formatElapsedSince(sellerInfo.created_at) : null;
      const sellerSupporterSince = sellerInfo?.supporter_since || null;
      const sellerSupporter = sellerInfo?.supporter_badge
        ? {
            username: sellerLabel,
            since: sellerSupporterSince,
            badge: sellerInfo.supporter_badge
          }
        : null;

      const sellerBgImageUrl = (sellerInfo && sellerInfo.profile_bg_image_url) || '';
      const trimmedSellerBgImageUrl = (sellerBgImageUrl || '').trim();
      const hasSellerBgImage = !!trimmedSellerBgImageUrl;
      const sellerAvatarBorderStyleValue = (sellerInfo?.profile_avatar_border_style === 'dashed') ? 'dashed' : 'solid';
      const sellerAvatarBorderColorValue = typeof sellerInfo?.profile_avatar_border_color === 'string' && sellerInfo.profile_avatar_border_color.trim()
        ? sellerInfo.profile_avatar_border_color.trim()
        : '#ffffff';

      const sellerProfileHeaderContent = H('div', { style: { position: 'relative', minHeight: 220, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } },
        H('div', { className: 'row', style: { gap: 12, alignItems: 'center', position: 'absolute', bottom: 16, left: 16 } },
          H('div', {
            style: {
              cursor: 'pointer',
              borderColor: sellerAvatarBorderColorValue,
              borderStyle: sellerAvatarBorderStyleValue,
              borderWidth: 4,
              width: 80,
              height: 80,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
              backgroundColor: '#f0f0f0',
              fontSize: 32,
              fontWeight: 800,
              color: '#666'
            }
          },
            (sellerInfo?.profile_picture_url && sellerInfo.profile_picture_url.trim())
              ? H('img', {
                  src: sellerInfo.profile_picture_url,
                  alt: 'Seller profile picture',
                  style: { width: '100%', height: '100%', objectFit: 'cover' },
                  onError: (e) => { e.target.style.display = 'none'; }
                })
              : (sellerLabel.charAt(0).toUpperCase())
          ),
          H('div', { style: { display: 'grid', gap: 6, alignItems: 'flex-start' } },
            H('div', { style: { fontWeight: 800, fontSize: 18 } }, sellerLabel),
            sellerJoinedText && H('div', { className: 'muted' }, `Trovelr since ${sellerJoinedText}`),
            sellerSupporter && H('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8
              }
            },
              H(SupporterBadge, {
                size: 'sm',
                since: sellerSupporter.since,
                onClick: () => onSupporterClick?.(sellerSupporter)
              })
            ),
            sellerSupporter && typeof sellerInfo?.karma === 'number' && sellerInfo.karma > 0 && H('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'linear-gradient(135deg, #f3f4f6, #e5e7eb)',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                color: '#374151',
                border: '1px solid #d1d5db'
              }
            },
              H('span', { style: { fontSize: 14 } }, '⭐'),
              H('span', null, `${sellerInfo.karma} Karma`)
            )
          )
        ),
        H('div', { className: 'row', style: { gap: 8, alignItems: 'center', flexWrap: 'wrap', position: 'absolute', bottom: 16, right: 16 } },
          H('button', { className: 'btn', onClick: onBack, style: { padding: '8px 16px', fontSize: 14 } }, '<- Back')
        )
      );

      const sellerProfileHeader = H('div', {
        style: {
          position: 'relative',
          height: 220,
          overflow: 'hidden',
          background: hasSellerBgImage ? undefined : '#1a1f2e'
        }
      },
        trimmedSellerBgImageUrl
          ? H('img', {
              key: trimmedSellerBgImageUrl,
              src: trimmedSellerBgImageUrl,
              alt: 'Seller profile banner',
              loading: 'lazy',
              decoding: 'async',
              style: {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }
            })
          : null,
        H('div', {
          style: {
            position: 'absolute',
            inset: 0,
            background: hasSellerBgImage ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.15) 0%, rgba(15, 23, 42, 0.92) 100%)' : undefined
          }
        }),
        H('div', {
          style: {
            position: 'relative',
            height: '100%',
            color: '#f8fafc'
          }
        }, sellerProfileHeaderContent)
      );

      return H(React.Fragment, null,
        H('section', { className: 'card', style: { padding: hasSellerBgImage ? 0 : 16, margin: '12px 0 16px', overflow: hasSellerBgImage ? 'hidden' : undefined, background: hasSellerBgImage ? '#020617' : undefined, color: hasSellerBgImage ? '#f8fafc' : undefined } },
          sellerProfileHeader
        ),

        H('div', { className: 'row', style: { gap: 8, margin: '0 0 16px' } },
          H('button', {
            className: `btn ${tab === 'active' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setTab('active')
          }, 'Active listings'),
          H('button', {
            className: `btn ${tab === 'sold' ? 'primary' : ''}`,
            type: 'button',
            onClick: () => setTab('sold')
          }, 'Sold listings')
        ),

        shownListings.length === 0
          ? H('p', { className: 'muted', style: { textAlign: 'center', margin: '28px 0' } },
              tab === 'sold' ? 'No sold listings yet.' : 'No listings from this seller.')
          : (ListingsGrid
              ? H(ListingsGrid, {
                  items: shownListings,
                  onEnsureCover: ensureCover,
                  onSelect: (evt, item) => handleListingSelected(item),
                  onSupporterClick,
                  columns: gridColumns
                })
              : H('div', { style: { padding: 16, textAlign: 'center' } }, 'Grid component not available')
            ),

        modalContent
      );
    }

    return {
      MultiFilePicker,
      InfoHelpModal,
      AutoListHelpModal,
      AiDescriptionHelpModal,
      ListingForm,
      MassListModal,
      ReportSellerModal,
      ListingModal,
      ListingCard,
      ListingGalleryModal,
      SellerProfile
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.listings = {
    createListingComponents
  };
})();

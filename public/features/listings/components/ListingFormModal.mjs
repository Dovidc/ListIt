import { useListings } from '../ListingsContext.mjs';
import { useUploads } from '../../uploads/UploadsContext.mjs';
import { requireCore } from '../../../utils/core.mjs';
import { isMobileDevice } from '../../../utils/device.mjs';
import { ImageWithSkeleton } from '../../../components/ImageWithSkeleton.mjs';
import {
  AI_IMAGE_LIMIT,
  clearDraftCacheForFile,
  fetchCoordsAndReverse,
  uploadFileDraft,
  uploadFilesForListing,
  useFilePreviews
} from '../utils/drafts.mjs';

const ReactGlobal = typeof React !== 'undefined' ? React : null;
const ReactDOMGlobal = typeof ReactDOM !== 'undefined' ? ReactDOM : null;
const createElement = ReactGlobal?.createElement?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useMemo = ReactGlobal?.useMemo?.bind(ReactGlobal) ?? null;
const useRef = ReactGlobal?.useRef?.bind(ReactGlobal) ?? null;
const useCallback = ReactGlobal?.useCallback?.bind(ReactGlobal) ?? null;
const Fragment = ReactGlobal?.Fragment ?? null;

const { formatCurrency } = requireCore();
const price = (value) => formatCurrency(value ?? 0);

function ensureReact() {
  if (!createElement || !useState || !useEffect || !useRef || !useMemo || !useCallback || !ReactDOMGlobal) {
    throw new Error('Listing form components require React to be loaded globally.');
  }
}

const H = (...args) => createElement(...args);

function MultiFilePicker({ files, onChange }) {
  ensureReact();
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
    const [removed] = next.splice(i, 1);
    if (removed) clearDraftCacheForFile(removed);
    onChange(next);
  }

  return H('div', null,
    H('div', { className: 'row' },
      H('input', { type: 'file', accept: 'image/*', multiple: true, ref, onChange: pick }),
      H('span', { className: 'muted' }, `${(files || []).length} file(s)`)
    ),
    H('div', { className: 'row', style: { flexWrap: 'wrap', gap: 8, marginTop: 8 } },
      ...previews.map(({ url }, i) => H('div', { key: i, style: { position: 'relative' } },
        H(ImageWithSkeleton, {
          src: url,
          style: { width: 96, height: 96, objectFit: 'cover', borderRadius: 12, border: '1px solid #ddd' }
        }),
        H('button', { className: 'btn danger', type: 'button', style: { position: 'absolute', top: 4, right: 4, padding: '4px 8px' }, onClick: () => removeAt(i) }, 'x')
      ))
    )
  );
}

function InfoHelpModal({ title, intro, bullets, footer, onClose }) {
  ensureReact();
  return ReactDOMGlobal.createPortal(
    H('div', {
      className: 'modal open',
      onClick: (e) => { if (e.target.classList.contains('modal')) onClose?.(); },
      style: { background: 'rgba(0,0,0,0.5)' }
    },
      H('div', {
        className: 'modal-inner',
        style: {
          width: 'min(340px, 92vw)',
          background: '#111827',
          color: '#fff',
          borderRadius: 20,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }
      },
        H('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 8
          }
        },
          H('div', { style: { fontWeight: 800, fontSize: 16 } }, title),
          H('button', {
            type: 'button',
            onClick: onClose,
            'aria-label': 'Close',
            style: {
              width: 28, height: 28, borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff', cursor: 'pointer',
              display: 'grid', placeItems: 'center',
              fontSize: 16, lineHeight: '26px'
            }
          }, 'x')
        ),
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
    ),
    document.body
  );
}

function AutoListHelpModal({ onClose }) {
  ensureReact();
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

function AiDescriptionHelpModal({ onClose }) {
  ensureReact();
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


function ListingForm({ api, draft, onCancel, onSaved, autoListEnabled, aiDescriptionEnabled, autoPostNearbyEnabled, backgroundQueueEnabled, enqueueListingJob }) {
  ensureReact();
  const [files, setFiles] = useState([]); // Files to upload to S3
  const [existingUrls, setExistingUrls] = useState([]); // Show current images (editable)

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

  const isMobile = isMobileDevice();

  // Load current images (URLs/base64; new uploads use files[])
  useEffect(() => {
    (async () => {
      if (draft?.id) {
        try { const arr = await api.getListingImages(draft.id); setExistingUrls(arr || []); }
        catch { setExistingUrls([]); }
      } else {
        setExistingUrls([]);
      }
    })();
  }, [draft?.id]);

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
            const upload = await uploadFileDraft(api, file);
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
          (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
          (err) => rej(err),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        )
      );
      const r = await api.reverseGeocode(coords.lat, coords.lon);
      setLocation(r?.display || `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
      setLat(r?.lat ?? coords.lat);
      setLon(r?.lon ?? coords.lon);
    } catch {
      setGeoErr('Could not get your location');
    } finally {
      setGeoBusy(false);
    }
  }

  const [originalUrls, setOriginalUrls] = useState([]);

  useEffect(() => {
    (async () => {
      if (draft?.id) {
        try {
          const arr = await api.getListingImages(draft.id);
          setExistingUrls(arr || []);
          setOriginalUrls(arr || []);
        } catch {
          setExistingUrls([]);
          setOriginalUrls([]);
        }
      } else {
        setExistingUrls([]);
        setOriginalUrls([]);
      }
    })();
  }, [api, draft?.id]);

  // Auto-list: when ON, creating a brand-new listing & user added photos -> AI + create + upload
  useEffect(() => {
    if (!autoListEnabled) return;
    if (draft) return;            // only for new listings
    if (!files || files.length === 0) return;
    if (autoRunning.current) return;

    autoRunning.current = true;

    const runAutoListJob = async () => {
      const uploads = await Promise.all(files.map((file) => uploadFileDraft(api, file)));
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
      let enableNearbyAuto = 0, latAuto = null, lonAuto = null, locAuto = '';
      if (autoPostNearbyEnabled) {
        try {
          const c = await fetchCoordsAndReverse(api);
          enableNearbyAuto = 1;
          latAuto = c.lat; lonAuto = c.lon; locAuto = c.display;
        } catch (_) {
          enableNearbyAuto = 0;
        }
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
  }, [autoListEnabled, autoPostNearbyEnabled, aiDescriptionEnabled, backgroundQueueEnabled, draft, enqueueListingJob, files, onCancel, onSaved, api]); // eslint-disable-line react-hooks/exhaustive-deps

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

      const parsedPrice = Number(priceVal);
      const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

      const basePayload = {
        title: String(title || '').trim(),
        description: String(description || 'No description').trim(),
        location: String(location || '').trim(),
        price: safePrice,
        tags: String(tags || '').trim(),
        enable_nearby: enableNearby ? 1 : 0
      };

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
        if (files.length) await uploadFilesForListing(api, draft.id, files);
        onSaved?.();
        return;
      }

      const filesSnapshot = files.slice();
      const runCreate = async () => {
        const payload = { ...basePayload };
        if (filesSnapshot.length) {
          const uploads = await Promise.all(filesSnapshot.map((file) => uploadFileDraft(api, file)));
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

    H('label', null, 'Location (optional)'),
    H('div', { className:'row', style:{ gap:8 } },
      H('input', { value:location, maxLength:80, onChange:e=>setLocation(e.target.value), placeholder:'Optional (City, State)' }),
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
    H('div', { className:'row', style:{ alignItems:'center', gap:8 } },
      H('input', {
        value:priceVal,
        inputMode:'decimal',
        onChange:e=>setPriceVal(e.target.value.replace(/[^0-9.]/g,'')),
        placeholder:'Leave empty for $0.00'
      }),
      H('span', {
        className:'muted',
        style:{ fontWeight:700, color: isFree ? '#16a34a' : '#6b7280' }
      }, isFree ? price(0) : price(Number(priceVal)))
    ),

    H('div', { className:'card', style:{ padding:12, background:'#fafafa' } },
      H('div', { style:{ fontWeight:600, marginBottom:6 } }, 'Search tags (private, optional)'),
      H('div', { className:'muted', style:{ marginBottom:6 } }, 'Not shown publicly; help others find your item. Example: "car, suv, 4x4".'),
      H('input', { placeholder:'e.g. car, suv, 4x4', value:tags, onChange:e=>setTags(e.target.value) })
    ),

    H('div', { className:'row' },
      H('button', { className:'btn primary', type:'submit', disabled:autoBusy }, draft ? 'Save changes' : 'Create listing'),
      H('button', { className:'btn', type:'button', onClick:onCancel, disabled:autoBusy }, 'Cancel')
    )
  );
}


function CompactListingForm({ api, draft, onCancel, onSaved, autoListEnabled, aiDescriptionEnabled, autoPostNearbyEnabled, backgroundQueueEnabled, enqueueListingJob, showTags, setShowTags }) {
  ensureReact();
  const fileRef = useRef();
  const [files, setFiles] = useState([]);
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

  // File picker handler
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

  // Load current images
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
  }, [api, draft?.id]);

  async function runAI(){
    setAiErr('');
    setAiBusy(true);
    try {
      const sources = [];

      if (files.length) {
        for (const file of files) {
          if (sources.length >= AI_IMAGE_LIMIT) break;
          try {
            const upload = await uploadFileDraft(api, file);
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
      setLocation(r?.display || `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
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
      const uploads = await Promise.all(files.map((file) => uploadFileDraft(api, file)));
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

      let enableNearbyAuto = 0, latAuto = null, lonAuto = null, locAuto = '';
      if (autoPostNearbyEnabled) {
        try {
          const c = await fetchCoordsAndReverse(api);
          enableNearbyAuto = 1;
          latAuto = c.lat; lonAuto = c.lon; locAuto = c.display;
        } catch (_) {
          enableNearbyAuto = 0;
        }
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
  }, [autoListEnabled, autoPostNearbyEnabled, aiDescriptionEnabled, backgroundQueueEnabled, draft, enqueueListingJob, files, onCancel, onSaved, api]);

  async function submit(e){
    e.preventDefault();
    try {
      const totalImages = existingUrls.length + files.length;
      if (totalImages === 0) {
        alert('Please add at least one image.');
        return;
      }

      const parsedPrice = Number(priceVal);
      const safePrice = (Number.isFinite(parsedPrice) && parsedPrice >= 0) ? parsedPrice : 0;

      const basePayload = {
        title: String(title || '').trim(),
        description: String(description || 'No description').trim(),
        location: String(location || '').trim(),
        price: safePrice,
        tags: String(tags || '').trim(),
        enable_nearby: enableNearby ? 1 : 0,
      };

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
        if (files.length) await uploadFilesForListing(api, draft.id, files);
        onSaved?.();
        return;
      }

      const filesSnapshot = files.slice();
      const runCreate = async () => {
        const payload = { ...basePayload };
        if (filesSnapshot.length) {
          const uploads = await Promise.all(filesSnapshot.map((file) => uploadFileDraft(api, file)));
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

  return H('form', { 
    onSubmit: submit, 
    className:'row', 
    style:{
      flexDirection:'column', 
      gap: 5,
      position:'relative'
    }
  },
    autoBusy && H('div', {
      style:{
        position:'absolute', inset:0, background:'rgba(255,255,255,0.85)',
        display:'grid', placeItems:'center', zIndex:5, borderRadius:12
      }
    }, H('div', null, H('div', {className:'spinner'}), H('div', {style:{marginTop:6, fontWeight:700}}, 'Auto-listing...'))),

    // Compact file picker
    H('div', null,
      H('input', { 
        type:'file', 
        accept:'image/*', 
        multiple:true, 
        ref:fileRef, 
        onChange: pickFiles,
        style: { fontSize: '13px' }
      }),
      filePreviews.length > 0 && H('div', { 
        className:'row', 
        style:{ gap:3, flexWrap:'wrap', marginTop:3 } 
      },
        ...filePreviews.map(({ url },i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H(ImageWithSkeleton, {
              src: url,
              style:{ width:44, height:44, objectFit:'cover', borderRadius:6, border:'1px solid #ddd' }
            }),
            H('button', {
              className:'btn danger',
              type:'button',
              style:{ position:'absolute', top:-2, right:-2, padding:'0px 3px', fontSize:9, lineHeight:'12px' }, 
              onClick:()=>removeFile(i) 
            }, 'x')
          )
        )
      )
    ),

    (existingUrls.length > 0) && H('div', null,
      H('div', { className:'muted', style:{ fontSize:11, marginBottom:2 } }, 'Current:'),
      H('div', { className:'row', style:{ gap:3, flexWrap:'wrap' } },
        ...existingUrls.map((src, i) =>
          H('div', { key:i, style:{ position:'relative' } },
            H(ImageWithSkeleton, { src, style:{ width:44, height:44, objectFit:'cover', borderRadius:6, border:'1px solid #ddd' } }),
            H('button', {
              className:'btn danger',
              type:'button',
              style:{ position:'absolute', top:-2, right:-2, padding:'0px 3px', fontSize:9, lineHeight:'12px' }, 
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

    H('button', { 
      type:'button', 
      className:`btn ${aiBusy?'':'primary'}`, 
      disabled:aiBusy, 
      onClick:runAI,
      style: { width: '100%', padding: '8px', fontSize: '13px' }
    }, aiBusy ? 'Analyzing...' : 'Run AI analysis'),

    aiErr && H('span', { className:'muted', style:{ color:'#b91c1c', fontSize:11 } }, aiErr),

    H('input', { 
      value:title, 
      maxLength:80, 
      onChange:e=>setTitle(e.target.value), 
      placeholder:'Title (optional)',
      style: { fontSize: '13px', padding: '7px' }
    }),

    H('textarea', { 
      value:description, 
      maxLength:400, 
      rows: 2,
      onChange:e=>setDescription(e.target.value), 
      placeholder:'Description (optional)',
      style: { fontSize: '13px', padding: '7px', resize: 'none' }
    }),

    H('input', { 
      value:location, 
      maxLength:80, 
      onChange:e=>setLocation(e.target.value), 
      placeholder:'Location (optional)',
      style: { fontSize: '13px', padding: '7px' }
    }),

    H('button', { 
      type:'button', 
      className:'btn', 
      onClick:useMyLocation, 
      disabled:geoBusy, 
      style: { width: '100%', padding: '7px', fontSize: '13px' } 
    }, 
      geoBusy ? 'Locating...' : 'Use my location'
    ),
    geoErr && H('span', { className:'muted', style:{ color:'#b91c1c', fontSize:11 } }, geoErr),

    H('label', {
      className:'toggle-card',
      style:{ marginTop:4, gap:6, alignItems:'flex-start', fontSize:12, padding:'6px 8px' }
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
        H('div', { style:{ fontWeight:700, fontSize:12 } }, 'Enable Nearby searches'),
        H('div', { className:'muted', style:{ fontSize:11 } }, 'Shows distance in feet/miles to buyers.')
      )
    ),

    H('div', { className:'row', style: { alignItems: 'center', gap: 6 } },
      H('input', {
        value:priceVal,
        inputMode:'decimal',
        onChange:e=>setPriceVal(e.target.value.replace(/[^0-9.]/g,'')),
        placeholder:'Price (empty = $0.00)',
        style: { fontSize: '13px', padding: '7px', flex: 1 }
      }),
      isFree && H('span', { style:{ fontSize:11, color:'#16a34a', fontWeight:700 } }, price(0))
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
      placeholder:'e.g. car, suv, 4x4', 
      value:tags, 
      onChange:e=>setTags(e.target.value),
      style: { fontSize: '13px', padding: '7px' }
    }),

    H('div', { className:'row', style: { gap: 6, marginTop: 6 } },
      H('button', { 
        className:'btn primary', 
        type:'submit', 
        disabled:autoBusy, 
        style: { flex: 1, padding: '9px', fontSize: '13px', fontWeight: 600 } 
      }, 
        draft ? 'Save' : 'Create'
      ),
      H('button', { 
        className:'btn', 
        type:'button', 
        onClick:onCancel, 
        disabled:autoBusy, 
        style: { flex: 1, padding: '9px', fontSize: '13px' } 
      }, 
        'Cancel'
      )
    )
  );
}

// Then your existing ListingForm component stays the same...



function ListingFormModal({ backgroundQueueEnabled = true }) {
  ensureReact();
  const { editing, setEditing, refreshListings, api } = useListings();
  const {
    showForm,
    setShowForm,
    autoListEnabled,
    aiDescriptionEnabled,
    autoPostNearbyEnabled,
    enqueueListingJob
  } = useUploads();

  const isMobile = useMemo(() => isMobileDevice(), []);
  const [showTags, setShowTags] = useState(false);

  const handleClose = useCallback(() => {
    setShowForm(false);
    setEditing(null);
    setShowTags(false);
  }, [setShowForm, setEditing]);

  const handleRefresh = useCallback(async () => {
    await refreshListings({ preserveExisting: true });
  }, [refreshListings]);

  const handleSaved = useCallback(() => {
    handleRefresh().catch((err) => console.error('Listing refresh failed:', err));
    handleClose();
  }, [handleRefresh, handleClose]);

  if (!showForm) return null;

  const draft = editing;

  const modal = H('div', {
    className: 'modal open',
    onClick: (e) => { if (e.target.classList.contains('modal')) handleClose(); }
  },
    H('div', {
      className: 'modal-inner',
      style: isMobile ? {
        width: '90vw',
        maxWidth: '380px',
        maxHeight: '80vh',
        background: '#fff',
        borderRadius: 16,
        overflow: 'auto',
        margin: 'auto',
        position: 'relative'
      } : {
        width: 'min(680px, 92vw)',
        background: '#fff',
        borderRadius: 24,
        overflow: 'auto',
        maxHeight: '90vh',
        marginTop: '5vh',
        marginBottom: '5vh'
      }
    },
      H('button', {
        className: 'close',
        onClick: handleClose,
        style: isMobile ? {
          position: 'absolute',
          top: '6px',
          right: '6px',
          zIndex: 10,
          width: '26px',
          height: '26px',
          padding: '0',
          fontSize: '16px',
          lineHeight: '24px',
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(255,255,255,0.9)',
          borderRadius: '13px'
        } : {}
      }, 'x'),

      H('div', { style: { padding: isMobile ? '10px' : '16px' } },
        H('div', { style: {
          fontWeight: 800,
          fontSize: isMobile ? 15 : 18,
          marginBottom: isMobile ? 6 : 12
        } },
          draft ? 'Edit Listing' : 'New Listing'
        ),

        !isMobile && H('div', { className: 'muted', style: { marginBottom: 12 } },
          'Add photos and details for your listing. Only images are required - AI can suggest the rest.'
        ),

        isMobile ? H(CompactListingForm, {
          api,
          draft,
          onCancel: handleClose,
          onSaved: handleSaved,
          autoListEnabled,
          aiDescriptionEnabled,
          autoPostNearbyEnabled,
          backgroundQueueEnabled,
          enqueueListingJob,
          showTags,
          setShowTags
        }) : H(ListingForm, {
          api,
          draft,
          onCancel: handleClose,
          onSaved: handleSaved,
          autoListEnabled,
          aiDescriptionEnabled,
          autoPostNearbyEnabled,
          backgroundQueueEnabled,
          enqueueListingJob
        })
      )
    )
  );

  return ReactDOMGlobal.createPortal(modal, document.body);
}

export { ListingFormModal, AutoListHelpModal, AiDescriptionHelpModal };

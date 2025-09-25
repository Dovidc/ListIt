const ReactGlobal = typeof React !== 'undefined' ? React : null;
const useEffect = ReactGlobal?.useEffect?.bind(ReactGlobal) ?? null;
const useState = ReactGlobal?.useState?.bind(ReactGlobal) ?? null;

export const AI_IMAGE_LIMIT = 8;

export function createConcurrencyLimiter(maxConcurrent = 3) {
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

function ensureReactHooks() {
  if (!useState || !useEffect) {
    throw new Error('Listing draft helpers require React to be loaded globally.');
  }
}

export function useFilePreviews(files = []) {
  ensureReactHooks();
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    if (!files || files.length === 0) {
      setPreviews([]);
      return;
    }

    const entries = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(entries);

    return () => {
      for (const entry of entries) {
        try {
          URL.revokeObjectURL(entry.url);
        } catch {}
      }
    };
  }, [files]);

  return previews;
}

const uploadDraftCache = new WeakMap();
const s3UploadLimiter = createConcurrencyLimiter(3);

export function clearDraftCacheForFile(file) {
  if (uploadDraftCache.has(file)) {
    uploadDraftCache.delete(file);
  }
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

export async function uploadFileDraft(api, file) {
  if (!file) throw new Error('file_required');
  if (!api || typeof api.signUpload !== 'function' || typeof api.finalizeUpload !== 'function') {
    throw new Error('Uploads API is unavailable.');
  }

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

export async function uploadFilesForListing(api, listingId, files = []) {
  if (!api || typeof api.signUpload !== 'function' || typeof api.finalizeUpload !== 'function') {
    throw new Error('Uploads API is unavailable.');
  }

  const uploaded = [];
  for (const file of files || []) {
    if (!(file instanceof File)) continue;
    const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
    if (sig?.error) throw new Error(sig.error);
    if (!sig?.uploadUrl || !sig?.Key) throw new Error('invalid_presign');

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

    uploaded.push(sig.publicUrl);
  }

  return uploaded;
}

export async function filesToDataUrls(files = []) {
  async function toB64(file) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  }

  const out = [];
  for (const f of (files || []).slice(0, AI_IMAGE_LIMIT)) {
    out.push(await toB64(f));
  }
  return out;
}

export async function fileToDataUrl(file) {
  const arr = await filesToDataUrls([file]);
  return arr && arr[0];
}

export async function fetchCoordsAndReverse(api) {
  if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
  const { coords } = await new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000
    })
  );

  if (!api || typeof api.reverseGeocode !== 'function') {
    return {
      lat: coords.latitude,
      lon: coords.longitude,
      display: `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
    };
  }

  try {
    const r = await api.reverseGeocode(coords.latitude, coords.longitude);
    return {
      lat: r?.lat ?? coords.latitude,
      lon: r?.lon ?? coords.longitude,
      display: r?.display || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
    };
  } catch {
    return {
      lat: coords.latitude,
      lon: coords.longitude,
      display: `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
    };
  }
}

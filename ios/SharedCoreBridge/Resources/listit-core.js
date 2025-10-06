(() => {
  const exports = {};
  class ApiError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ApiError';
      this.responseText = undefined;
    }
  }
  
  function resolveFetch(fetchImpl) {
    const impl = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!impl) {
      throw new Error('A fetch implementation must be provided to createApiClient.');
    }
    return impl;
  }
  
  function createApiClient(options = {}) {
    const {
      baseUrl = '',
      fetchImpl,
      onRequestEnd,
      onRequestStart,
      onUnauthorized,
      onAccountLocked
    } = options;
  
    const fetchLike = resolveFetch(fetchImpl);
  
    const resolveUrl = (path) => {
      if (/^https?:/i.test(path)) return path;
      if (baseUrl) return `${baseUrl}${path}`;
      return path;
    };
  
    const request = async (path, init = {}, meta = {}) => {
      const silent = !!meta.silent;
      if (!silent) onRequestStart?.();
  
      try {
        const requestInit = { credentials: 'include', ...init };
        if (meta.priority) {
          requestInit.priority = meta.priority;
        }
  
        const response = await fetchLike(resolveUrl(path), requestInit);
  
        if (response.status === 401) {
          onUnauthorized?.();
          throw new ApiError('auth');
        }
  
        if (response.status === 423) {
          try {
            await response.json();
          } catch {
            // ignore
          }
          onAccountLocked?.();
          throw new ApiError('account_locked');
        }
  
        if (!response.ok) {
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
  
          const message = payload && typeof payload === 'object' && payload.error ? payload.error : 'request_failed';
          if (message === 'account_locked') {
            onAccountLocked?.();
          }
  
          throw new ApiError(message);
        }
  
        const text = await response.text();
        if (!text) return null;
  
        try {
          return JSON.parse(text);
        } catch (err) {
          const parseError = new ApiError('invalid_json');
          parseError.cause = err instanceof Error ? err : undefined;
          parseError.responseText = text;
          throw parseError;
        }
      } finally {
        if (!silent) onRequestEnd?.();
      }
    };
  
    const me = (meta) => request('/api/me', { method: 'GET' }, meta);
  
    const login = (email, password, meta) => request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }, meta);
  
    const register = (payload, meta) => request('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, meta);
  
    const logout = async (meta) => {
      try {
        await request('/api/logout', { method: 'POST' }, meta);
      } catch (error) {
        if (error instanceof ApiError && error.message === 'auth') {
          return;
        }
        throw error;
      }
    };
  
    const pushSubscribe = (subscription, meta) => {
      if (!subscription) return Promise.resolve(null);
      return request('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      }, meta);
    };
  
    const pushUnsubscribe = (subscription, meta) => {
      if (!subscription) return Promise.resolve(null);
      return request('/api/push/unsubscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      }, meta);
    };
  
    const updatePaypalEmail = (paypalEmail, meta) => request('/api/me/paypal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paypal_email: paypalEmail })
    }, meta);
  
    const listAll = (a, b, meta) => {
      let q = '';
      let loc = '';
      let page = 1;
      let limit = 75;
      let sort = 'new';
      let cursor = null;
      let metaArg = meta;
  
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        const params = a;
        q = typeof params.q === 'string' ? params.q : '';
        loc = typeof params.loc === 'string' ? params.loc : '';
        page = Number(params.page) || 1;
        limit = Number(params.limit) || 75;
        sort = typeof params.sort === 'string' ? params.sort : 'new';
        cursor = params.cursor != null ? params.cursor : null;
        metaArg = b || meta;
      } else {
        q = typeof a === 'string' ? a : '';
        loc = typeof b === 'string' ? b : '';
      }
  
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (loc) params.set('loc', loc);
      params.set('noimg', '1');
      if (cursor != null) params.set('cursor', String(cursor));
      else params.set('page', String(page));
      params.set('limit', String(limit));
      params.set('sort', sort);
      const query = params.toString();
      const url = '/api/listings' + (query ? `?${query}` : '');
      return request(url, { method: 'GET' }, metaArg);
    };
  
    const listListings = (params = {}, meta) => listAll(params, meta);
  
    const listByUser = (userId, meta) => request(`/api/users/${userId}/listings`, { method: 'GET' }, meta);
  
    const listMine = (meta) => request('/api/listings?mine=1', { method: 'GET' }, meta);
  
    const createListing = (payload, meta) => request('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, meta);
  
    const updateListing = (id, payload, meta) => request(`/api/listings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, meta);
  
    const markListingSold = (id, sold, meta) => updateListing(id, { sold: !!sold }, meta);
  
    const deleteListing = (id, meta) => request(`/api/listings/${id}`, { method: 'DELETE' }, meta);
  
    const adminDeleteListing = (id, meta) => request(`/api/admin/listings/${id}`, { method: 'DELETE' }, meta);
  
    const adminDeleteAll = (meta) => request('/api/admin/listings', { method: 'DELETE' }, meta);
  
    const adminSeedListings = (payload = {}, meta) => request('/api/admin/listings/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, meta);
  
    const adminDeleteSeedListings = (meta) => request('/api/admin/listings/seed', { method: 'DELETE' }, meta);
  
    const listAds = (meta) => request('/api/ads', { method: 'GET' }, meta);
  
    const adminListFlagged = (meta) => request('/api/admin/flagged', { method: 'GET' }, meta);
  
    const adminDeleteFlagged = (id, meta) => request(`/api/admin/flagged/${id}`, { method: 'DELETE' }, meta);
  
    const adminListAds = (meta) => request('/api/admin/ads', { method: 'GET' }, meta);
  
    const adminCreateAd = (payload, meta) => request('/api/admin/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, meta);
  
    const adminUpdateAd = (id, payload, meta) => request(`/api/admin/ads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, meta);
  
    const adminDeleteAd = (id, meta) => request(`/api/admin/ads/${id}`, { method: 'DELETE' }, meta);
  
    const searchCities = (q, meta) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const query = params.toString();
      const url = '/api/cities' + (query ? `?${query}` : '');
      const effectiveMeta = { ...(meta || {}), silent: true };
      return request(url, { method: 'GET' }, effectiveMeta);
    };
  
    const ensureConversation = (payload, meta) => request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, meta);
  
    const listConversations = (meta) => request('/api/conversations', { method: 'GET' }, meta);
  
    const getMessages = (id, meta) => request(`/api/conversations/${id}/messages`, { method: 'GET' }, meta);
  
    const sendMessage = (id, body, images, meta) => request(`/api/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, images })
    }, meta);
  
    const deleteConversation = (id, meta) => request(`/api/conversations/${id}`, { method: 'DELETE' }, meta);
  
    const getListingImages = (id, meta) => request(`/api/listings/${id}/images`, { method: 'GET' }, meta);
  
    const getCoversBatch = (ids = [], meta) => {
      const normalized = Array.from(new Set((ids || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)))).slice(0, 200);
      if (!normalized.length) return Promise.resolve([]);
      const url = `/api/listings/covers?ids=${encodeURIComponent(normalized.join(','))}`;
      return request(url, { method: 'GET' }, meta);
    };
  
    const aiAnalyze = ({ images, hint }, meta) => request('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, hint })
    }, meta);
  
    const reverseGeocode = (lat, lon, meta) => request(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { method: 'GET' }, meta);
  
    const listNearby = (lat, lon, radiusMeters = 150, meta) => {
      const url = `/api/listings/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius_m=${encodeURIComponent(radiusMeters)}`;
      return request(url, { method: 'GET' }, meta);
    };
  
    const reportSeller = (payload, meta) => request('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, meta);
  
    const adminSearchUsers = (params = {}, meta) => {
      const searchParams = new URLSearchParams();
      const q = params.q ?? params.query ?? '';
      const limit = params.limit;
      if (q) searchParams.set('q', String(q));
      if (limit) searchParams.set('limit', String(limit));
      const query = searchParams.toString();
      const url = '/api/admin/users/search' + (query ? `?${query}` : '');
      return request(url, { method: 'GET' }, meta);
    };
  
    const adminGetUser = (id, meta) => {
      if (!Number.isFinite(Number(id))) return Promise.reject(new ApiError('invalid_user'));
      return request(`/api/admin/users/${id}`, { method: 'GET' }, meta);
    };
  
    const adminGetUserReports = (id, params = {}, meta) => {
      if (!Number.isFinite(Number(id))) return Promise.reject(new ApiError('invalid_user'));
      const searchParams = new URLSearchParams();
      if (params.limit) searchParams.set('limit', String(params.limit));
      const query = searchParams.toString();
      const url = `/api/admin/users/${id}/reports` + (query ? `?${query}` : '');
      return request(url, { method: 'GET' }, meta);
    };
  
    const adminUpdateUserStatus = (id, payload = {}, meta) => {
      if (!Number.isFinite(Number(id))) return Promise.reject(new ApiError('invalid_user'));
      return request(`/api/admin/users/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      }, meta);
    };
  
    const adminTopReports = (params = {}, meta) => {
      const searchParams = new URLSearchParams();
      if (Number.isFinite(Number(params.limit))) searchParams.set('limit', String(params.limit));
      if (Number.isFinite(Number(params.days))) searchParams.set('days', String(params.days));
      if (Number.isFinite(Number(params.min))) searchParams.set('min', String(params.min));
      const query = searchParams.toString();
      const url = '/api/admin/reports/top' + (query ? `?${query}` : '');
      return request(url, { method: 'GET' }, meta);
    };
  
    const adminClearUserReports = (id, payload = {}, meta) => {
      if (!Number.isFinite(Number(id))) return Promise.reject(new ApiError('invalid_user'));
      return request(`/api/admin/users/${id}/reports/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      }, meta);
    };
  
    const signUpload = ({ filename, contentType, bytes }, meta) => request('/api/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentType, bytes })
    }, meta);
  
    const finalizeUpload = ({ listingId, key, url, width, height, bytes }, meta) => {
      const payload = {};
      if (listingId != null) payload.listingId = listingId;
      if (key != null) payload.key = key;
      if (url != null) payload.url = url;
      if (width != null) payload.width = width;
      if (height != null) payload.height = height;
      if (bytes != null) payload.bytes = bytes;
      return request('/api/uploads/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, meta);
    };
  
    return {
      request,
      me,
      login,
      register,
      logout,
      pushSubscribe,
      pushUnsubscribe,
      updatePaypalEmail,
      listAll,
      listListings,
      listByUser,
      listMine,
      createListing,
      updateListing,
      markListingSold,
      deleteListing,
      adminDeleteListing,
      adminDeleteAll,
      adminSeedListings,
      adminDeleteSeedListings,
      listAds,
      adminListFlagged,
      adminDeleteFlagged,
      adminListAds,
      adminCreateAd,
      adminUpdateAd,
      adminDeleteAd,
      searchCities,
      ensureConversation,
      listConversations,
      getMessages,
      sendMessage,
      deleteConversation,
      getListingImages,
      getCoversBatch,
      aiAnalyze,
      reverseGeocode,
      listNearby,
      reportSeller,
      adminSearchUsers,
      adminGetUser,
      adminGetUserReports,
      adminUpdateUserStatus,
      adminTopReports,
      adminClearUserReports,
      signUpload,
      finalizeUpload
    };
  }
  
  const formatCurrency = (value, currency = 'USD') => {
    const amount = Number(value ?? 0);
    return amount.toLocaleString(undefined, { style: 'currency', currency });
  };
  
  const formatDistance = (meters) => {
    if (!Number.isFinite(Number(meters))) return '';
    const distance = Number(meters);
    if (distance < 1609.344 * 0.3) {
      const feet = distance * 3.28084;
      if (feet < 1000) return `${Math.round(feet)} ft`;
      return `${Math.round(feet / 100) / 10}k ft`;
    }
    const miles = distance / 1609.344;
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
  };
  
  const TO_RAD = Math.PI / 180;
  
  const haversineMeters = (aLat, aLon, bLat, bLon) => {
    const R = 6371000;
    const dLat = (bLat - aLat) * TO_RAD;
    const dLon = (bLon - aLon) * TO_RAD;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s1 * s1 + Math.cos(aLat * TO_RAD) * Math.cos(bLat * TO_RAD) * s2 * s2));
  };
  
  const isRecord = (value) => !!value && typeof value === 'object';
  
  const normalizeListingsResponse = (res, limit = 75) => {
    let rows = [];
    if (Array.isArray(res)) rows = res;
    else if (isRecord(res)) {
      if (Array.isArray(res.rows)) rows = res.rows;
      else if (Array.isArray(res.items)) rows = res.items;
      else if (Array.isArray(res.listings)) rows = res.listings;
      else if (Array.isArray(res.data)) rows = res.data;
    }
  
    let hasNext = false;
    let nextCursor = null;
  
    if (isRecord(res)) {
      if (typeof res.hasNext === 'boolean') hasNext = res.hasNext;
      else if (typeof res.next === 'boolean') hasNext = res.next;
      else if (Number.isFinite(res.total) && Number.isFinite(res.page)) {
        const shown = (res.page - 1) * limit + rows.length;
        hasNext = shown < res.total;
      } else {
        hasNext = rows.length === limit;
      }
  
      if (res.next_cursor != null) nextCursor = res.next_cursor;
      else if (res.cursor != null) nextCursor = res.cursor;
    } else {
      hasNext = rows.length === limit;
    }
  
    return { rows, hasNext, nextCursor };
  };
  
  const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (isRecord(value) && (Array.isArray(value.rows) || Array.isArray(value.items) || Array.isArray(value.listings) || Array.isArray(value.data))) {
      return normalizeListingsResponse(value).rows;
    }
    return [];
  };
  
  const toListingId = (value) => {
    if (value == null) return '';
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'object' && value !== null) {
      if (typeof value.id === 'string' || typeof value.id === 'number') return toListingId(value.id);
      if (typeof value.listing_id === 'string' || typeof value.listing_id === 'number') return toListingId(value.listing_id);
      if (typeof value.uuid === 'string') return value.uuid.trim();
    }
    return '';
  };
  
  const cleanString = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed || '';
  };
  
  const extractPriceValue = (value) => {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.-]+/g, '');
      const numeric = Number(cleaned);
      if (Number.isFinite(numeric)) return numeric;
      return null;
    }
    return null;
  };
  
  const formatListingPrice = (value, formatFn = formatCurrency) => {
    const price = extractPriceValue(value);
    if (price == null) return '';
    try {
      return formatFn(price);
    } catch {
      return '';
    }
  };
  
  const resolveLocationLabel = (listing) => {
    if (!listing || typeof listing !== 'object') return '';
    const candidates = [listing.city, listing.location, listing.region, listing.area, listing.locale];
    for (const candidate of candidates) {
      const value = cleanString(candidate);
      if (value) return value;
    }
    return '';
  };
  
  const toListingSummary = (listing, { formatPrice = formatListingPrice } = {}) => {
    if (!isRecord(listing)) return null;
    const id = toListingId(listing);
    if (!id) return null;
    const title = cleanString(listing.title || listing.name || listing.headline || '');
    const priceLabel = formatPrice(listing.price ?? listing.price_cents ?? listing.amount ?? listing.cost);
    const locationLabel = resolveLocationLabel(listing);
    const subtitleParts = [];
    if (priceLabel) subtitleParts.push(priceLabel);
    if (locationLabel) subtitleParts.push(locationLabel);
    const subtitle = subtitleParts.join(' • ');
    const priceValue = extractPriceValue(listing.price ?? listing.price_cents ?? listing.amount ?? listing.cost);
  
    return {
      id,
      title: title || 'Untitled',
      subtitle,
      price: priceValue,
      location: locationLabel || null,
      raw: listing
    };
  };
  
  function createListingsService({ api, pageSize = 25, formatPrice } = {}) {
    if (!api || typeof api.listAll !== 'function') {
      throw new Error('Listings service requires an API client.');
    }
  
    const resolveLimit = (limit) => {
      if (Number.isFinite(limit) && limit > 0) return Math.floor(limit);
      return pageSize;
    };
  
    const normalize = (res, limit) => normalizeListingsResponse(res, resolveLimit(limit));
  
    const fetchSummaries = async (params = {}, meta) => {
      const { query = '', location = '', cursor = null, limit = pageSize, sort = 'new' } = params || {};
      const requestPayload = {};
      const q = cleanString(query);
      const loc = cleanString(location);
      const resolvedLimit = resolveLimit(limit);
  
      if (q) requestPayload.q = q;
      if (loc) requestPayload.loc = loc;
      if (cursor != null && cursor !== '') requestPayload.cursor = cursor;
      if (resolvedLimit) requestPayload.limit = resolvedLimit;
      if (sort) requestPayload.sort = sort;
  
      const response = await api.listAll(requestPayload, meta);
      const normalized = normalize(response, resolvedLimit);
      const items = normalized.rows
        .map((row) => toListingSummary(row, { formatPrice }))
        .filter(Boolean);
  
      return {
        rows: normalized.rows,
        items,
        hasNext: normalized.hasNext,
        nextCursor: normalized.nextCursor
      };
    };
  
    return {
      fetch: fetchSummaries,
      fetchSummaries,
      toSummary: (listing) => toListingSummary(listing, { formatPrice }),
      normalize
    };
  }
  
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  
  const ensureString = (value, key) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    throw new ApiError(`${key}_required`);
  };
  
  const toTimestamp = (value) => {
    if (value == null) return null;
    if (value instanceof Date) return Math.floor(value.getTime() / 1000);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
    }
    return null;
  };
  
  const extractTokensFromResponse = (response) => {
    if (!isRecord(response)) return null;
    const token = cleanString(response.token || response.accessToken || response.access_token || '');
    if (!token) return null;
    const refreshToken = cleanString(response.refreshToken || response.refresh_token || '');
    const expiresAt = toTimestamp(response.expiresAt ?? response.expires_at ?? null);
    return {
      token,
      accessToken: token,
      refreshToken: refreshToken || null,
      expiresAt
    };
  };
  
  function createAuthService({ api } = {}) {
    if (!api || typeof api.login !== 'function' || typeof api.logout !== 'function') {
      throw new Error('Auth service requires an API client.');
    }
  
    const validateCredentials = (input = {}) => {
      const email = ensureString(input.email, 'email');
      if (!EMAIL_PATTERN.test(email)) {
        const error = new ApiError('email_invalid');
        error.field = 'email';
        throw error;
      }
  
      const password = ensureString(input.password, 'password');
      return { email, password };
    };
  
    const signIn = async (credentials = {}, meta) => {
      const { email, password } = validateCredentials(credentials);
      const response = await api.login(email, password, meta);
      const tokens = extractTokensFromResponse(response);
      const user = isRecord(response) ? { ...response } : null;
      return { user, tokens, raw: response };
    };
  
    const signOut = async (meta) => {
      await api.logout(meta);
    };
  
    return {
      validateCredentials,
      signIn,
      signOut,
      extractTokens: extractTokensFromResponse
    };
  }
  
  const BASE64_PREFIX = /^data:[^;]+;base64,/i;
  
  const decodeBase64ToUint8Array = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(BASE64_PREFIX, '').trim();
    if (!normalized) return null;
    if (typeof atob === 'function') {
      const binary = atob(normalized);
      const length = binary.length;
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(normalized, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    throw new Error('base64_unsupported');
  };
  
  const detectImageContentType = (bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) return 'application/octet-stream';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    return 'application/octet-stream';
  };
  
  const readPngDimensions = (bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.length < 24) return { width: null, height: null };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { width, height };
  };
  
  const readJpegDimensions = (bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) return { width: null, height: null };
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (!marker || marker === 0xD8 || marker === 0xD9) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if (!length || length < 2) break;
      if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
        const height = (bytes[offset + 5] << 8) + bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
        return { width, height };
      }
      offset += length + 2;
    }
    return { width: null, height: null };
  };
  
  const readImageDimensions = (bytes, contentType) => {
    const type = contentType || detectImageContentType(bytes);
    if (type === 'image/png') return readPngDimensions(bytes);
    if (type === 'image/jpeg') return readJpegDimensions(bytes);
    return { width: null, height: null };
  };
  
  const createDefaultUploadsUtils = () => ({
    async measureImageFile() {
      return { width: null, height: null };
    },
    dedupeImageUrls(urls) {
      const seen = new Set();
      const result = [];
      (Array.isArray(urls) ? urls : []).forEach((url) => {
        const value = cleanString(url);
        if (!value || seen.has(value)) return;
        seen.add(value);
        result.push(value);
      });
      return result;
    },
    collectListingImages() {
      return [];
    }
  });
  
  function createUploadsService({ api, utils, fetchImpl } = {}) {
    if (!api) {
      throw new Error('Uploads service requires an API client.');
    }
  
    const helpers = utils || createDefaultUploadsUtils();
    const {
      measureImageFile,
      dedupeImageUrls,
      collectListingImages
    } = helpers;
  
    if (typeof measureImageFile !== 'function') {
      throw new Error('Uploads service requires utils.measureImageFile.');
    }
    if (typeof dedupeImageUrls !== 'function') {
      throw new Error('Uploads service requires utils.dedupeImageUrls.');
    }
    if (typeof collectListingImages !== 'function') {
      throw new Error('Uploads service requires utils.collectListingImages.');
    }
  
    const fetchLike = resolveFetch(fetchImpl);
  
    const uploadDraftCache = new WeakMap();
    const listingImageCache = new Map();
    const listingImageInFlight = new Map();
  
    function createConcurrencyLimiter(maxConcurrent = 3) {
      const limit = Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? Math.floor(maxConcurrent) : 1;
      let active = 0;
      const queue = [];
  
      const runNext = () => {
        if (active >= limit) return;
        const job = queue.shift();
        if (!job) return;
        const { fn, resolve, reject } = job;
        active += 1;
        let finished = false;
  
        const finalize = () => {
          if (finished) return;
          finished = true;
          active -= 1;
          runNext();
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
        } catch (error) {
          finalize();
          reject(error);
        }
      };
  
      return (fn) => new Promise((resolve, reject) => {
        if (typeof fn !== 'function') {
          reject(new TypeError('Limiter expects a function'));
          return;
        }
        queue.push({ fn, resolve, reject });
        runNext();
      });
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
  
          const putRes = await fetchLike(sig.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
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
      if (!isRecord(listing)) {
        return { payload: null, images: [], cover: '' };
      }
  
      const candidateSources = [];
      if (typeof coverHint === 'string') candidateSources.push(coverHint);
      if (typeof listing.image_data === 'string') candidateSources.push(listing.image_data);
      if (typeof listing.__cover === 'string') candidateSources.push(listing.__cover);
      if (typeof listing.thumb_url === 'string') candidateSources.push(listing.thumb_url);
  
      let cover = '';
      for (const src of candidateSources) {
        const value = cleanString(src);
        if (value) {
          cover = value;
          break;
        }
      }
  
      const payload = { ...listing };
      if (cover) payload.image_data = cover;
  
      const inline = collectListingImages(payload, cover);
      if (inline.length && listing?.id != null) {
        listingImageCache.set(listing.id, inline);
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
  
    async function uploadFilesForListing(listingId, files) {
      const arr = Array.from(files || []);
      for (const file of arr) {
        await uploadFileDraft(file);
        await s3UploadLimiter(async () => {
          const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
          if (sig?.error) throw new Error(sig.error);
          const putRes = await fetchLike(sig.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
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
        });
      }
    }
  
    async function uploadOneMessageImage(conversationIdOrFile, maybeFile) {
      let conversationId = conversationIdOrFile;
      let file = maybeFile;
  
      if (!file && conversationIdOrFile && typeof conversationIdOrFile === 'object') {
        const possibleFile = conversationIdOrFile;
        const hasName = typeof possibleFile.name === 'string';
        const hasSize = typeof possibleFile.size === 'number';
        const hasType = typeof possibleFile.type === 'string' || typeof possibleFile.type === 'undefined';
  
        if (hasName && hasSize && hasType) {
          file = possibleFile;
          conversationId = null;
        }
      }
  
      if (!file) throw new Error('file_required');
  
      conversationId = conversationId ?? null;
      const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
      if (sig?.error) throw new Error(sig.error);
      const putRes = await fetchLike(sig.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('s3_put_failed');
  
      const dims = await measureImageFile(file);
  
      return api.finalizeUpload({
        listingId: null,
        conversationId,
        key: sig.Key,
        url: sig.publicUrl,
        width: dims.width,
        height: dims.height,
        bytes: file.size
      });
    }
  
    async function uploadBase64Image(data, options = {}) {
      const bytes = decodeBase64ToUint8Array(data);
      if (!bytes || !bytes.length) throw new Error('invalid_base64');
      const contentType = options.contentType || detectImageContentType(bytes);
      const filename = options.filename || (contentType === 'image/png' ? 'upload.png' : 'upload.jpg');
      const size = bytes.byteLength;
  
      const sig = await api.signUpload({ filename, contentType, bytes: size });
      if (sig?.error) throw new Error(sig.error);
      if (!sig?.uploadUrl || !sig?.publicUrl || !sig?.Key) throw new Error('invalid_presign');
  
      const putRes = await fetchLike(sig.uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': contentType } });
      if (!putRes.ok) throw new Error('s3_put_failed');
  
      const dims = readImageDimensions(bytes, contentType);
  
      const finalizeRes = await api.finalizeUpload({
        listingId: options.listingId ?? null,
        key: sig.Key,
        url: sig.publicUrl,
        width: dims.width,
        height: dims.height,
        bytes: size
      }, { silent: true, ...(options.meta || {}) });

      if (finalizeRes?.error) throw new Error(finalizeRes.error);
      return finalizeRes;
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
      listingImageInFlight,
      uploadBase64Image
    };
  }
  
  function createCoreEnvironment(options = {}) {
    const envFn = typeof options.env === 'function'
      ? options.env
      : (key) => {
          if (options.env && typeof options.env === 'object' && options.env !== null && key in options.env) {
            return options.env[key];
          }
          if (typeof NativeBridge !== 'undefined' && typeof NativeBridge.fetchEnv === 'function') {
            return NativeBridge.fetchEnv(key);
          }
          if (typeof process !== 'undefined' && process.env) {
            return process.env[key];
          }
          return undefined;
        };
  
    const fetchLike = options.fetch ?? options.fetchImpl;
    const api = options.api || createApiClient({
      baseUrl: options.baseUrl ?? envFn('API_BASE_URL') ?? '',
      fetchImpl: fetchLike
    });
  
    const helpers = {
      normalizeListingsResponse,
      asArray,
      formatCurrency,
      formatDistance,
      haversineMeters
    };
  
    const auth = createAuthService({ api });
    const listings = createListingsService({ api, pageSize: options.pageSize });
    const uploads = createUploadsService({ api, utils: options.uploadsUtils, fetchImpl: fetchLike });
  
    return { api, auth, listings, uploads, helpers };
  }
  
  function installNativeBindings(options = {}) {
    const logger = options.logger || globalThis?.NativeBridge || null;
    const log = typeof logger?.log === 'function' ? logger.log.bind(logger) : () => {};
  
    const core = createCoreEnvironment(options);
    if (options.expose === false || typeof globalThis === 'undefined') {
      return core;
    }
  
    const { auth, listings, uploads, helpers } = core;
    const api = core.api;
  
    const namespace = typeof globalThis.ListItCore === 'object' && globalThis.ListItCore
      ? globalThis.ListItCore
      : (globalThis.ListItCore = {});
  
    try {
      Object.assign(namespace, {
        core,
        api: core.api,
        auth,
        listings,
        uploads,
        helpers: core.helpers
      });
    } catch (error) {
      log(`Failed to augment ListItCore namespace: ${error?.message || error}`);
    }
  
    globalThis.auth_signIn = (payload) => {
      try {
        const promise = auth.signIn(payload || {});
        return Promise.resolve(promise).then((result) => {
          if (result?.tokens) {
            const output = {
              token: result.tokens.accessToken || result.tokens.token
            };
            if (result.tokens.refreshToken != null) output.refreshToken = result.tokens.refreshToken;
            if (result.tokens.expiresAt != null) output.expiresAt = result.tokens.expiresAt;
            return output;
          }
          return !!result?.user;
        }).catch((error) => {
          if (error instanceof ApiError && error.message === 'auth') {
            return false;
          }
          throw error;
        });
      } catch (error) {
        log(`auth_signIn failed: ${error?.message || error}`);
        return false;
      }
    };
  
    globalThis.listings_fetch = (params) => {
      try {
        return Promise.resolve(listings.fetchSummaries(params || {})).then((items) => (
          items.map((item) => ({
            id: item.id,
            title: item.title,
            subtitle: item.subtitle
          }))
        ));
      } catch (error) {
        log(`listings_fetch failed: ${error?.message || error}`);
        return [];
      }
    };

    const coerceString = (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      return null;
    };

    const coerceNumber = (value) => {
      const numeric = toNumber(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    const normalizeGalleryForNative = (raw) => {
      if (!isRecord(raw)) return [];
      const sources = [];
      if (Array.isArray(raw.images)) sources.push(...raw.images);
      if (Array.isArray(raw.gallery)) sources.push(...raw.gallery);
      if (Array.isArray(raw.photos)) sources.push(...raw.photos);
      return sources
        .map((entry) => {
          if (typeof entry === 'string') {
            const url = coerceString(entry);
            return url ? { url, width: null, height: null } : null;
          }
          if (!isRecord(entry)) return null;
          const url = coerceString(entry.url || entry.image || entry.image_data || entry.src || entry.thumb_url);
          if (!url) return null;
          const width = coerceNumber(entry.width ?? entry.w);
          const height = coerceNumber(entry.height ?? entry.h);
          return { url, width, height };
        })
        .filter(Boolean);
    };

    const deriveSellerName = (raw) => (
      coerceString(
        raw?.owner_name ||
        raw?.owner_username ||
        raw?.owner?.name ||
        raw?.owner?.username ||
        raw?.seller ||
        raw?.user?.username ||
        raw?.user?.name ||
        raw?.username
      )
    );

    const deriveSellerAvatar = (raw) => (
      coerceString(
        raw?.owner_avatar ||
        raw?.avatar ||
        raw?.owner?.avatar ||
        raw?.user?.avatar
      )
    );

    const resolveNativeCoverImage = (summary, raw, gallery) => {
      const candidates = [
        summary?.coverImageURL,
        raw?.__cover,
        raw?.cover,
        raw?.image_data,
        raw?.thumb_url,
        raw?.primary_image,
        raw?.primaryImage,
        raw?.hero,
        raw?.hero_image,
        Array.isArray(raw?.images) && raw.images.length ? raw.images[0]?.url || raw.images[0]?.image_data : null,
        gallery.length ? gallery[0].url : null
      ];
      for (const candidate of candidates) {
        const url = coerceString(candidate);
        if (url) return url;
      }
      return null;
    };

    const normalizeListingForNative = (summary, rawRow) => {
      if (!isRecord(summary)) return null;
      const raw = isRecord(summary.raw) ? summary.raw : isRecord(rawRow) ? rawRow : {};
      const gallery = normalizeGalleryForNative(raw);
      const tags = parseTags(raw.tags || raw.labels || raw.tag_list || raw.tagList || summary.tags);
      const normalizedTags = tags.map((tag) => tag.toLowerCase());
      const location = coerceString(summary.location || raw.location || raw.city || raw.region);
      const priceLabel = coerceString(summary.priceText || raw.price_label || raw.priceLabel || summary.subtitle?.split('•')[0]);
      const description = coerceString(raw.description || raw.body || raw.details || raw.caption) || '';
      const sellerName = deriveSellerName(raw);
      const sellerAvatar = deriveSellerAvatar(raw);
      const createdAt = coerceNumber(raw.created_at ?? raw.createdAt ?? raw.created);
      const distanceText = coerceString(raw.distance_text || raw.distanceText || raw.distance_label);
      const distanceMeters = coerceNumber(raw.distance_meters ?? raw.distanceMeters ?? raw.distance ?? raw.distance_m);
      const coverImage = resolveNativeCoverImage(summary, raw, gallery);
      const isFavorite = normalizedTags.includes('favorite') || normalizedTags.includes('saved') || raw.is_favorite === true;
      const isBoosted = normalizedTags.includes('boosted') || normalizedTags.includes('featured');
      const isSold = raw.sold === true || normalizedTags.includes('sold');

      return {
        id: summary.id,
        title: summary.title || 'Untitled',
        subtitle: summary.subtitle || '',
        priceText: priceLabel,
        price: Number.isFinite(summary.price) ? summary.price : coerceNumber(raw.price ?? raw.price_cents ?? raw.amount),
        location,
        description,
        tags,
        coverImage,
        gallery,
        sellerName,
        sellerAvatar,
        createdAt,
        isFavorite,
        isBoosted,
        isSold,
        distanceText,
        distanceMeters
      };
    };

    const normalizeListingFeed = (result) => {
      const base = isRecord(result) ? result : { items: Array.isArray(result) ? result : [] };
      const items = Array.isArray(base.items) ? base.items : Array.isArray(base.rows) ? base.rows : [];
      const rows = Array.isArray(base.rows) ? base.rows : [];
      const normalized = items
        .map((summary, index) => normalizeListingForNative(summary, rows[index]))
        .filter(Boolean);
      const nextCursor = base.nextCursor ?? base.cursor ?? null;
      const hasNextFlag = base.hasNext ?? base.next ?? false;
      const hasNext = Boolean(hasNextFlag) || (!!nextCursor && normalized.length > 0);
      return { items: normalized, hasNext, nextCursor: nextCursor ?? null };
    };


    const toNumber = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
      }
      if (value instanceof Date) return value.getTime();
      if (value != null && typeof value.valueOf === 'function') {
        const numeric = Number(value.valueOf());
        if (Number.isFinite(numeric)) return numeric;
      }
      return null;
    };
  
    const parseTags = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) {
        return value.map((tag) => String(tag || '').trim()).filter(Boolean);
      }
      if (typeof value === 'string') {
        return value
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
      }
      return [];
    };

    const normalizeListingMutation = (result) => {
      if (!isRecord(result)) return null;
      try {
        const summary = typeof listings.toSummary === 'function'
          ? listings.toSummary(result)
          : {
              id: coerceString(result.id) || '',
              title: coerceString(result.title) || 'Untitled',
              subtitle: coerceString(result.subtitle) || '',
              price: toNumber(result.price) ?? null,
              priceText: coerceString(result.price_text || result.priceText) || null,
              location: coerceString(result.location) || ''
            };
        return normalizeListingForNative(summary, result);
      } catch (error) {
        log(`normalizeListingMutation failed: ${error?.message || error}`);
        return null;
      }
    };

    globalThis.listings_feed = (params) => {
      try {
        const input = params || {};
        return Promise.resolve(listings.fetchSummaries(input)).then((result) => normalizeListingFeed(result));
      } catch (error) {
        log(`listings_feed failed: ${error?.message || error}`);
        return { items: [], hasNext: false, nextCursor: null };
      }
    };

    globalThis.listings_create = (payload) => {
      try {
        const input = isRecord(payload) ? payload : {};
        return Promise.resolve(listings.createListing(input)).then((result) => {
          const normalized = normalizeListingMutation(result);
          if (!normalized) throw new Error('invalid_listing_response');
          return normalized;
        }).catch((error) => {
          log(`listings_create failed: ${error?.message || error}`);
          throw error;
        });
      } catch (error) {
        log(`listings_create threw: ${error?.message || error}`);
        return Promise.reject(error);
      }
    };

    globalThis.listings_update = (id, payload = {}) => {
      try {
        return Promise.resolve(listings.updateListing(id, payload)).then((result) => {
          const normalized = normalizeListingMutation(result);
          if (!normalized) throw new Error('invalid_listing_response');
          return normalized;
        }).catch((error) => {
          log(`listings_update failed: ${error?.message || error}`);
          throw error;
        });
      } catch (error) {
        log(`listings_update threw: ${error?.message || error}`);
        return Promise.reject(error);
      }
    };

    globalThis.listings_delete = (id) => {
      try {
        return Promise.resolve(listings.deleteListing(id)).then((result) => Boolean(result?.ok ?? result));
      } catch (error) {
        log(`listings_delete failed: ${error?.message || error}`);
        return false;
      }
    };

    globalThis.listings_mark_sold = (id, sold) => {
      try {
        return Promise.resolve(listings.markListingSold(id, sold)).then((result) => {
          const normalized = normalizeListingMutation(result);
          if (!normalized) throw new Error('invalid_listing_response');
          return normalized;
        }).catch((error) => {
          log(`listings_mark_sold failed: ${error?.message || error}`);
          throw error;
        });
      } catch (error) {
        log(`listings_mark_sold threw: ${error?.message || error}`);
        return Promise.reject(error);
      }
    };

    globalThis.listings_ai_analyze = (params) => {
      try {
        const payload = isRecord(params) ? params : {};
        return Promise.resolve(api.aiAnalyze({
          images: Array.isArray(payload.images) ? payload.images : [],
          hint: payload.hint || ''
        }, payload.meta)).catch((error) => {
          log(`listings_ai_analyze failed: ${error?.message || error}`);
          throw error;
        });
      } catch (error) {
        log(`listings_ai_analyze threw: ${error?.message || error}`);
        return Promise.reject(error);
      }
    };

    globalThis.listings_get_images = (id, options = {}) => {
      try {
        return Promise.resolve(uploads.fetchListingImagesCached(id, options)).then((images) => {
          const array = Array.isArray(images) ? images : [];
          return array
            .map((entry) => ({
              url: coerceString(entry?.url || entry),
              width: toNumber(entry?.width),
              height: toNumber(entry?.height)
            }))
            .filter((entry) => entry.url);
        }).catch((error) => {
          log(`listings_get_images failed: ${error?.message || error}`);
          throw error;
        });
      } catch (error) {
        log(`listings_get_images threw: ${error?.message || error}`);
        return Promise.reject(error);
      }
    };
  
    const resolveDistanceMeters = (row, lat, lon) => {
      const explicitDistance = toNumber(row?.distance_m ?? row?.distanceMeters ?? row?.distance);
      if (Number.isFinite(explicitDistance)) return explicitDistance;
      const rowLat = toNumber(row?.lat ?? row?.latitude);
      const rowLon = toNumber(row?.lon ?? row?.longitude);
      if (Number.isFinite(rowLat) && Number.isFinite(rowLon) && Number.isFinite(lat) && Number.isFinite(lon)) {
        try {
          return helpers.haversineMeters(lat, lon, rowLat, rowLon);
        } catch (error) {
          log(`nearby_fetch distance calculation failed: ${error?.message || error}`);
        }
      }
      return null;
    };
  
    const parseTimestamp = (value) => {
      const numeric = toNumber(value);
      if (Number.isFinite(numeric)) {
        if (numeric > 1e12) return Math.floor(numeric / 1000);
        if (numeric > 1e10) return Math.floor(numeric);
        return numeric;
      }
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
      }
      return null;
    };
  
    const normalizeNearbyItems = (rows, lat, lon) => {
      if (!rows) return [];
      const array = Array.isArray(rows) ? rows : helpers.asArray(rows);
      return array
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const summary = typeof listings.toSummary === 'function' ? listings.toSummary(row) : null;
          if (!summary) return null;
  
          const tags = parseTags(row.tags ?? summary.raw?.tags);
          const normalizedTags = tags.map((tag) => tag.toLowerCase());
          const distanceMeters = resolveDistanceMeters(row, lat, lon);
          const distanceText = Number.isFinite(distanceMeters) ? helpers.formatDistance(distanceMeters) : '';
          const createdAt = parseTimestamp(row.created_at ?? row.createdAt ?? summary.raw?.created_at);
  
          return {
            id: summary.id,
            title: summary.title,
            subtitle: summary.subtitle,
            location: summary.location ?? null,
            price: summary.price ?? null,
            distanceText,
            distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
            tags,
            createdAt,
            isBoosted: normalizedTags.some((tag) => tag === 'boosted' || tag === 'featured'),
            isFavorite: normalizedTags.some((tag) => tag === 'favorite' || tag === 'saved')
          };
        })
        .filter(Boolean);
    };
  
    const fallbackNearby = (lat, lon) => (
      Promise.resolve(listings.fetchSummaries({ limit: 40 })).then((result) => {
        const source = Array.isArray(result?.rows) ? result.rows : result?.items;
        return normalizeNearbyItems(source, lat, lon);
      })
    );
  
    globalThis.nearby_fetch = (params) => {
      try {
        const input = params || {};
        const lat = toNumber(input.lat ?? input.latitude);
        const lon = toNumber(input.lon ?? input.longitude);
        const radiusMeters = toNumber(input.radius_m ?? input.radiusMeters ?? input.radius) ?? 150;
  
        const performFetch = () => {
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return fallbackNearby(lat, lon);
          }
  
          return Promise.resolve(core.api.listNearby(lat, lon, radiusMeters)).then((rows) => {
            const normalized = normalizeNearbyItems(rows, lat, lon);
            if (normalized.length) {
              return normalized;
            }
            return fallbackNearby(lat, lon);
          });
        };
  
        return performFetch()
          .then((items) => {
            const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
            const filter = typeof input.filter === 'string' ? input.filter : '';
  
            let filtered = Array.isArray(items) ? [...items] : [];
  
            if (query) {
              filtered = filtered.filter((item) => {
                if (!item) return false;
                const haystacks = [item.title, item.subtitle, item.location]
                  .filter(Boolean)
                  .map((value) => value.toLowerCase());
                const tagMatch = Array.isArray(item.tags)
                  ? item.tags.some((tag) => String(tag).toLowerCase().includes(query))
                  : false;
                return haystacks.some((value) => value.includes(query)) || tagMatch;
              });
            }
  
            switch (filter) {
              case 'newest':
                filtered.sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0));
                break;
              case 'priceDrops':
                filtered = filtered.filter((item) => (
                  Array.isArray(item?.tags)
                    ? item.tags.some((tag) => {
                        const normalized = String(tag).toLowerCase();
                        return normalized.includes('price_drop') || normalized.includes('reduced');
                      })
                    : false
                ));
                break;
              case 'favorites':
                filtered = filtered.filter((item) => item?.isFavorite);
                break;
              default:
                break;
            }
  
            return filtered;
          })
          .catch((error) => {
            log(`nearby_fetch failed: ${error?.message || error}`);
            return [];
          });
      } catch (error) {
        log(`nearby_fetch threw: ${error?.message || error}`);
        return [];
      }
    };
  
    globalThis.upload_photo = (base64, options = {}) => {
      try {
        return Promise.resolve(uploads.uploadBase64Image(base64, options)).then((result) => {
          if (isRecord(result)) {
            return {
              ok: true,
              uploadToken: coerceString(result.uploadToken),
              url: coerceString(result.url || result.publicUrl) || null,
              width: toNumber(result.width),
              height: toNumber(result.height),
              bytes: toNumber(result.bytes)
            };
          }
          return { ok: Boolean(result) };
        }).catch((error) => {
          log(`upload_photo failed: ${error?.message || error}`);
          throw error;
        });
      } catch (error) {
        log(`upload_photo threw: ${error?.message || error}`);
        return Promise.reject(error);
      }
    };
  
    return core;
  }
  
  const defaultExport = {
    createApiClient,
    formatCurrency,
    formatDistance,
    haversineMeters,
    normalizeListingsResponse,
    asArray,
    createAuthService,
    createListingsService,
    createUploadsService,
    createCoreEnvironment,
    installNativeBindings
  };
  

  exports.ApiError = ApiError;
  exports.createApiClient = createApiClient;
  exports.formatCurrency = formatCurrency;
  exports.formatDistance = formatDistance;
  exports.haversineMeters = haversineMeters;
  exports.normalizeListingsResponse = normalizeListingsResponse;
  exports.asArray = asArray;
  exports.createAuthService = createAuthService;
  exports.createListingsService = createListingsService;
  exports.createUploadsService = createUploadsService;
  exports.createCoreEnvironment = createCoreEnvironment;
  exports.installNativeBindings = installNativeBindings;
  exports.default = defaultExport;
  globalThis.ListItCore = exports;
  if (typeof NativeBridge !== 'undefined' && typeof exports.installNativeBindings === 'function') {
    try {
      exports.installNativeBindings();
    } catch (error) {
      if (NativeBridge && typeof NativeBridge.log === 'function') {
        NativeBridge.log(`Failed to install native bindings: ${error?.message || error}`);
      }
    }
  }
})();

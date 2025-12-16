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
    
        if (meta.signal) {  
          requestInit.signal = meta.signal;  
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
    
    const verifyRegistration = (email, code, meta) => request('/api/register/verify', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ email, code })  
    }, meta);  
    
    const requestPasswordReset = (email, meta) => request('/api/password/reset/request', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ email })  
    }, meta);  
    
    const confirmPasswordReset = (email, token, password, meta) => request('/api/password/reset/confirm', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ email, token, password })  
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
        body: JSON.stringify(subscription)  
      }, meta);  
    };  
    
    const pushUnsubscribe = (subscription, meta) => {  
      if (!subscription) return Promise.resolve(null);  
      return request('/api/push/unsubscribe', {  
        method: 'DELETE',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify(subscription)  
      }, meta);  
    };  
    
    // iOS/Android native push (APNs/FCM)  
    const pushSubscribeIos = (payload, meta) => {  
      if (!payload?.token) return Promise.resolve(null);  
      return request('/api/push/ios/subscribe', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify(payload)  
      }, meta);  
    };  
    
    const pushUnsubscribeIos = (payload, meta) => {  
      if (!payload?.token) return Promise.resolve(null);  
      return request('/api/push/ios/unsubscribe', {  
        method: 'DELETE',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify(payload)  
      }, meta);  
    };  
    
    const updatePaypalEmail = (paypalEmail, meta) => request('/api/me/paypal', {  
      method: 'PUT',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ paypal_email: paypalEmail })  
    }, meta);  
    
    const updateLocationPreset = (locationPreset, meta) => request('/api/me/location-preset', {  
      method: 'PUT',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ location_preset: locationPreset })  
    }, meta);  
    
    const updateProfileAbout = (profileAbout, meta) => request('/api/me/profile-about', {  
      method: 'PUT',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ profile_about: profileAbout })  
    }, meta);  
    
    const updateProfileCustomization = (customization, meta) => request('/api/me/profile-customization', {  
      method: 'PUT',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify(customization)  
    }, meta);  
    
    const updateProfilePicture = (profilePictureUrl, meta) => request('/api/me/profile-picture', {  
      method: 'PUT',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ profile_picture_url: profilePictureUrl })  
    }, meta);  
    
    const updateNotificationSettings = (settings, meta) => request('/api/me/notification-settings', {  
      method: 'PUT',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify(settings)  
    }, meta);  
    
    const startSupporterCheckout = (tier = 'basic', meta) => request('/api/supporters/checkout', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ tier })  
    }, meta);  
    
    const confirmSupporterCheckout = (sessionId, meta) => request('/api/supporters/confirm', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ session_id: sessionId })  
    }, meta);  
    
    const cancelSubscription = (meta) => request('/api/supporters/cancel', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' }  
    }, meta);  
    
    const deleteAccount = (confirmation, meta) => request('/api/me', {  
      method: 'DELETE',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ confirmation })  
    }, meta);  
    
    const clearListingLocations = (meta) => request('/api/me/listings/clear-locations', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' }  
    }, meta);  
    
    const listAll = (a, b, meta) => {  
      let q = '';  
      let loc = '';  
      let page = 1;  
      let limit = 48;  
      let sort = 'new';  
      let cursor = null;  
      let lat = null;  
      let lon = null;  
      let metaArg = meta;  
    
      if (a && typeof a === 'object' && !Array.isArray(a)) {  
        const params = a;  
        q = typeof params.q === 'string' ? params.q : '';  
        loc = typeof params.loc === 'string' ? params.loc : '';  
        page = Number(params.page) || 1;  
        limit = Number(params.limit) || 48;  
        sort = typeof params.sort === 'string' ? params.sort : 'new';  
        cursor = params.cursor != null ? params.cursor : null;  
        lat = Number.isFinite(params.lat) ? params.lat : null;  
        lon = Number.isFinite(params.lon) ? params.lon : null;  
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
      if (lat !== null && lon !== null) {  
        params.set('lat', String(lat));  
        params.set('lon', String(lon));  
      }  
      const query = params.toString();  
      const url = '/api/listings' + (query ? `?${query}` : '');  
      return request(url, { method: 'GET' }, metaArg);  
    };  
    
    const listListings = (params = {}, meta) => listAll(params, meta);  
    
    const getUser = (userId, meta) => request(`/api/users/${userId}`, { method: 'GET' }, meta);  
    
    const listByUser = (userId, meta) => request(`/api/users/${userId}/listings`, { method: 'GET' }, meta);  
    
    const listMine = (meta) => request('/api/listings?mine=1', { method: 'GET' }, meta);  
    
    const createListing = (payload, meta) => request('/api/listings', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify(payload || {})  
    }, meta);  
    
    /**  
     * Enqueue a fire-and-forget auto-listing job.  
     * The listing will be created in the background even if the user closes the app.  
     */  
    const createAutoListing = (payload, meta) => request('/api/listings/auto', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify(payload || {})  
    }, meta);  
    
    /**  
     * Fire-and-forget listing with raw images.  
     * Images are sent as base64 and uploaded server-side.  
     * User can close app immediately after this returns.  
     */  
    const createAutoListingFast = (payload, meta) => request('/api/listings/auto-fast', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify(payload || {})  
    }, meta);  
    
    /**  
     * Create a shell listing immediately (no images).  
     * Returns listing_id + presigned S3 URLs for background upload.  
     * Use this for native background uploads where images upload separately.  
     */  
    const createListingShell = (payload, meta) => request('/api/listings/create-shell', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify(payload || {})  
    }, meta);  
    
    /**  
     * Get status of an auto-listing job.  
     */  
    const getAutoListingStatus = (jobId, meta) => request(`/api/listings/auto/${jobId}`, { method: 'GET' }, meta);  
    
    /**  
     * List all auto-listing jobs for the current user.  
     */  
    const listAutoListingJobs = (params = {}, meta) => {  
      const searchParams = new URLSearchParams();  
      if (params.limit) searchParams.set('limit', String(params.limit));  
      if (params.offset) searchParams.set('offset', String(params.offset));  
      const query = searchParams.toString();  
      const url = '/api/listings/auto' + (query ? `?${query}` : '');  
      return request(url, { method: 'GET' }, meta);  
    };  
    
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
    
    const adminGetPaymentsStatus = (meta) => request('/api/admin/payments', { method: 'GET' }, meta);  
    
    const adminGetKarmaTop = ({ limit } = {}, meta) => {  
      const params = new URLSearchParams();  
      if (limit) params.set('limit', limit);  
      const qs = params.toString();  
      return request(`/api/admin/karma/top${qs ? '?' + qs : ''}`, { method: 'GET' }, meta);  
    };  
    
    const adminGetKarmaChanges = ({ days, limit } = {}, meta) => {  
      const params = new URLSearchParams();  
      if (days) params.set('days', days);  
      if (limit) params.set('limit', limit);  
      const qs = params.toString();  
      return request(`/api/admin/karma/changes${qs ? '?' + qs : ''}`, { method: 'GET' }, meta);  
    };  
    
    const adminSetPaymentsStatus = (disabled, meta) => request('/api/admin/payments', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ disabled })  
    }, meta);  
    
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
    
    const getLegalStatus = (meta) => request('/api/legal/status', { method: 'GET' }, meta);  
    
    const getLegalDocuments = (meta) => request('/api/legal/documents', { method: 'GET' }, meta);  
    
    const acceptLegal = (version, meta) => request('/api/legal/accept', {  
      method: 'POST',  
      headers: { 'Content-Type': 'application/json' },  
      body: JSON.stringify({ version })  
    }, meta);  
    
    return {  
      request,  
      me,  
      login,  
      register,  
      verifyRegistration,  
      requestPasswordReset,  
      confirmPasswordReset,  
      logout,  
      pushSubscribe,  
      pushUnsubscribe,  
      pushSubscribeIos,  
      pushUnsubscribeIos,  
      updatePaypalEmail,  
    
      updateLocationPreset,  
      updateProfileAbout,  
      updateProfileCustomization,  
      updateProfilePicture,  
      updateNotificationSettings,  
      startSupporterCheckout,  
      confirmSupporterCheckout,  
      cancelSubscription,  
      deleteAccount,  
      clearListingLocations,  
      listAll,  
      listListings,  
      getUser,  
      listByUser,  
      listMine,  
      createListing,  
      createAutoListing,  
      createAutoListingFast,  
      createListingShell,  
      getAutoListingStatus,  
      listAutoListingJobs,  
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
      adminGetPaymentsStatus,  
      adminGetKarmaTop,  
      adminGetKarmaChanges,  
      adminSetPaymentsStatus,  
      signUpload,  
      finalizeUpload,  
      getLegalStatus,  
      getLegalDocuments,  
      acceptLegal,  
      // Helper to get auth token for sendBeacon (reads from cookie)  
      getAuthToken: () => {  
        if (typeof document === 'undefined') return null;  
        try {  
          const match = document.cookie.match(/(?:^|;\s*)token=([^;]*)/);  
          return match ? decodeURIComponent(match[1]) : null;  
        } catch (e) {  
          return null;  
        }  
      }  
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
    
  const defaultExport = {  
    createApiClient,  
    formatCurrency,  
    formatDistance,  
    haversineMeters  
  };  
  

  exports.ApiError = ApiError;
  exports.createApiClient = createApiClient;
  exports.formatCurrency = formatCurrency;
  exports.formatDistance = formatDistance;
  exports.haversineMeters = haversineMeters;
  exports.default = defaultExport;
  globalThis.ListItCore = exports;
})();

(function (globalScope, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    const exports = factory();
    if (!globalScope.ListItShared || typeof globalScope.ListItShared !== 'object') {
      globalScope.ListItShared = {};
    }
    Object.assign(globalScope.ListItShared, exports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  const REQUEST_FAILED = 'request_failed';
  const AUTH_ERROR = 'auth';
  const ACCOUNT_LOCKED = 'account_locked';
  const INVALID_JSON = 'invalid_json';

  function safeCall(hook, ...args) {
    if (typeof hook === 'function') {
      try {
        hook(...args);
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('ListItShared hook error', err);
        }
      }
    }
  }

  function resolveUrl(url, baseUrl) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url) || url.startsWith('//')) return url;
    if (!baseUrl) return url;
    try {
      return new URL(url, baseUrl).toString();
    } catch (err) {
      return url;
    }
  }

  function createApiClient(options = {}) {
    const {
      baseUrl = '',
      fetchImpl = typeof fetch === 'function' ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : undefined) : null,
      onAuthError,
      onAccountLocked,
      onRequestStart,
      onRequestEnd,
      defaultHeaders,
      credentials = 'include'
    } = options;

    if (typeof fetchImpl !== 'function') {
      throw new Error('createApiClient requires a fetch implementation');
    }

    const applyDefaultHeaders = (headers = {}) => {
      if (!defaultHeaders) return headers;
      return { ...defaultHeaders, ...headers };
    };

    async function request(url, opts = {}, meta = {}) {
      const finalUrl = resolveUrl(url, baseUrl);
      const silent = !!meta.silent;
      if (!silent) safeCall(onRequestStart, { url: finalUrl, options: opts, meta });

      try {
        const requestOptions = { ...opts };
        if (credentials && requestOptions.credentials === undefined) {
          requestOptions.credentials = credentials;
        }
        if (requestOptions.headers) {
          requestOptions.headers = applyDefaultHeaders(requestOptions.headers);
        } else if (defaultHeaders) {
          requestOptions.headers = applyDefaultHeaders();
        }

        const response = await fetchImpl(finalUrl, requestOptions);

        if (response.status === 401) {
          safeCall(onAuthError, response);
          const err = new Error(AUTH_ERROR);
          err.status = response.status;
          throw err;
        }

        if (response.status === 423) {
          try { await response.json(); } catch (_) {}
          safeCall(onAccountLocked, response);
          const err = new Error(ACCOUNT_LOCKED);
          err.status = response.status;
          throw err;
        }

        if (!response.ok) {
          let payload = null;
          try { payload = await response.json(); } catch (_) {}
          const msg = (payload && payload.error) || REQUEST_FAILED;
          if (msg === ACCOUNT_LOCKED) {
            safeCall(onAccountLocked, response, payload);
          }
          const err = new Error(msg);
          err.status = response.status;
          err.payload = payload;
          throw err;
        }

        const text = await response.text();
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch (parseErr) {
          const err = new Error(INVALID_JSON);
          err.cause = parseErr;
          err.responseText = text;
          throw err;
        }
      } finally {
        if (!silent) safeCall(onRequestEnd, { url: finalUrl, meta });
      }
    }

    const client = {
      _fetch: request,
      me(meta) {
        return request('/api/me', { method: 'GET' }, meta);
      },
      login(email, password, meta) {
        return request('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        }, meta);
      },
      register(payload, meta) {
        return request('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, meta);
      },
      async logout(meta) {
        try {
          await request('/api/logout', { method: 'POST' }, meta);
        } catch (_) {}
      },
      pushSubscribe(subscription, meta) {
        if (!subscription) return Promise.resolve(null);
        return request('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription })
        }, meta);
      },
      pushUnsubscribe(subscription, meta) {
        if (!subscription) return Promise.resolve(null);
        return request('/api/push/unsubscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription })
        }, meta);
      },
      updatePaypalEmail(paypal_email, meta) {
        return request('/api/me/paypal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paypal_email })
        }, meta);
      },
      listAll(a, b, meta) {
        let q, loc, page, limit, sort, cursor;
        if (typeof a === 'object' && a !== null) {
          q = a.q || '';
          loc = a.loc || '';
          page = a.page || 1;
          limit = a.limit || 75;
          sort = a.sort || 'new';
          cursor = a.cursor ?? null;
          meta = b || {};
        } else {
          q = a || '';
          loc = b || '';
          page = 1;
          limit = 75;
          sort = 'new';
          cursor = null;
        }
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (loc) params.set('loc', loc);
        params.set('noimg', '1');
        if (cursor != null) {
          params.set('cursor', String(cursor));
        } else {
          params.set('page', String(page));
        }
        params.set('limit', String(limit));
        params.set('sort', sort);
        const qs = params.toString();
        const url = '/api/listings' + (qs ? `?${qs}` : '');
        return request(url, { method: 'GET' }, meta);
      },
      getListing(id, meta) {
        if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_listing'));
        return request(`/api/listings/${id}`, { method: 'GET' }, meta);
      },
      listByUser(userId, meta) {
        return request(`/api/users/${userId}/listings`, { method: 'GET' }, meta);
      },
      listMine(meta) {
        return request('/api/listings?mine=1', { method: 'GET' }, meta);
      },
      getListingImages(id, meta) {
        return request(`/api/listings/${id}/images`, { method: 'GET' }, meta);
      },
      createListing(payload, meta) {
        return request('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        }, meta);
      },
      updateListing(id, payload, meta) {
        return request(`/api/listings/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        }, meta);
      },
      markListingSold(id, sold, meta) {
        return request(`/api/listings/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sold: !!sold })
        }, meta);
      },
      deleteListing(id, meta) {
        return request(`/api/listings/${id}`, { method: 'DELETE' }, meta);
      },
      adminDeleteListing(id, meta) {
        return request(`/api/admin/listings/${id}`, { method: 'DELETE' }, meta);
      },
      adminDeleteAll(meta) {
        return request('/api/admin/listings', { method: 'DELETE' }, meta);
      },
      adminSeedListings(options = {}, meta) {
        let payload = null;
        if (options && typeof options === 'object') {
          const count = Number(options.count);
          if (Number.isFinite(count) && count > 0) {
            payload = { count: Math.floor(count) };
          }
        }
        const opts = { method: 'POST' };
        if (payload) {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify(payload);
        }
        return request('/api/admin/listings/seed', opts, meta);
      },
      adminDeleteSeedListings(meta) {
        return request('/api/admin/listings/seed', { method: 'DELETE' }, meta);
      },
      listAds(meta) {
        return request('/api/ads', { method: 'GET' }, meta);
      },
      adminListFlagged(meta) {
        return request('/api/admin/flagged', { method: 'GET' }, meta);
      },
      adminDeleteFlagged(id, meta) {
        return request(`/api/admin/flagged/${id}`, { method: 'DELETE' }, meta);
      },
      adminListAds(meta) {
        return request('/api/admin/ads', { method: 'GET' }, meta);
      },
      adminCreateAd(payload, meta) {
        return request('/api/admin/ads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        }, meta);
      },
      adminUpdateAd(id, payload, meta) {
        return request(`/api/admin/ads/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        }, meta);
      },
      adminDeleteAd(id, meta) {
        return request(`/api/admin/ads/${id}`, { method: 'DELETE' }, meta);
      },
      searchCities(q, meta) {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        const qs = params.toString();
        const url = '/api/cities' + (qs ? `?${qs}` : '');
        return request(url, { method: 'GET' }, { ...(meta || {}), silent: true });
      },
      listFavorites(meta) {
        return request('/api/me/favorites', { method: 'GET' }, meta);
      },
      addFavorite(id, meta) {
        return request('/api/me/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listing_id: id })
        }, meta);
      },
      removeFavorite(id, meta) {
        return request(`/api/me/favorites/${id}`, { method: 'DELETE' }, meta);
      },
      ensureConversation({ with_user_id, listing_id }, meta) {
        return request('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ with_user_id, listing_id })
        }, meta);
      },
      createConversation(with_user_id, listing_id, meta) {
        return request('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ with_user_id, listing_id })
        }, meta);
      },
      listConversations(meta) {
        return request('/api/conversations', { method: 'GET' }, meta);
      },
      getMessages(id, meta) {
        return request(`/api/conversations/${id}/messages`, { method: 'GET' }, meta);
      },
      sendMessage(id, body, images, meta) {
        return request(`/api/conversations/${id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, images })
        }, meta);
      },
      deleteConversation(id, meta) {
        return request(`/api/conversations/${id}`, { method: 'DELETE' }, meta);
      },
      getCoversBatch(ids = [], meta) {
        const idsStr = Array.from(new Set(ids.filter(Number.isFinite))).slice(0, 200).join(',');
        if (!idsStr) return Promise.resolve([]);
        return request(`/api/listings/covers?ids=${idsStr}`, { method: 'GET' }, meta);
      },
      aiAnalyze({ images, hint }, meta) {
        return request('/api/ai/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images, hint })
        }, meta);
      },
      reverseGeocode(lat, lon, meta) {
        return request(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { method: 'GET' }, meta);
      },
      listNearby(lat, lon, radius_m = 150, meta) {
        const url = `/api/listings/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius_m=${encodeURIComponent(radius_m)}`;
        return request(url, { method: 'GET' }, meta);
      },
      reportSeller(payload, meta) {
        return request('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        }, meta);
      },
      adminSearchUsers(params = {}, meta) {
        const q = params.q ?? params.query ?? '';
        const limit = params.limit;
        const searchParams = new URLSearchParams();
        if (q) searchParams.set('q', q);
        if (limit) searchParams.set('limit', String(limit));
        const url = '/api/admin/users/search' + (searchParams.toString() ? `?${searchParams.toString()}` : '');
        return request(url, { method: 'GET' }, meta);
      },
      adminGetUser(id, meta) {
        if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
        return request(`/api/admin/users/${id}`, { method: 'GET' }, meta);
      },
      adminGetUserReports(id, params = {}, meta) {
        if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
        const searchParams = new URLSearchParams();
        if (params.limit) searchParams.set('limit', String(params.limit));
        const url = `/api/admin/users/${id}/reports` + (searchParams.toString() ? `?${searchParams.toString()}` : '');
        return request(url, { method: 'GET' }, meta);
      },
      adminUpdateUserStatus(id, payload = {}, meta) {
        if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
        return request(`/api/admin/users/${id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        }, meta);
      },
      adminTopReports(params = {}, meta) {
        const searchParams = new URLSearchParams();
        if (Number.isFinite(Number(params.limit))) searchParams.set('limit', String(params.limit));
        if (Number.isFinite(Number(params.days))) searchParams.set('days', String(params.days));
        if (Number.isFinite(Number(params.min))) searchParams.set('min', String(params.min));
        const url = '/api/admin/reports/top' + (searchParams.toString() ? `?${searchParams.toString()}` : '');
        return request(url, { method: 'GET' }, meta);
      },
      adminClearUserReports(id, payload = {}, meta) {
        if (!Number.isFinite(Number(id))) return Promise.reject(new Error('invalid_user'));
        return request(`/api/admin/users/${id}/reports/clear`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        }, meta);
      },
      signUpload({ filename, contentType, bytes }, meta) {
        return request('/api/uploads/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, contentType, bytes })
        }, meta);
      },
      finalizeUpload({ listingId, key, url, width, height, bytes }, meta) {
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
      }
    };

    return Object.freeze(client);
  }

  return { createApiClient };
});

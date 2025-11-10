/* eslint-disable prefer-rest-params */
function ApiError(message) {
  Error.call(this, message);
  this.name = 'ApiError';
  this.message = message;
  this.responseText = undefined;
}

ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;

function resolveFetch(fetchImpl) {
  var impl = fetchImpl;
  if (!impl) {
    if (typeof fetch === 'function') {
      impl = fetch.bind(typeof globalThis === 'object' ? globalThis : undefined);
    }
  }

  if (!impl) {
    throw new Error('A fetch implementation must be provided to createApiClient.');
  }

  return impl;
}

function normalizeToken(value) {
  if (typeof value !== 'string') return null;
  var trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function assign(target) {
  if (target == null) {
    throw new TypeError('Cannot convert undefined or null to object');
  }

  var result = Object(target);
  for (var i = 1; i < arguments.length; i += 1) {
    var source = arguments[i];
    if (source == null) continue;
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        result[key] = source[key];
      }
    }
  }

  return result;
}

function isFiniteNumber(value) {
  var num = Number(value);
  return typeof num === 'number' && isFinite(num);
}

function coalesceString(value) {
  return typeof value === 'string' ? value : '';
}

function resolveGlobal() {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof self !== 'undefined') return self;
  if (typeof window !== 'undefined') return window;
  if (typeof global !== 'undefined') return global;
  return Function('return this')();
}

function createApiClient(options) {
  options = options || {};
  var baseUrl = coalesceString(options.baseUrl);
  var fetchImpl = options.fetchImpl;
  var onRequestEnd = options.onRequestEnd;
  var onRequestStart = options.onRequestStart;
  var onUnauthorized = options.onUnauthorized;
  var onAccountLocked = options.onAccountLocked;
  var prepareFetchInit = options.prepareFetchInit;
  var onTokenChange = options.onTokenChange;
  var initialAuthToken = options.initialAuthToken == null ? null : options.initialAuthToken;

  var fetchLike = resolveFetch(fetchImpl);
  var authToken = null;

  function notifyTokenChange(token) {
    if (typeof onTokenChange === 'function') {
      try {
        onTokenChange(token);
      } catch (err) {
        // ignore listener failures
      }
    }
  }

  function getAuthToken() {
    return authToken;
  }

  function setAuthToken(value) {
    var normalized = normalizeToken(value);
    if (normalized === authToken) return authToken;
    authToken = normalized;
    notifyTokenChange(authToken);
    return authToken;
  }

  setAuthToken(initialAuthToken);

  function resolveUrl(path) {
    if (/^https?:/i.test(path)) return path;
    return baseUrl ? baseUrl + path : path;
  }

  function finishRequest(silent) {
    if (!silent && typeof onRequestEnd === 'function') {
      try {
        onRequestEnd();
      } catch (err) {
        // ignore listener failures
      }
    }
  }

  function request(path, init, meta) {
    init = init || {};
    meta = meta || {};

    var silent = !!meta.silent;
    if (!silent && typeof onRequestStart === 'function') {
      try {
        onRequestStart();
      } catch (err) {
        // ignore listener failures
      }
    }

    var requestInit = assign({ credentials: 'include' }, init);

    if (typeof prepareFetchInit === 'function') {
      var prepared = prepareFetchInit(requestInit, meta, {
        getAuthToken: getAuthToken,
        setAuthToken: setAuthToken
      });
      if (prepared && typeof prepared === 'object') {
        requestInit = prepared === requestInit ? requestInit : assign(assign({}, requestInit), prepared);
      } else if (prepared != null) {
        requestInit = prepared;
      }
    }

    if (meta && Object.prototype.hasOwnProperty.call(meta, 'priority')) {
      requestInit.priority = meta.priority;
    }

    return Promise.resolve(fetchLike(resolveUrl(path), requestInit))
      .then(function (response) {
        if (response.status === 401) {
          setAuthToken(null);
          if (typeof onUnauthorized === 'function') onUnauthorized();
          throw new ApiError('auth');
        }

        if (response.status === 423) {
          var lockPromise = typeof response.json === 'function' ? response.json() : Promise.resolve(null);
          return Promise.resolve(lockPromise)
            .catch(function () {
              return null;
            })
            .then(function () {
              if (typeof onAccountLocked === 'function') onAccountLocked();
              throw new ApiError('account_locked');
            });
        }

        if (!response.ok) {
          var payloadPromise = typeof response.json === 'function' ? response.json() : Promise.resolve(null);
          return Promise.resolve(payloadPromise)
            .catch(function () {
              return null;
            })
            .then(function (payload) {
              var message = payload && typeof payload === 'object' && payload.error ? payload.error : 'request_failed';
              if (message === 'account_locked' && typeof onAccountLocked === 'function') onAccountLocked();
              throw new ApiError(message);
            });
        }

        return response.text().then(function (text) {
          if (!text) return null;

          var payload;
          try {
            payload = JSON.parse(text);
          } catch (err) {
            var parseError = new ApiError('invalid_json');
            if (err instanceof Error) {
              parseError.cause = err;
            }
            parseError.responseText = text;
            throw parseError;
          }

          if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'token')) {
            setAuthToken(payload.token);
          }

          return payload;
        });
      })
      .then(
        function (result) {
          finishRequest(silent);
          return result;
        },
        function (error) {
          finishRequest(silent);
          throw error;
        }
      );
  }

  function me(meta) {
    return request('/api/me', { method: 'GET' }, meta);
  }

  function login(email, password, meta) {
    return request(
      '/api/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      },
      meta
    );
  }

  function register(payload, meta) {
    return request(
      '/api/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function verifyRegistration(email, code, meta) {
    return request(
      '/api/register/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, code: code })
      },
      meta
    );
  }

  function requestPasswordReset(email, meta) {
    return request(
      '/api/password/reset/request',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      },
      meta
    );
  }

  function confirmPasswordReset(email, token, password, meta) {
    return request(
      '/api/password/reset/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, token: token, password: password })
      },
      meta
    );
  }

  function logout(meta) {
    return request('/api/logout', { method: 'POST' }, meta).then(
      function (result) {
        setAuthToken(null);
        return result;
      },
      function (error) {
        if (error instanceof ApiError && error.message === 'auth') {
          return null;
        }
        throw error;
      }
    );
  }

  function pushSubscribe(subscription, meta) {
    if (!subscription) return Promise.resolve(null);
    return request(
      '/api/push/subscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription })
      },
      meta
    );
  }

  function pushUnsubscribe(subscription, meta) {
    if (!subscription) return Promise.resolve(null);
    return request(
      '/api/push/unsubscribe',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription })
      },
      meta
    );
  }

  function updatePaypalEmail(paypalEmail, meta) {
    return request(
      '/api/me/paypal',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paypal_email: paypalEmail })
      },
      meta
    );
  }

  function updateLocationPreset(locationPreset, meta) {
    return request(
      '/api/me/location-preset',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_preset: locationPreset })
      },
      meta
    );
  }

  function updateProfilePicture(profilePictureUrl, meta) {
    return request(
      '/api/me/profile-picture',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_picture_url: profilePictureUrl })
      },
      meta
    );
  }

  function deleteAccount(confirmation, meta) {
    return request(
      '/api/me',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: confirmation })
      },
      meta
    );
  }

  function listAll(a, b, meta) {
    var q = '';
    var loc = '';
    var page = 1;
    var limit = 75;
    var sort = 'new';
    var cursor = null;
    var metaArg = meta;

    if (a && typeof a === 'object' && !Array.isArray(a)) {
      var params = a;
      q = coalesceString(params.q);
      loc = coalesceString(params.loc);
      page = isFiniteNumber(params.page) ? Number(params.page) : 1;
      limit = isFiniteNumber(params.limit) ? Number(params.limit) : 75;
      sort = coalesceString(params.sort) || 'new';
      cursor = params.cursor != null ? params.cursor : null;
      metaArg = b || meta;
    } else {
      q = coalesceString(a);
      loc = coalesceString(b);
      metaArg = meta;
    }

    var paramsList = new URLSearchParams();
    if (q) paramsList.set('q', q);
    if (loc) paramsList.set('loc', loc);
    paramsList.set('noimg', '1');
    if (cursor != null) paramsList.set('cursor', String(cursor));
    else paramsList.set('page', String(page));
    paramsList.set('limit', String(limit));
    paramsList.set('sort', sort);
    var query = paramsList.toString();
    var url = '/api/listings' + (query ? '?' + query : '');
    return request(url, { method: 'GET' }, metaArg);
  }

  function listListings(params, meta) {
    return listAll(params || {}, meta);
  }

  function getUser(userId, meta) {
    return request('/api/users/' + userId, { method: 'GET' }, meta);
  }

  function listByUser(userId, meta) {
    return request('/api/users/' + userId + '/listings', { method: 'GET' }, meta);
  }

  function listMine(meta) {
    return request('/api/listings?mine=1', { method: 'GET' }, meta);
  }

  function createListing(payload, meta) {
    return request(
      '/api/listings',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function updateListing(id, payload, meta) {
    return request(
      '/api/listings/' + id,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function markListingSold(id, sold, meta) {
    return updateListing(id, { sold: !!sold }, meta);
  }

  function deleteListing(id, meta) {
    return request('/api/listings/' + id, { method: 'DELETE' }, meta);
  }

  function adminDeleteListing(id, meta) {
    return request('/api/admin/listings/' + id, { method: 'DELETE' }, meta);
  }

  function adminDeleteAll(meta) {
    return request('/api/admin/listings', { method: 'DELETE' }, meta);
  }

  function adminSeedListings(payload, meta) {
    var bodyPayload = payload || {};
    return request(
      '/api/admin/listings/seed',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      },
      meta
    );
  }

  function adminDeleteSeedListings(meta) {
    return request('/api/admin/listings/seed', { method: 'DELETE' }, meta);
  }

  function listAds(meta) {
    return request('/api/ads', { method: 'GET' }, meta);
  }

  function adminListFlagged(meta) {
    return request('/api/admin/flagged', { method: 'GET' }, meta);
  }

  function adminDeleteFlagged(id, meta) {
    return request('/api/admin/flagged/' + id, { method: 'DELETE' }, meta);
  }

  function adminListAds(meta) {
    return request('/api/admin/ads', { method: 'GET' }, meta);
  }

  function adminCreateAd(payload, meta) {
    return request(
      '/api/admin/ads',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function adminUpdateAd(id, payload, meta) {
    return request(
      '/api/admin/ads/' + id,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function adminDeleteAd(id, meta) {
    return request('/api/admin/ads/' + id, { method: 'DELETE' }, meta);
  }

  function searchCities(q, meta) {
    var params = new URLSearchParams();
    if (q) params.set('q', q);
    var query = params.toString();
    var url = '/api/cities' + (query ? '?' + query : '');
    var effectiveMeta = assign({}, meta || {}, { silent: true });
    return request(url, { method: 'GET' }, effectiveMeta);
  }

  function ensureConversation(payload, meta) {
    return request(
      '/api/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function listConversations(meta) {
    return request('/api/conversations', { method: 'GET' }, meta);
  }

  function getMessages(id, meta) {
    return request('/api/conversations/' + id + '/messages', { method: 'GET' }, meta);
  }

  function sendMessage(id, body, images, meta) {
    return request(
      '/api/conversations/' + id + '/messages',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body, images: images })
      },
      meta
    );
  }

  function deleteConversation(id, meta) {
    return request('/api/conversations/' + id, { method: 'DELETE' }, meta);
  }

  function getListingImages(id, meta) {
    return request('/api/listings/' + id + '/images', { method: 'GET' }, meta);
  }

  function uniqueNumericList(values) {
    var seen = Object.create(null);
    var result = [];
    if (!values || !values.length) return result;

    for (var i = 0; i < values.length && result.length < 200; i += 1) {
      var value = Number(values[i]);
      if (!isFinite(value)) continue;
      var key = String(value);
      if (!Object.prototype.hasOwnProperty.call(seen, key)) {
        seen[key] = true;
        result.push(value);
      }
    }

    return result;
  }

  function getCoversBatch(ids, meta) {
    var normalized = uniqueNumericList((ids || []).slice());
    if (!normalized.length) return Promise.resolve([]);
    var url = '/api/listings/covers?ids=' + encodeURIComponent(normalized.join(','));
    return request(url, { method: 'GET' }, meta);
  }

  function aiAnalyze(params, meta) {
    params = params || {};
    return request(
      '/api/ai/analyze',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: params.images, hint: params.hint })
      },
      meta
    );
  }

  function reverseGeocode(lat, lon, meta) {
    var url = '/api/geo/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
    return request(url, { method: 'GET' }, meta);
  }

  function listNearby(lat, lon, radiusMeters, meta) {
    var radius = radiusMeters == null ? 150 : radiusMeters;
    var url =
      '/api/listings/nearby?lat=' +
      encodeURIComponent(lat) +
      '&lon=' +
      encodeURIComponent(lon) +
      '&radius_m=' +
      encodeURIComponent(radius);
    return request(url, { method: 'GET' }, meta);
  }

  function reportSeller(payload, meta) {
    return request(
      '/api/reports',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function adminSearchUsers(params, meta) {
    params = params || {};
    var searchParams = new URLSearchParams();
    var qValue = params.q != null ? params.q : params.query;
    if (qValue) searchParams.set('q', String(qValue));
    if (params.limit != null) searchParams.set('limit', String(params.limit));
    var query = searchParams.toString();
    var url = '/api/admin/users/search' + (query ? '?' + query : '');
    return request(url, { method: 'GET' }, meta);
  }

  function adminGetUser(id, meta) {
    if (!isFiniteNumber(id)) return Promise.reject(new ApiError('invalid_user'));
    return request('/api/admin/users/' + id, { method: 'GET' }, meta);
  }

  function adminGetUserReports(id, params, meta) {
    if (!isFiniteNumber(id)) return Promise.reject(new ApiError('invalid_user'));
    params = params || {};
    var searchParams = new URLSearchParams();
    if (params.limit != null) searchParams.set('limit', String(params.limit));
    var query = searchParams.toString();
    var url = '/api/admin/users/' + id + '/reports' + (query ? '?' + query : '');
    return request(url, { method: 'GET' }, meta);
  }

  function adminUpdateUserStatus(id, payload, meta) {
    if (!isFiniteNumber(id)) return Promise.reject(new ApiError('invalid_user'));
    return request(
      '/api/admin/users/' + id + '/status',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify((payload || {}))
      },
      meta
    );
  }

  function adminTopReports(params, meta) {
    params = params || {};
    var searchParams = new URLSearchParams();
    if (params.limit != null && isFiniteNumber(params.limit)) searchParams.set('limit', String(params.limit));
    if (params.days != null && isFiniteNumber(params.days)) searchParams.set('days', String(params.days));
    if (params.min != null && isFiniteNumber(params.min)) searchParams.set('min', String(params.min));
    var query = searchParams.toString();
    var url = '/api/admin/reports/top' + (query ? '?' + query : '');
    return request(url, { method: 'GET' }, meta);
  }

  function adminClearUserReports(id, payload, meta) {
    if (!isFiniteNumber(id)) return Promise.reject(new ApiError('invalid_user'));
    return request(
      '/api/admin/users/' + id + '/reports/clear',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      },
      meta
    );
  }

  function signUpload(params, meta) {
    params = params || {};
    return request(
      '/api/uploads/sign',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: params.filename,
          contentType: params.contentType,
          bytes: params.bytes
        })
      },
      meta
    );
  }

  function finalizeUpload(params, meta) {
    params = params || {};
    var payload = {};
    if (params.listingId != null) payload.listingId = params.listingId;
    if (params.key != null) payload.key = params.key;
    if (params.url != null) payload.url = params.url;
    if (params.width != null) payload.width = params.width;
    if (params.height != null) payload.height = params.height;
    if (params.bytes != null) payload.bytes = params.bytes;

    return request(
      '/api/uploads/finalize',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      meta
    );
  }

  return {
    request: request,
    me: me,
    login: login,
    register: register,
    verifyRegistration: verifyRegistration,
    requestPasswordReset: requestPasswordReset,
    confirmPasswordReset: confirmPasswordReset,
    logout: logout,
    pushSubscribe: pushSubscribe,
    pushUnsubscribe: pushUnsubscribe,
    updatePaypalEmail: updatePaypalEmail,
    updateLocationPreset: updateLocationPreset,
    updateProfilePicture: updateProfilePicture,
    deleteAccount: deleteAccount,
    listAll: listAll,
    listListings: listListings,
    getUser: getUser,
    listByUser: listByUser,
    listMine: listMine,
    createListing: createListing,
    updateListing: updateListing,
    markListingSold: markListingSold,
    deleteListing: deleteListing,
    adminDeleteListing: adminDeleteListing,
    adminDeleteAll: adminDeleteAll,
    adminSeedListings: adminSeedListings,
    adminDeleteSeedListings: adminDeleteSeedListings,
    listAds: listAds,
    adminListFlagged: adminListFlagged,
    adminDeleteFlagged: adminDeleteFlagged,
    adminListAds: adminListAds,
    adminCreateAd: adminCreateAd,
    adminUpdateAd: adminUpdateAd,
    adminDeleteAd: adminDeleteAd,
    searchCities: searchCities,
    ensureConversation: ensureConversation,
    listConversations: listConversations,
    getMessages: getMessages,
    sendMessage: sendMessage,
    deleteConversation: deleteConversation,
    getListingImages: getListingImages,
    getCoversBatch: getCoversBatch,
    aiAnalyze: aiAnalyze,
    reverseGeocode: reverseGeocode,
    listNearby: listNearby,
    reportSeller: reportSeller,
    adminSearchUsers: adminSearchUsers,
    adminGetUser: adminGetUser,
    adminGetUserReports: adminGetUserReports,
    adminUpdateUserStatus: adminUpdateUserStatus,
    adminTopReports: adminTopReports,
    adminClearUserReports: adminClearUserReports,
    signUpload: signUpload,
    finalizeUpload: finalizeUpload,
    setAuthToken: setAuthToken,
    getAuthToken: getAuthToken
  };
}

function formatCurrency(value, currency) {
  var amount = Number(value == null ? 0 : value);
  return amount.toLocaleString(undefined, { style: 'currency', currency: currency || 'USD' });
}

function formatDistance(meters) {
  if (!isFiniteNumber(meters)) return '';
  var distance = Number(meters);
  if (distance < 1609.344 * 0.3) {
    var feet = distance * 3.28084;
    if (feet < 1000) return Math.round(feet) + ' ft';
    return Math.round(feet / 100) / 10 + 'k ft';
  }
  var miles = distance / 1609.344;
  return (miles < 10 ? miles.toFixed(1) : Math.round(miles)) + ' mi';
}

var TO_RAD = Math.PI / 180;

function haversineMeters(aLat, aLon, bLat, bLon) {
  var R = 6371000;
  var dLat = (bLat - aLat) * TO_RAD;
  var dLon = (bLon - aLon) * TO_RAD;
  var s1 = Math.sin(dLat / 2);
  var s2 = Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(s1 * s1 + Math.cos(aLat * TO_RAD) * Math.cos(bLat * TO_RAD) * s2 * s2));
}

export { ApiError, createApiClient, formatCurrency, formatDistance, haversineMeters, resolveGlobal };

export default {
  createApiClient: createApiClient,
  formatCurrency: formatCurrency,
  formatDistance: formatDistance,
  haversineMeters: haversineMeters
};

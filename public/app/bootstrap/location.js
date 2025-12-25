(() => {
  // Global location cache - persists across createLocationHelpers calls
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  let cachedLocation = null; // { lat, lon, display }
  let cachedAt = null; // timestamp
  let fetchInProgress = null; // promise if fetch is in progress

  function createLocationHelpers({ api } = {}) {
    if (!api || typeof api.reverseGeocode !== 'function') {
      throw new Error('Location helpers require an API client with reverseGeocode.');
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

    // Check if running in Capacitor native app
    function isCapacitorNative() {
      return typeof window !== 'undefined' &&
             window.Capacitor &&
             window.Capacitor.isNativePlatform &&
             window.Capacitor.isNativePlatform();
    }

    // Check if cache is still valid
    function isCacheValid() {
      if (!cachedLocation || !cachedAt) return false;
      return (Date.now() - cachedAt) < CACHE_TTL_MS;
    }

    // Get cached location (may be stale but still usable as fallback)
    function getCachedLocation() {
      return cachedLocation ? { ...cachedLocation } : null;
    }

    // Internal fetch without caching logic
    async function fetchFresh({ silent = false } = {}) {
      let lat, lon;
      // Use Capacitor Geolocation on native, browser API on web
      const isNative = window.Capacitor?.isNativePlatform?.();
      if (isNative && window.Capacitor?.Plugins?.Geolocation) {
        const { Geolocation } = window.Capacitor.Plugins;
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 60000
        });
        lat = position.coords.latitude;
        lon = position.coords.longitude;
      } else {
        if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
        const { coords } = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
        );
        lat = coords.latitude;
        lon = coords.longitude;
      }
      const r = await api.reverseGeocode(lat, lon, { silent });
      const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      return {
        lat: r?.lat ?? lat,
        lon: r?.lon ?? lon,
        display: formatLocationDisplay(r, fallback)
      };
    }

    // Main fetch function - uses cache, keeps last known on failure
    async function fetchCoordsAndReverse({ silent = false, forceRefresh = false } = {}) {
      // Return valid cache unless force refresh requested
      if (!forceRefresh && isCacheValid()) {
        return { ...cachedLocation };
      }

      // If fetch already in progress, wait for it
      if (fetchInProgress) {
        try {
          return await fetchInProgress;
        } catch (err) {
          // If the in-progress fetch failed, return stale cache if available
          if (cachedLocation) return { ...cachedLocation };
          throw err;
        }
      }

      // Start new fetch
      fetchInProgress = (async () => {
        try {
          const result = await fetchFresh({ silent });
          // Update cache on success
          cachedLocation = result;
          cachedAt = Date.now();
          return { ...result };
        } catch (err) {
          // On failure, keep existing cache (don't clear it)
          // If we have a stale cache, return it instead of throwing
          if (cachedLocation) {
            console.warn('[Location] Fetch failed, using stale cache:', err?.message || err);
            return { ...cachedLocation };
          }
          // No cache at all, re-throw
          throw err;
        } finally {
          fetchInProgress = null;
        }
      })();

      return fetchInProgress;
    }

    // Refresh cache if stale (called on app resume)
    // This is fire-and-forget - doesn't block, doesn't throw
    function refreshCacheIfStale() {
      if (isCacheValid()) return;
      // Don't await - let it run in background
      fetchCoordsAndReverse({ silent: true }).catch(err => {
        console.warn('[Location] Background refresh failed:', err?.message || err);
      });
    }

    // Initialize cache on app startup (fire-and-forget)
    function initializeCache() {
      fetchCoordsAndReverse({ silent: true }).catch(err => {
        console.warn('[Location] Initial cache failed:', err?.message || err);
      });
    }

    return {
      fetchCoordsAndReverse,
      getCachedLocation,
      refreshCacheIfStale,
      initializeCache,
      isCacheValid
    };
  }

  if (typeof window !== 'undefined') {
    window.ListItApp = window.ListItApp || {};
    window.ListItApp.bootstrap = window.ListItApp.bootstrap || {};
    window.ListItApp.bootstrap.createLocationHelpers = createLocationHelpers;
  }
})();

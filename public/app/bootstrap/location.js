(() => {
  // === STORAGE KEYS ===
  const DISPLAY_CACHE_KEY = 'listit_location_display'; // permanent city/state
  const COORDS_CACHE_KEY = 'listit_location_coords'; // lat/lon with timestamp
  const WARNING_SHOWN_KEY = 'listit_location_warning_shown'; // hourly throttle

  // === TTLs ===
  const COORDS_TTL_MS = 10 * 60 * 1000; // 10 minutes for lat/lon
  const WARNING_THROTTLE_MS = 60 * 60 * 1000; // 1 hour between warnings

  // === IN-MEMORY CACHE (for coords during session) ===
  let cachedCoords = null; // { lat, lon }
  let coordsCachedAt = null;
  let fetchInProgress = null;

  // === LOCALSTORAGE HELPERS ===
  function getStoredDisplay() {
    try {
      return localStorage.getItem(DISPLAY_CACHE_KEY) || null;
    } catch {
      return null;
    }
  }

  function setStoredDisplay(display) {
    try {
      if (display) {
        localStorage.setItem(DISPLAY_CACHE_KEY, display);
        // Notify listeners that location was cached (for components that mounted before cache was ready)
        window.dispatchEvent(new CustomEvent('listit:location-cached', { detail: { display } }));
      }
    } catch {
      // ignore storage errors
    }
  }

  function getStoredCoords() {
    try {
      const raw = localStorage.getItem(COORDS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') return null;
      // Check TTL
      if (parsed.timestamp && (Date.now() - parsed.timestamp) < COORDS_TTL_MS) {
        return { lat: parsed.lat, lon: parsed.lon };
      }
      return null; // expired
    } catch {
      return null;
    }
  }

  function setStoredCoords(lat, lon) {
    try {
      localStorage.setItem(COORDS_CACHE_KEY, JSON.stringify({
        lat,
        lon,
        timestamp: Date.now()
      }));
    } catch {
      // ignore storage errors
    }
  }

  function shouldShowWarning() {
    try {
      const lastShown = localStorage.getItem(WARNING_SHOWN_KEY);
      if (!lastShown) return true;
      return (Date.now() - Number(lastShown)) >= WARNING_THROTTLE_MS;
    } catch {
      return true;
    }
  }

  function markWarningShown() {
    try {
      localStorage.setItem(WARNING_SHOWN_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }

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

    // Check if coords cache is still valid (in-memory or localStorage)
    function areCoordsValid() {
      // Check in-memory first
      if (cachedCoords && coordsCachedAt && (Date.now() - coordsCachedAt) < COORDS_TTL_MS) {
        return true;
      }
      // Check localStorage
      return getStoredCoords() !== null;
    }

    // Get cached coords (in-memory or localStorage)
    function getCachedCoords() {
      // Check in-memory first
      if (cachedCoords && coordsCachedAt && (Date.now() - coordsCachedAt) < COORDS_TTL_MS) {
        return { ...cachedCoords };
      }
      // Fall back to localStorage
      return getStoredCoords();
    }

    // Get the permanently cached display location
    function getCachedDisplay() {
      return getStoredDisplay();
    }

    // Get full cached location (display + coords if available)
    function getCachedLocation() {
      const display = getStoredDisplay();
      const coords = getCachedCoords();
      if (!display && !coords) return null;
      return {
        display: display || null,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null
      };
    }

    // Internal: fetch GPS coordinates only
    async function fetchGPSCoords() {
      let lat, lon;
      const isNative = window.Capacitor?.isNativePlatform?.();
      if (isNative && window.Capacitor?.Plugins?.Geolocation) {
        const { Geolocation } = window.Capacitor.Plugins;
        // First check/request permissions - this doesn't have a timeout
        const permStatus = await Geolocation.checkPermissions();
        if (permStatus.location === 'prompt' || permStatus.location === 'prompt-with-rationale') {
          // Request permissions first - user might take time to decide
          const reqResult = await Geolocation.requestPermissions();
          if (reqResult.location !== 'granted') {
            throw new Error('Location permission denied');
          }
        } else if (permStatus.location === 'denied') {
          throw new Error('Location permission denied');
        }
        // Now get position - permission already granted, so timeout is just for GPS fix
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000
        });
        lat = position.coords.latitude;
        lon = position.coords.longitude;
      } else {
        if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
        const { coords } = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
        );
        lat = coords.latitude;
        lon = coords.longitude;
      }
      return { lat, lon };
    }

    // Fetch display location (city, state) - updates permanent cache
    // Returns { display, lat, lon } on success, throws on failure
    async function fetchDisplayLocation({ silent = false } = {}) {
      // If we already have a permanent display cache and don't need fresh, return it
      const existingDisplay = getStoredDisplay();

      // If fetch already in progress, wait for it
      if (fetchInProgress) {
        try {
          return await fetchInProgress;
        } catch (err) {
          if (existingDisplay) return { display: existingDisplay, lat: null, lon: null };
          throw err;
        }
      }

      fetchInProgress = (async () => {
        try {
          const { lat, lon } = await fetchGPSCoords();
          const r = await api.reverseGeocode(lat, lon, { silent });
          const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
          const display = formatLocationDisplay(r, fallback);

          // Update permanent display cache
          setStoredDisplay(display);

          // Also cache coords in memory (but don't persist unless needed)
          cachedCoords = { lat, lon };
          coordsCachedAt = Date.now();

          return { display, lat, lon };
        } finally {
          fetchInProgress = null;
        }
      })();

      return fetchInProgress;
    }

    // Fetch coords only (for distance tags) - uses/updates 15min cache
    async function fetchCoords({ silent = false, forceRefresh = false } = {}) {
      // Return valid cache unless force refresh
      if (!forceRefresh) {
        const cached = getCachedCoords();
        if (cached) return cached;
      }

      // If fetch already in progress, wait for it
      if (fetchInProgress) {
        try {
          const result = await fetchInProgress;
          return { lat: result.lat, lon: result.lon };
        } catch (err) {
          const cached = getCachedCoords();
          if (cached) return cached;
          throw err;
        }
      }

      fetchInProgress = (async () => {
        try {
          const { lat, lon } = await fetchGPSCoords();

          // Update in-memory cache
          cachedCoords = { lat, lon };
          coordsCachedAt = Date.now();

          // Persist to localStorage
          setStoredCoords(lat, lon);

          // Also update display if we don't have one
          if (!getStoredDisplay()) {
            const r = await api.reverseGeocode(lat, lon, { silent });
            const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            setStoredDisplay(formatLocationDisplay(r, fallback));
          }

          return { lat, lon };
        } finally {
          fetchInProgress = null;
        }
      })();

      return fetchInProgress;
    }

    // Main function for listing creation
    // needsCoords: true if distance tags enabled or "show in nearest" checked
    async function getLocationForListing({ needsCoords = false, silent = false } = {}) {
      const existingDisplay = getStoredDisplay();

      // If we have display and don't need coords, return immediately
      if (existingDisplay && !needsCoords) {
        return { display: existingDisplay, lat: null, lon: null, fromCache: true };
      }

      // If we need coords, check if we have valid cached ones
      if (needsCoords) {
        const cachedCoordsResult = getCachedCoords();
        if (existingDisplay && cachedCoordsResult) {
          return {
            display: existingDisplay,
            lat: cachedCoordsResult.lat,
            lon: cachedCoordsResult.lon,
            fromCache: true
          };
        }
      }

      // Need to fetch
      try {
        if (needsCoords) {
          const coords = await fetchCoords({ silent });
          const display = getStoredDisplay() || 'Unknown location';
          return { display, lat: coords.lat, lon: coords.lon, fromCache: false };
        } else {
          const result = await fetchDisplayLocation({ silent });
          return { display: result.display, lat: null, lon: null, fromCache: false };
        }
      } catch (err) {
        console.warn('[Location] Failed to get location:', err?.message || err);
        // Return what we have
        return {
          display: existingDisplay || null,
          lat: null,
          lon: null,
          fromCache: true,
          error: err
        };
      }
    }

    // Initialize on app startup - fetch display location if not cached
    // Returns a promise that resolves to { success: boolean, error?: Error }
    async function initializeCache() {
      if (getStoredDisplay()) {
        // Already have permanent display cache, no need to fetch
        return { success: true, cached: true };
      }
      // Try to fetch and populate display cache
      try {
        await fetchDisplayLocation({ silent: true });
        return { success: true, cached: false };
      } catch (err) {
        console.warn('[Location] Initial cache failed:', err?.message || err);
        return { success: false, error: err };
      }
    }

    // Refresh coords if stale (called on app resume when distance tags enabled)
    function refreshCoordsIfStale() {
      if (areCoordsValid()) return;
      fetchCoords({ silent: true }).catch(err => {
        console.warn('[Location] Background coords refresh failed:', err?.message || err);
      });
    }

    // Update display location (when user taps "Use my location")
    async function updateDisplayLocation({ silent = false } = {}) {
      const result = await fetchDisplayLocation({ silent });
      // Also persist coords since we just fetched them
      setStoredCoords(result.lat, result.lon);
      return result;
    }

    // Warning modal helpers
    function shouldShowLocationWarning() {
      return shouldShowWarning();
    }

    function markLocationWarningShown() {
      markWarningShown();
    }

    // Legacy compatibility - wraps new logic
    async function fetchCoordsAndReverse({ silent = false, forceRefresh = false } = {}) {
      const result = await getLocationForListing({ needsCoords: true, silent });
      if (result.error && !result.display) {
        throw result.error;
      }
      return {
        lat: result.lat,
        lon: result.lon,
        display: result.display || 'Unknown location'
      };
    }

    // Legacy compatibility
    function isCacheValid() {
      return !!getStoredDisplay() || areCoordsValid();
    }

    return {
      // New API
      getLocationForListing,
      getCachedDisplay,
      getCachedCoords,
      getCachedLocation,
      updateDisplayLocation,
      refreshCoordsIfStale,
      initializeCache,
      shouldShowLocationWarning,
      markLocationWarningShown,
      // Legacy API (for backward compat)
      fetchCoordsAndReverse,
      isCacheValid
    };
  }

  if (typeof window !== 'undefined') {
    window.ListItApp = window.ListItApp || {};
    window.ListItApp.bootstrap = window.ListItApp.bootstrap || {};
    window.ListItApp.bootstrap.createLocationHelpers = createLocationHelpers;
  }
})();

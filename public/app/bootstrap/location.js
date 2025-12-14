(() => {
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

    async function fetchCoordsAndReverse({ silent = false } = {}) {
      let lat, lon;
      // Use Capacitor Geolocation on native, browser API on web
      if (isCapacitorNative()) {
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

    return {
      fetchCoordsAndReverse
    };
  }

  if (typeof window !== 'undefined') {
    window.ListItApp = window.ListItApp || {};
    window.ListItApp.bootstrap = window.ListItApp.bootstrap || {};
    window.ListItApp.bootstrap.createLocationHelpers = createLocationHelpers;
  }
})();

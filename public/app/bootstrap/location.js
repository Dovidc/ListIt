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

    async function fetchCoordsAndReverse() {
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

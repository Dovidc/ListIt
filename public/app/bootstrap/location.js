(() => {
  function createLocationHelpers({ api } = {}) {
    if (!api || typeof api.reverseGeocode !== 'function') {
      throw new Error('Location helpers require an API client with reverseGeocode.');
    }

    async function fetchCoordsAndReverse() {
      if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
      const { coords } = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
      );
      const r = await api.reverseGeocode(coords.latitude, coords.longitude);
      return {
        lat: r?.lat ?? coords.latitude,
        lon: r?.lon ?? coords.longitude,
        display: r?.display || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
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

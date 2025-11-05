(() => {
  function createAdsFeature({ React, api }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Ads feature requires React.');
    }
    if (!api) {
      throw new Error('Ads feature requires an API client.');
    }

    const { useState, useCallback, useEffect } = React;

    function useAds() {
      const [ads, setAds] = useState([]);

      const refreshAds = useCallback(async () => {
        try {
          const rows = await api.listAds({ silent: true });
          console.log('Ads API response:', rows);
          console.log('Is array?', Array.isArray(rows));
          console.log('Ads count:', Array.isArray(rows) ? rows.length : 0);
          setAds(Array.isArray(rows) ? rows : []);
        } catch (err) {
          console.error('Failed to load ads', err);
          setAds([]);
        }
      }, [api]);

      useEffect(() => { refreshAds(); }, [refreshAds]);

      return { ads, refreshAds };
    }

    return { useAds };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.ads = window.ListItApp.features.ads || {};
  window.ListItApp.features.ads.createAdsFeature = createAdsFeature;
})();

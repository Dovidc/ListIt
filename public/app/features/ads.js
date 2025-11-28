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
          setAds(Array.isArray(rows) ? rows : []);
        } catch {
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

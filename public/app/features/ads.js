(() => {
  function createAdsFeature({ React, api }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Ads feature requires React.');
    }
    if (!api) {
      throw new Error('Ads feature requires an API client.');
    }

    const { useState, useCallback, useEffect } = React;

    function useAds({ userLat, userLon, isPremium, loading } = {}) {
      const [ads, setAds] = useState([]);

      const refreshAds = useCallback(async () => {
        console.log('[useAds] refreshAds called', { userLat, userLon, isPremium, loading });
        // Don't fetch ads while auth is still loading
        if (loading) {
          console.log('[useAds] Auth still loading, skipping ads fetch');
          return;
        }
        // PAYMENTS DISABLED - App is free, show ads to everyone
        // if (isPremium) {
        //   console.log('[useAds] User is premium, showing no ads');
        //   setAds([]);
        //   return;
        // }
        try {
          const params = {};
          if (userLat != null && userLon != null) {
            params.lat = userLat;
            params.lon = userLon;
          }
          console.log('[useAds] Fetching ads with params:', params);
          const rows = await api.listAds(params, { silent: true });
          console.log('[useAds] Got ads:', rows);
          setAds(Array.isArray(rows) ? rows : []);
        } catch (err) {
          console.error('[useAds] Error fetching ads:', err);
          setAds([]);
        }
      }, [userLat, userLon, isPremium, loading]);

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

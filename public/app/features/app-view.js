(() => {
  function createAppViewFeature({ React, helpers }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('App view feature requires React.');
    }

    const isMobileDevice = helpers?.isMobileDevice;
    if (typeof isMobileDevice !== 'function') {
      throw new Error('App view feature requires isMobileDevice helper.');
    }

    const { useState, useEffect, useCallback } = React;

    function useAppView({ user } = {}) {
      const [tab, setTab] = useState('browse');
      const [banner, setBanner] = useState(null);
      const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'login' });
      const [viewingSeller, setViewingSeller] = useState(null);
      const isMobile = isMobileDevice();

      const showLockedBanner = useCallback(() => {
        setBanner({
          type: 'locked',
          message: 'Your account is locked. Please message an admin for help.',
          ts: Date.now()
        });
      }, []);

      const dismissBanner = useCallback(() => setBanner(null), []);

      const handleTabChange = useCallback((newTab) => {
        if (newTab === 'admin' && !user?.is_admin) {
          return;
        }
        if (newTab === 'nearby' && !isMobile) {
          return;
        }
        setTab(newTab);
        setViewingSeller(null);
      }, [user?.is_admin, isMobile]);

      useEffect(() => {
        if (!user?.is_admin && tab === 'admin') {
          setTab('browse');
        }
      }, [user?.is_admin, tab]);

      useEffect(() => {
        if (!user && tab === 'messages') {
          setTab('browse');
        }
        if (!isMobile && tab === 'nearby') {
          setTab('browse');
        }
      }, [user, tab, isMobile]);

      // Show locked banner automatically when a locked user logs in or app loads
      useEffect(() => {
        if (user?.account_status === 'locked') {
          setBanner({
            type: 'locked',
            message: 'Your account is locked. Please message an admin for help.',
            ts: Date.now()
          });
        }
      }, [user?.account_status]);

      const openAuthModal = useCallback((mode = 'login') => {
        setAuthModal({ isOpen: true, mode });
      }, []);

      return {
        tab,
        setTab,
        banner,
        setBanner,
        showLockedBanner,
        dismissBanner,
        viewingSeller,
        setViewingSeller,
        authModal,
        setAuthModal,
        handleTabChange,
        openAuthModal,
        isMobile
      };
    }

    return {
      useAppView
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.appView = {
    createAppViewFeature
  };
})();

(() => {
  function createAppNav() {
    return {
      setUser: () => {},
      setTab: () => {},
      incLoad: () => {},
      decLoad: () => {},
      notifyLocked: () => {}
    };
  }

  if (typeof window !== 'undefined') {
    window.ListItApp = window.ListItApp || {};
    window.ListItApp.bootstrap = window.ListItApp.bootstrap || {};
    window.ListItApp.bootstrap.createAppNav = createAppNav;
  }
})();

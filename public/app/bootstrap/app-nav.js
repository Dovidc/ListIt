(() => {
  function createAppNav() {
    return {
      setUser: () => {},
      setTab: () => {},
      incLoad: () => {},
      decLoad: () => {},
      notifyLocked: () => {},
      setActiveConvoId: () => {},
      // Store pending notification data for cold-start scenarios
      pendingConversationId: null
    };
  }

  if (typeof window !== 'undefined') {
    window.ListItApp = window.ListItApp || {};
    window.ListItApp.bootstrap = window.ListItApp.bootstrap || {};
    window.ListItApp.bootstrap.createAppNav = createAppNav;
  }
})();

(() => {
  function createNotificationsContext({ React }) {
    if (!React || typeof React.createContext !== 'function') {
      throw new Error('Notifications context requires React.');
    }

    const { createContext, useContext } = React;
    const NotificationsContext = createContext(null);

    function NotificationsProvider({ value, children }) {
      if (!value) {
        throw new Error('NotificationsProvider requires a value.');
      }
      return React.createElement(NotificationsContext.Provider, { value }, children);
    }

    function useNotifications() {
      const ctx = useContext(NotificationsContext);
      if (!ctx) {
        throw new Error('useNotifications must be used within a NotificationsProvider.');
      }
      return ctx;
    }

    return {
      NotificationsProvider,
      useNotifications
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.contexts = window.ListItApp.contexts || {};
  window.ListItApp.contexts.notifications = {
    createNotificationsContext
  };
})();

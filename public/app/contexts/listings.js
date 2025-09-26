(() => {
  function createListingsContext({ React }) {
    if (!React || typeof React.createContext !== 'function') {
      throw new Error('Listings context requires React.');
    }

    const { createContext, useContext } = React;
    const ListingsContext = createContext(null);

    function ListingsProvider({ value, children }) {
      if (!value) {
        throw new Error('ListingsProvider requires a value.');
      }
      return React.createElement(ListingsContext.Provider, { value }, children);
    }

    function useListings() {
      const ctx = useContext(ListingsContext);
      if (!ctx) {
        throw new Error('useListings must be used within a ListingsProvider.');
      }
      return ctx;
    }

    return {
      ListingsProvider,
      useListings
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.contexts = window.ListItApp.contexts || {};
  window.ListItApp.contexts.listings = {
    createListingsContext
  };
})();

(() => {
  const {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    createContext
  } = React;

  const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

  function createLoadingFeature({ AppNav }) {
    if (!AppNav || typeof AppNav !== 'object') {
      throw new Error('Loading feature requires an AppNav bridge object.');
    }

    const LoadingContext = createContext(null);

    function GlobalLoadingProvider({ children }) {
      const [activeCount, setActiveCount] = useState(0);

      const begin = useCallback(() => {
        setActiveCount((count) => count + 1);
      }, []);

      const end = useCallback(() => {
        setActiveCount((count) => Math.max(0, count - 1));
      }, []);

      const reset = useCallback(() => {
        setActiveCount(0);
      }, []);

      useEffect(() => {
        const previousInc = AppNav.incLoad;
        const previousDec = AppNav.decLoad;

        AppNav.incLoad = begin;
        AppNav.decLoad = end;

        return () => {
          AppNav.incLoad = typeof previousInc === 'function' ? previousInc : () => {};
          AppNav.decLoad = typeof previousDec === 'function' ? previousDec : () => {};
        };
      }, [AppNav, begin, end]);

      const value = useMemo(() => ({
        activeCount,
        isLoading: activeCount > 0,
        begin,
        end,
        reset
      }), [activeCount, begin, end, reset]);

      return H(LoadingContext.Provider, { value },
        children,
        value.isLoading && H('div', {
          className: 'global-loader',
          role: 'status',
          'aria-live': 'assertive'
        },
          H('div', { className: 'spinner', 'aria-hidden': true }),
          H('div', { className: 'loader-text' }, 'Loading...')
        )
      );
    }

    function useGlobalLoading() {
      const ctx = useContext(LoadingContext);
      if (!ctx) {
        throw new Error('useGlobalLoading must be used within a GlobalLoadingProvider.');
      }
      return ctx;
    }

    return {
      GlobalLoadingProvider,
      useGlobalLoading
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.loading = {
    createLoadingFeature
  };
})();

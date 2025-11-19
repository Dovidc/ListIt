(() => {
  function createPreferencesFeature({ React }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Preferences feature requires React.');
    }

    const { useState, useEffect, useMemo, useCallback } = React;

    function createStoredToggle(key, defaultValue = false) {
      const readInitial = () => {
        try {
          const raw = localStorage.getItem(key);
          if (raw === null) return Boolean(defaultValue);
          return raw === '1';
        } catch {
          return defaultValue;
        }
      };

      const writeValue = (value) => {
        try {
          localStorage.setItem(key, value ? '1' : '0');
        } catch {
          // ignore storage errors
        }
      };

      function useStoredToggle() {
        const [enabled, setEnabled] = useState(readInitial);

        useEffect(() => {
          writeValue(enabled);
        }, [enabled]);

        return useMemo(() => ({
          enabled,
          setEnabled
        }), [enabled]);
      }

      return useStoredToggle;
    }

    function useAlwaysOnAutoList() {
      useEffect(() => {
        try {
          localStorage.setItem('listit_auto_list', '1');
        } catch {
          // ignore storage errors
        }
      }, []);

      const noop = useCallback(() => { }, []);

      return useMemo(() => ({
        enabled: true,
        setEnabled: noop
      }), [noop]);
    }
    const useAiDescriptionToggle = createStoredToggle('listit_ai_descriptions');
    const useAutoPostNearbyToggle = createStoredToggle('listit_auto_post_nearby');
    const useInquiryTextToggle = createStoredToggle('listit_auto_inquiry', true);
    const useCreateActionToggle = createStoredToggle('listit_ask_create_action', false);

    function useAppPreferences() {
      const autoList = useAlwaysOnAutoList();
      const aiDescription = useAiDescriptionToggle();
      const autoNearby = useAutoPostNearbyToggle();
      const inquiryText = useInquiryTextToggle();
      const createAction = useCreateActionToggle();

      return {
        autoListEnabled: autoList.enabled,
        setAutoListEnabled: autoList.setEnabled,
        aiDescriptionEnabled: aiDescription.enabled,
        setAiDescriptionEnabled: aiDescription.setEnabled,
        autoPostNearbyEnabled: autoNearby.enabled,
        setAutoPostNearbyEnabled: autoNearby.setEnabled,
        autoInquiryEnabled: inquiryText.enabled,
        setAutoInquiryEnabled: inquiryText.setEnabled,
        askCreateActionEnabled: createAction.enabled,
        setAskCreateActionEnabled: createAction.setEnabled
      };
    }

    return {
      useAppPreferences
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.preferences = window.ListItApp.features.preferences || {};
  window.ListItApp.features.preferences.createPreferencesFeature = createPreferencesFeature;
})();

(() => {
  function createUploadsHooks({ React } = {}) {
    if (!React || typeof React.useState !== 'function' || typeof React.useEffect !== 'function') {
      throw new Error('Uploads hooks require React.');
    }

    const { useState, useEffect } = React;

    function useFilePreviews(files = []) {
      const [previews, setPreviews] = useState([]);

      useEffect(() => {
        const list = Array.isArray(files) ? files : [];
        if (list.length === 0) {
          setPreviews([]);
          return undefined;
        }

        const entries = list.map((file) => ({ file, url: URL.createObjectURL(file) }));
        setPreviews(entries);

        return () => {
          for (const entry of entries) {
            try {
              URL.revokeObjectURL(entry.url);
            } catch {
              // ignore revoke failures
            }
          }
        };
      }, [files]);

      return previews;
    }

    return {
      useFilePreviews
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.uploads = window.ListItApp.features.uploads || {};
  window.ListItApp.features.uploads.createUploadsHooks = createUploadsHooks;
})();

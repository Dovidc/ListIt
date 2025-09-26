(() => {
  function createListingQueueFeature({ React }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Listing queue feature requires React.');
    }

    const { useState, useRef, useCallback, useEffect } = React;

    function useListingQueue(options = {}) {
      const reminderDuration = Number.isFinite(options.reminderDuration)
        ? options.reminderDuration
        : 2000;

      const listingQueueRef = useRef([]);
      const listingQueueProcessingRef = useRef(false);
      const [showQueueToast, setShowQueueToast] = useState(false);
      const toastTimerRef = useRef(null);
      const [queuePendingCount, setQueuePendingCount] = useState(0);
      const backgroundQueueEnabled = true;

      const showQueueReminder = useCallback(() => {
        setShowQueueToast(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setShowQueueToast(false), reminderDuration);
      }, [reminderDuration]);

      useEffect(() => () => {
        if (toastTimerRef.current) {
          clearTimeout(toastTimerRef.current);
          toastTimerRef.current = null;
        }
      }, []);

      useEffect(() => () => {
        listingQueueRef.current = [];
        listingQueueProcessingRef.current = false;
      }, []);

      const processNextListingJob = useCallback(() => {
        if (listingQueueProcessingRef.current) return;
        const job = listingQueueRef.current.shift();
        if (!job) {
          setQueuePendingCount(0);
          return;
        }
        listingQueueProcessingRef.current = true;
        Promise.resolve()
          .then(() => job())
          .catch((err) => { console.error('Background listing job failed:', err); })
          .finally(() => {
            listingQueueProcessingRef.current = false;
            setQueuePendingCount(listingQueueRef.current.length);
            processNextListingJob();
          });
      }, []);

      const enqueueListingJob = useCallback((job) => {
        if (typeof job !== 'function') return;
        listingQueueRef.current.push(job);
        setQueuePendingCount(listingQueueRef.current.length + (listingQueueProcessingRef.current ? 1 : 0));
        showQueueReminder();
        processNextListingJob();
      }, [processNextListingJob, showQueueReminder]);

      return {
        backgroundQueueEnabled,
        showQueueToast,
        queuePendingCount,
        enqueueListingJob
      };
    }

    return {
      useListingQueue
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.listingQueue = {
    createListingQueueFeature
  };
})();

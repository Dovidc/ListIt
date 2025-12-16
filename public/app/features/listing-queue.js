const DEFAULT_REMINDER_DURATION = 2000;

export function createListingQueueFeature({ React }) {
  if (!React || typeof React.useState !== 'function') {
    throw new Error('Listing queue feature requires React.');
  }

  const { useState, useRef, useCallback, useEffect, useMemo } = React;

  function useListingQueue(options = {}) {
    const reminderDuration = Number.isFinite(options.reminderDuration)
      ? options.reminderDuration
      : DEFAULT_REMINDER_DURATION;

    const listingQueueRef = useRef([]);
    const listingQueueProcessingRef = useRef(false);
    const [showQueueToast, setShowQueueToast] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0); // Track uploads in progress
    const toastTimerRef = useRef(null);
    const [queuePendingCount, setQueuePendingCount] = useState(0);
    const backgroundQueueEnabled = true;

    // Show "Keep app open" toast - stays visible until hideUploadingToast is called
    const showUploadingToast = useCallback(() => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setUploadingCount(c => c + 1);
      setShowQueueToast(true);
    }, []);

    // Hide the toast when upload is complete (safe to close app)
    const hideUploadingToast = useCallback(() => {
      setUploadingCount(c => {
        const newCount = Math.max(0, c - 1);
        if (newCount === 0) {
          setShowQueueToast(false);
        }
        return newCount;
      });
    }, []);

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

    return useMemo(() => ({
      backgroundQueueEnabled,
      showQueueToast,
      queuePendingCount,
      uploadingCount,
      enqueueListingJob,
      showUploadingToast,
      hideUploadingToast
    }), [backgroundQueueEnabled, showQueueToast, queuePendingCount, uploadingCount, enqueueListingJob, showUploadingToast, hideUploadingToast]);
  }

  return {
    useListingQueue
  };
}

export default createListingQueueFeature;

if (typeof window !== 'undefined') {
  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.listingQueue = {
    createListingQueueFeature
  };
}

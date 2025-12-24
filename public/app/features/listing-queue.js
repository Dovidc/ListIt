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
    const [toastComplete, setToastComplete] = useState(false); // Show checkmark when complete
    const toastTimerRef = useRef(null);
    const checkmarkTimerRef = useRef(null);
    const [queuePendingCount, setQueuePendingCount] = useState(0);
    const backgroundQueueEnabled = true;

    // Show "Listing in progress" toast with spinner
    const showUploadingToast = useCallback(() => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (checkmarkTimerRef.current) clearTimeout(checkmarkTimerRef.current);
      setToastComplete(false);
      setUploadingCount(c => c + 1);
      setShowQueueToast(true);
    }, []);

    // Hide the toast when upload is complete - show checkmark first, then hide
    const hideUploadingToast = useCallback(() => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (checkmarkTimerRef.current) clearTimeout(checkmarkTimerRef.current);
      // Show checkmark
      setToastComplete(true);
      // After 1 second, hide the toast
      checkmarkTimerRef.current = setTimeout(() => {
        setUploadingCount(c => Math.max(0, c - 1));
        setShowQueueToast(false);
        setToastComplete(false);
      }, 1000);
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
      toastComplete,
      enqueueListingJob,
      showUploadingToast,
      hideUploadingToast
    }), [backgroundQueueEnabled, showQueueToast, queuePendingCount, uploadingCount, toastComplete, enqueueListingJob, showUploadingToast, hideUploadingToast]);
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

(() => {
  function createListingQueueContext({ React, useListingQueue }) {
    if (!React || typeof React.createContext !== 'function') {
      throw new Error('Listing queue context requires React.');
    }
    if (typeof useListingQueue !== 'function') {
      throw new Error('Listing queue context requires useListingQueue hook.');
    }

    const { createContext, useContext, useMemo } = React;
    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);
    const ListingQueueContext = createContext(null);

    function ListingQueueProvider({ children, reminderDuration }) {
      const queueValue = useListingQueue({ reminderDuration });
      const {
        backgroundQueueEnabled,
        showQueueToast,
        queuePendingCount,
        uploadingCount,
        enqueueListingJob,
        showUploadingToast,
        hideUploadingToast
      } = queueValue;

      const value = useMemo(() => queueValue, [
        backgroundQueueEnabled,
        showQueueToast,
        queuePendingCount,
        uploadingCount,
        enqueueListingJob,
        showUploadingToast,
        hideUploadingToast
      ]);

      return H(ListingQueueContext.Provider, { value }, children);
    }

    function useListingQueueState() {
      const ctx = useContext(ListingQueueContext);
      if (!ctx) {
        throw new Error('useListingQueueState must be used within a ListingQueueProvider.');
      }
      return ctx;
    }

    function ListingQueueToast({ message = 'listing in progress', icon = '✓', className = '' } = {}) {
      const { showQueueToast, queuePendingCount, uploadingCount } = useListingQueueState();
      const toastClass = `listing-queue-toast${showQueueToast ? ' show' : ''}${className ? ` ${className}` : ''}`;

      // Show "Listing in progress" when uploading, otherwise show the default message
      const displayMessage = uploadingCount > 0 ? 'Listing in progress' : message;
      const displayIcon = icon;

      return H('div', {
        className: toastClass,
        'aria-live': 'polite',
        'data-count': queuePendingCount > 0 ? queuePendingCount : undefined
      },
        H('span', { className: 'listing-queue-toast__icon', 'aria-hidden': true }, displayIcon),
        H('span', { className: 'listing-queue-toast__text' }, displayMessage)
      );
    }

    return {
      ListingQueueProvider,
      useListingQueueState,
      ListingQueueToast
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.contexts = window.ListItApp.contexts || {};
  window.ListItApp.contexts.listingQueue = {
    createListingQueueContext
  };
})();

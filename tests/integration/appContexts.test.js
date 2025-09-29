const path = require('path');

function createReactMocks({ includeUseMemo = false } = {}) {
  const contextState = { current: null };

  const Provider = jest.fn(({ value, children }) => {
    contextState.current = value;
    return { type: 'Provider', props: { value, children } };
  });

  const React = {
    createContext: jest.fn(() => ({ Provider })),
    useContext: jest.fn(() => contextState.current),
    createElement: jest.fn((component, props = {}, ...children) => {
      const normalizedChildren = children.length <= 1 ? children[0] : children;
      if (typeof component === 'function') {
        return component({ ...props, children: normalizedChildren });
      }
      return { type: component, props: { ...props, children: normalizedChildren } };
    })
  };

  if (includeUseMemo) {
    const memoCalls = [];
    const useMemo = jest.fn((factory, deps) => {
      const value = factory();
      memoCalls.push({ value, deps });
      return value;
    });
    useMemo.__memoCalls = memoCalls;
    React.useMemo = useMemo;
  }

  return { React, Provider, contextState };
}

describe('app contexts integration', () => {
  afterEach(() => {
    delete global.window;
    jest.resetModules();
  });

  describe('listing queue context', () => {
    const modulePath = path.join(__dirname, '..', '..', 'public', 'app', 'contexts', 'listing-queue.js');

    function loadFactory() {
      global.window = {};
      // eslint-disable-next-line global-require, import/no-dynamic-require
      require(modulePath);
      return global.window.ListItApp.contexts.listingQueue.createListingQueueContext;
    }

    test('registers factory and provides queue state utilities', () => {
      const factory = loadFactory();
      const queueValue = {
        backgroundQueueEnabled: true,
        showQueueToast: true,
        queuePendingCount: 2,
        enqueueListingJob: jest.fn()
      };
      const useListingQueue = jest.fn(() => queueValue);
      const { React, Provider, contextState } = createReactMocks({ includeUseMemo: true });

      const { ListingQueueProvider, useListingQueueState, ListingQueueToast } = factory({
        React,
        useListingQueue
      });

      expect(() => useListingQueueState()).toThrow('useListingQueueState must be used within a ListingQueueProvider.');

      const rendered = ListingQueueProvider({ reminderDuration: 90, children: 'children' });

      expect(useListingQueue).toHaveBeenCalledWith({ reminderDuration: 90 });
      expect(Provider).toHaveBeenCalledWith({ value: queueValue, children: 'children' });
      expect(contextState.current).toBe(queueValue);
      expect(rendered).toEqual({ type: 'Provider', props: { value: queueValue, children: 'children' } });

      const memoSnapshot = React.useMemo.__memoCalls[0];
      expect(memoSnapshot.deps).toEqual([
        queueValue.backgroundQueueEnabled,
        queueValue.showQueueToast,
        queueValue.queuePendingCount,
        queueValue.enqueueListingJob
      ]);

      expect(useListingQueueState()).toBe(queueValue);

      const toast = ListingQueueToast({ message: 'Processing', icon: '!' });
      expect(toast.type).toBe('div');
      expect(toast.props.className).toBe('listing-queue-toast show');
      expect(toast.props['data-count']).toBe(queueValue.queuePendingCount);

      const [iconNode, textNode] = toast.props.children;
      expect(iconNode.props.className).toBe('listing-queue-toast__icon');
      expect(iconNode.props.children).toBe('!');
      expect(textNode.props.className).toBe('listing-queue-toast__text');
      expect(textNode.props.children).toBe('Processing');
    });

    test('enforces required dependencies', () => {
      const factory = loadFactory();
      expect(() => factory({ React: {} })).toThrow('Listing queue context requires React.');
      expect(() => factory({ React: { createContext: jest.fn() } })).toThrow('Listing queue context requires useListingQueue hook.');
    });
  });

  describe('listings context', () => {
    const modulePath = path.join(__dirname, '..', '..', 'public', 'app', 'contexts', 'listings.js');

    function loadFactory() {
      global.window = {};
      // eslint-disable-next-line global-require, import/no-dynamic-require
      require(modulePath);
      return global.window.ListItApp.contexts.listings.createListingsContext;
    }

    test('registers provider and hook on global namespace', () => {
      const factory = loadFactory();
      const { React, Provider, contextState } = createReactMocks();

      const { ListingsProvider, useListings } = factory({ React });

      expect(() => ListingsProvider({ children: 'child' })).toThrow('ListingsProvider requires a value.');
      expect(() => useListings()).toThrow('useListings must be used within a ListingsProvider.');

      const value = { listings: ['one'] };
      const rendered = ListingsProvider({ value, children: 'child' });

      expect(Provider).toHaveBeenCalledWith({ value, children: 'child' });
      expect(rendered).toEqual({ type: 'Provider', props: { value, children: 'child' } });
      expect(contextState.current).toBe(value);

      expect(useListings()).toBe(value);
    });

    test('requires React with createContext and useContext', () => {
      const factory = loadFactory();
      expect(() => factory({ React: {} })).toThrow('Listings context requires React.');
    });
  });

  describe('notifications context', () => {
    const modulePath = path.join(__dirname, '..', '..', 'public', 'app', 'contexts', 'notifications.js');

    function loadFactory() {
      global.window = {};
      // eslint-disable-next-line global-require, import/no-dynamic-require
      require(modulePath);
      return global.window.ListItApp.contexts.notifications.createNotificationsContext;
    }

    test('exposes provider and hook for notifications state', () => {
      const factory = loadFactory();
      const { React, Provider, contextState } = createReactMocks();

      const { NotificationsProvider, useNotifications } = factory({ React });

      expect(() => NotificationsProvider({ children: 'child' })).toThrow('NotificationsProvider requires a value.');
      expect(() => useNotifications()).toThrow('useNotifications must be used within a NotificationsProvider.');

      const value = { toasts: [] };
      const rendered = NotificationsProvider({ value, children: 'child' });

      expect(Provider).toHaveBeenCalledWith({ value, children: 'child' });
      expect(rendered).toEqual({ type: 'Provider', props: { value, children: 'child' } });
      expect(contextState.current).toBe(value);

      expect(useNotifications()).toBe(value);
    });

    test('requires a valid React implementation', () => {
      const factory = loadFactory();
      expect(() => factory({ React: {} })).toThrow('Notifications context requires React.');
    });
  });
});

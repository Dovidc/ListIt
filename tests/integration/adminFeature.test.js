const path = require('path');

const adminFeaturePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'admin.js'
);

function resetGlobals() {
  delete global.window;
  delete global.document;
  delete global.alert;
}

function loadFactory() {
  jest.resetModules();
  global.window = { ListItApp: { features: { admin: {} } } };
  global.document = { body: {} };
  global.alert = jest.fn();

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(adminFeaturePath);

  return global.window.ListItApp.features.admin.createAdminFeature;
}

describe('admin feature integration', () => {
  afterEach(() => {
    resetGlobals();
  });

  test('registers factory and enforces dependency contract', () => {
    const factory = loadFactory();

    expect(() => factory()).toThrow('Admin feature requires React.');

    const React = { createElement: jest.fn(), useCallback: jest.fn((fn) => fn) };
    expect(() => factory({ React })).toThrow('Admin feature requires ReactDOM.');

    const ReactDOM = { createPortal: jest.fn() };
    expect(() => factory({ React, ReactDOM })).toThrow('Admin feature requires an API client.');

    const api = {};
    expect(() => factory({ React, ReactDOM, api })).toThrow('Admin feature requires AdTile component.');

    const components = { AdTile: jest.fn() };
    expect(() => factory({ React, ReactDOM, api, components })).toThrow('Admin feature requires admin state module.');

    const stateModule = {
      useAdminDashboardState: jest.fn(() => ({})),
      createEmptyAdForm: jest.fn(),
      useAdminListingActions: jest.fn()
    };
    global.window.ListItApp.features.admin.createAdminStateModule = jest.fn(() => stateModule);

    expect(() => factory({ React, ReactDOM, api, components })).toThrow('Admin feature requires admin components.');

    const FlaggedDetailsModal = jest.fn();
    global.window.ListItApp.features.admin.createAdminComponents = jest.fn(() => ({ FlaggedDetailsModal }));

    const result = factory({ React, ReactDOM, api, components });

    expect(global.window.ListItApp.features.admin.createAdminStateModule).toHaveBeenCalledWith({ React, api });
    expect(global.window.ListItApp.features.admin.createAdminComponents).toHaveBeenCalledWith({ React, ReactDOM });

    expect(result).toEqual(
      expect.objectContaining({
        AdminDashboard: expect.any(Function),
        FlaggedDetailsModal,
        createEmptyAdForm: stateModule.createEmptyAdForm,
        useAdminListingActions: expect.any(Function)
      })
    );
  });

  test('wires admin dashboard with state module and feature components', () => {
    const factory = loadFactory();
    const React = {
      createElement: jest.fn((type, props = {}, ...children) => {
        const finalProps = {
          ...props,
          children: children.length <= 1 ? children[0] : children
        };
        if (typeof type === 'function') {
          return type(finalProps);
        }
        return { type, props: finalProps };
      }),
      useCallback: jest.fn((fn) => fn)
    };
    const ReactDOM = { createPortal: jest.fn((node) => node) };
    const api = {};

    const AdTile = jest.fn(() => ({ type: 'AdTile' }));
    const components = { AdTile };

    const dashboardState = {
      tab: 'ads',
      setTab: jest.fn(),
      searchTerm: '',
      setSearchTerm: jest.fn(),
      searchResults: [],
      searchLoading: false,
      searchError: null,
      selectedUserId: null,
      selectedUser: null,
      userLoading: false,
      userError: null,
      userReports: [],
      reportsLoading: false,
      reportsError: null,
      topReports: [],
      topLoading: false,
      topError: null,
      topDays: 7,
      setTopDays: jest.fn(),
      topMin: 1,
      setTopMin: jest.fn(),
      loadTopReports: jest.fn(),
      flaggedList: [],
      flaggedLoading: false,
      flaggedError: null,
      flaggedDetailModal: { detail: { id: 1 }, item: { id: 2 } },
      openFlaggedDetail: jest.fn(),
      closeFlaggedDetail: jest.fn(),
      dismissingFlaggedId: null,
      handleDismissFlagged: jest.fn(),
      handleMessageFlagged: jest.fn(),
      loadFlagged: jest.fn(),
      adsList: [
        { id: 1, title: 'Ad', target_url: 'https://example.com', position: 1, is_active: true }
      ],
      adsLoading: false,
      adsError: null,
      loadAds: jest.fn(),
      adForm: {
        title: 'Ad',
        target_url: 'https://example.com',
        subtitle: '',
        image_url: '',
        cta_label: '',
        background: '',
        position: 1,
        is_active: true
      },
      setAdForm: jest.fn((updater) => (typeof updater === 'function' ? updater(dashboardState.adForm) : updater)),
      adSaving: false,
      editingAdId: null,
      handleAdSubmit: jest.fn((event) => event && event.preventDefault && event.preventDefault()),
      resetAdForm: jest.fn(),
      handleEditAd: jest.fn(),
      handleDeleteAd: jest.fn(),
      handleToggleAdActive: jest.fn(),
      seedBusy: false,
      seedDeleteBusy: false,
      seedMessage: '',
      seedError: null,
      seedCount: 10,
      setSeedCount: jest.fn(),
      handleSeedListings: jest.fn(),
      handleDeleteSeedListings: jest.fn(),
      seedActionsDisabled: false,
      loadUser: jest.fn(),
      handleStatusChange: jest.fn(),
      handleViewUserFromTop: jest.fn(),
      handleClearReportsForUser: jest.fn()
    };

    const useAdminDashboardState = jest.fn(() => dashboardState);
    const createEmptyAdForm = jest.fn(() => ({ title: '', target_url: '' }));
    const useAdminListingActions = jest.fn();

    const FlaggedDetailsModal = jest.fn(() => ({ type: 'FlaggedDetailsModal' }));

    global.window.ListItApp.features.admin.createAdminStateModule = jest.fn(() => ({
      useAdminDashboardState,
      createEmptyAdForm,
      useAdminListingActions
    }));

    global.window.ListItApp.features.admin.createAdminComponents = jest.fn(() => ({
      FlaggedDetailsModal
    }));

    const { AdminDashboard } = factory({ React, ReactDOM, api, components });

    const onAdsUpdated = jest.fn();
    const onMessageUser = jest.fn();
    AdminDashboard({ onAdsUpdated, onMessageUser });

    expect(useAdminDashboardState).toHaveBeenCalledWith({ onAdsUpdated, onMessageUser });
    expect(FlaggedDetailsModal).toHaveBeenCalledWith({
      open: true,
      detail: { id: 1 },
      item: { id: 2 },
      onClose: dashboardState.closeFlaggedDetail
    });

    expect(AdTile).toHaveBeenCalled();
    const callWithExistingAd = AdTile.mock.calls.find(([props]) => props?.ad?.id === 1);
    expect(callWithExistingAd).toBeDefined();
    expect(callWithExistingAd[0]).toEqual(expect.objectContaining({
      cols: 3,
      preview: true
    }));

    const previewButtonCall = React.createElement.mock.calls.find(([type, props, ...children]) =>
      type === 'button' && children.includes('Open ad preview')
    );
    expect(previewButtonCall).toBeDefined();
    expect(previewButtonCall[1]).toEqual(expect.objectContaining({
      disabled: false,
      onClick: expect.any(Function)
    }));
  });

  test('useAdminListingActions coordinates listing updates with the API client', async () => {
    const factory = loadFactory();
    const React = { createElement: jest.fn(), useCallback: jest.fn((fn) => fn) };
    const ReactDOM = { createPortal: jest.fn() };
    const api = { adminDeleteAll: jest.fn().mockResolvedValue(undefined) };
    const components = { AdTile: jest.fn() };

    global.window.ListItApp.features.admin.createAdminStateModule = jest.fn(() => ({
      useAdminDashboardState: jest.fn(() => ({})),
      createEmptyAdForm: jest.fn(() => ({})),
      useAdminListingActions: jest.fn()
    }));
    global.window.ListItApp.features.admin.createAdminComponents = jest.fn(() => ({
      FlaggedDetailsModal: jest.fn()
    }));

    const { useAdminListingActions } = factory({ React, ReactDOM, api, components });

    let allListings = [
      { id: 1, title: 'A' },
      { id: 2, title: 'B' }
    ];
    let mineListings = [
      { id: 1, title: 'Mine' },
      { id: 3, title: 'Other' }
    ];

    const setAllListings = jest.fn((updater) => {
      allListings = typeof updater === 'function' ? updater(allListings) : updater;
      return allListings;
    });
    const setMineListings = jest.fn((updater) => {
      mineListings = typeof updater === 'function' ? updater(mineListings) : updater;
      return mineListings;
    });

    const actions = useAdminListingActions({ setAllListings, setMineListings });

    await actions.handleAdminDeleteAll();
    expect(api.adminDeleteAll).toHaveBeenCalledTimes(1);
    expect(setAllListings).toHaveBeenLastCalledWith([]);
    expect(setMineListings).toHaveBeenLastCalledWith([]);

    allListings = [
      { id: 1, title: 'A' },
      { id: 2, title: 'B' }
    ];
    mineListings = [
      { id: 1, title: 'Mine' },
      { id: 3, title: 'Other' }
    ];

    actions.handleAdminDelete(1);
    expect(setAllListings).toHaveBeenCalled();
    expect(setMineListings).toHaveBeenCalled();
    expect(allListings).toEqual([{ id: 2, title: 'B' }]);
    expect(mineListings).toEqual([{ id: 3, title: 'Other' }]);

    actions.handleAdminDelete(null);
    expect(setAllListings).toHaveBeenCalledTimes(2);
    expect(setMineListings).toHaveBeenCalledTimes(2);
  });
});

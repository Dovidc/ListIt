const path = require('path');
const { pathToFileURL } = require('url');

function fileUrl(relativePath) {
  return pathToFileURL(path.join(__dirname, '..', relativePath)).href;
}

describe('web feature contexts', () => {
  let core;

  beforeAll(async () => {
    core = await import(fileUrl('../packages/core/dist/index.mjs'));
  });

  test('auth bootstrap consumes shared api client', async () => {
    const fakeUser = { id: 42, username: 'modular', vapid_public_key: 'TESTKEY' };
    const fetchImpl = jest.fn(async (input) => {
      if (input === '/api/me') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(fakeUser)
        };
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const api = core.createApiClient({ fetchImpl });
    const { bootstrapAuthStateForTest, normalizePushMeta } = await import(fileUrl('../public/features/auth/AuthContext.mjs'));

    const helpers = await bootstrapAuthStateForTest(api);
    const snapshot = helpers.getState();

    expect(fetchImpl).toHaveBeenCalledWith('/api/me', {
      credentials: 'include',
      method: 'GET'
    });
    expect(snapshot.user).toEqual(fakeUser);
    expect(snapshot.pushMeta).toEqual(normalizePushMeta(fakeUser));

    helpers.setUser(null);
    const cleared = helpers.getState();
    expect(cleared.user).toBeNull();
    expect(cleared.pushMeta).toEqual({ available: false, vapidPublicKey: null });
  });

  test('listings store mirrors API responses', async () => {
    const listings = [{ id: 1, title: 'Bike' }, { id: 2, title: 'Desk' }];
    const fetchImpl = jest.fn(async (input) => {
      if (typeof input === 'string' && input.startsWith('/api/listings')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ rows: listings, hasNext: true })
        };
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    const api = core.createApiClient({ fetchImpl });
    const { createListingsStateForTest } = await import(fileUrl('../public/features/listings/ListingsContext.mjs'));

    const store = createListingsStateForTest();
    const response = await api.listAll({ q: 'bike' });

    store.setQuery('bike');
    store.setAll(response.rows);
    store.setHasNext(response.hasNext);

    expect(store.state.query).toBe('bike');
    expect(store.state.debouncedQuery).toBe('bike');
    expect(store.state.all).toEqual(listings);
    expect(store.state.hasNext).toBe(true);
  });

  test('uploads preferences persist to storage', async () => {
    const storage = new Map();
    const { createUploadsStateForTest } = await import(fileUrl('../public/features/uploads/UploadsContext.mjs'));

    const store = createUploadsStateForTest(storage);
    store.setAutoListEnabled(true);
    store.setAiDescriptionEnabled(true);
    store.setAutoPostNearbyEnabled(true);
    store.setShowQueueToast(true);
    store.enqueueListingJob(() => {});
    store.enqueueListingJob(() => {});
    expect(store.state.queuePendingCount).toBe(2);
    store.setQueuePendingCount(3);

    expect(storage.get('listit_auto_list')).toBe('1');
    expect(storage.get('listit_ai_descriptions')).toBe('1');
    expect(storage.get('listit_auto_post_nearby')).toBe('1');
    expect(store.state.showQueueToast).toBe(true);
    expect(store.state.queuePendingCount).toBe(3);
  });

  test('notifications store tracks toast metadata', async () => {
    const { createNotificationsStateForTest } = await import(fileUrl('../public/features/notifications/NotificationsContext.mjs'));

    const store = createNotificationsStateForTest();
    store.setBanner({ type: 'info', message: 'hello' });
    store.addToast({ id: '1', title: 'Ping' });
    store.setUnreadCount(5);
    store.setHasAdminUnread(true);
    store.setActiveConvoId('abc');

    expect(store.state.banner).toEqual({ type: 'info', message: 'hello' });
    expect(store.state.messageToasts).toHaveLength(1);
    expect(store.state.unreadCount).toBe(5);
    expect(store.state.hasAdminUnread).toBe(true);
    expect(store.state.activeConvoId).toBe('abc');
  });
});

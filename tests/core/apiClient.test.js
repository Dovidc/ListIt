const path = require('path');

const distPath = path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.cjs');
// eslint-disable-next-line import/no-dynamic-require, global-require
const core = require(distPath);

const { createApiClient, formatCurrency, formatDistance, haversineMeters, ApiError } = core;

describe('formatting helpers', () => {
  test('formatCurrency formats USD values', () => {
    expect(formatCurrency(12.5)).toBe('$12.50');
    expect(formatCurrency(null)).toBe('$0.00');
  });

  test('formatDistance handles feet and miles', () => {
    expect(formatDistance(100)).toBe('328 ft');
    expect(formatDistance(1609.344 * 3)).toBe('3.0 mi');
  });

  test('haversineMeters returns reasonable distance', () => {
    const meters = haversineMeters(37.7749, -122.4194, 34.0522, -118.2437);
    expect(Math.round(meters / 1000)).toBe(559); // ~559 km between SF and LA
  });
});

describe('createApiClient', () => {
  const makeResponse = ({ status = 200, ok = true, body = '{}', jsonBody }) => ({
    status,
    ok,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(jsonBody ?? JSON.parse(body || '{}'))
  });

  test('notifies lifecycle hooks', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ body: '{"hello":"world"}' }));
    const start = jest.fn();
    const end = jest.fn();
    const api = createApiClient({ fetchImpl: fetchMock, onRequestStart: start, onRequestEnd: end });
    const result = await api.me();
    expect(result).toEqual({ hello: 'world' });
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  test('handles unauthorized responses', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ status: 401, ok: false, body: '' }));
    const onUnauthorized = jest.fn();
    const api = createApiClient({ fetchImpl: fetchMock, onUnauthorized });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test('handles account locked responses', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ status: 423, ok: false, jsonBody: { error: 'account_locked' } }));
    const onLocked = jest.fn();
    const api = createApiClient({ fetchImpl: fetchMock, onAccountLocked: onLocked });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  test('attaches bearer authorization when an auth token is present', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ body: 'null' }));
    const api = createApiClient({ fetchImpl: fetchMock, initialAuthToken: 'seed-token' });
    await api.me();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer seed-token');
  });

  test('captures auth tokens from login responses for subsequent requests', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeResponse({ body: '{"token":"fresh"}' }))
      .mockResolvedValueOnce(makeResponse({ body: 'null' }));
    const api = createApiClient({ fetchImpl: fetchMock });
    await api.login('user@example.com', 'password123');
    await api.me();
    const [, init] = fetchMock.mock.calls[1];
    expect(init.headers.Authorization).toBe('Bearer fresh');
  });

  test('clears auth token after unauthorized responses and logout', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeResponse({ status: 401, ok: false, body: '' }))
      .mockResolvedValueOnce(makeResponse({ body: '{"ok":true}' }))
      .mockResolvedValueOnce(makeResponse({ body: 'null' }));
    const onUnauthorized = jest.fn();
    const api = createApiClient({ fetchImpl: fetchMock, onUnauthorized, initialAuthToken: 'seed-token' });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    const [, firstInit] = fetchMock.mock.calls[0];
    expect(firstInit.headers.Authorization).toBe('Bearer seed-token');
    await api.logout();
    await api.me();
    const [, thirdInit] = fetchMock.mock.calls[2];
    expect(Object.keys(thirdInit.headers || {}).some((key) => key.toLowerCase() === 'authorization')).toBe(false);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test('silent meta skips lifecycle hooks', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ body: 'null' }));
    const start = jest.fn();
    const end = jest.fn();
    const api = createApiClient({ fetchImpl: fetchMock, onRequestStart: start, onRequestEnd: end });
    await api.me({ silent: true });
    expect(start).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });
});

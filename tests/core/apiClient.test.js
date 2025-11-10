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

  test('silent meta skips lifecycle hooks', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ body: 'null' }));
    const start = jest.fn();
    const end = jest.fn();
    const api = createApiClient({ fetchImpl: fetchMock, onRequestStart: start, onRequestEnd: end });
    await api.me({ silent: true });
    expect(start).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  test('prepareFetchInit customizes outgoing requests', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ body: 'null' }));
    const prepare = jest.fn((init) => {
      const headers = { ...(init.headers || {}) };
      headers.Authorization = 'Bearer prepared-token';
      return { ...init, headers };
    });
    const api = createApiClient({ fetchImpl: fetchMock, prepareFetchInit: prepare });
    await api.me();
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: 'include' }),
      {},
      expect.objectContaining({ getAuthToken: expect.any(Function), setAuthToken: expect.any(Function) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer prepared-token' }
      })
    );
  });

  test('tracks auth token lifecycle', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ body: '{"token":"abc123","ok":true}' }))
      .mockResolvedValueOnce(makeResponse({ status: 401, ok: false, body: '' }));
    const onTokenChange = jest.fn();
    const onUnauthorized = jest.fn();
    const api = createApiClient({
      fetchImpl: fetchMock,
      onTokenChange,
      onUnauthorized,
      initialAuthToken: ' initial '
    });

    expect(api.getAuthToken()).toBe('initial');
    expect(onTokenChange).toHaveBeenLastCalledWith('initial');

    await api.login('user@example.com', 'secret');
    expect(api.getAuthToken()).toBe('abc123');
    expect(onTokenChange).toHaveBeenLastCalledWith('abc123');

    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(api.getAuthToken()).toBeNull();
    expect(onTokenChange).toHaveBeenLastCalledWith(null);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test('exposes manual token controls', () => {
    const onTokenChange = jest.fn();
    const api = createApiClient({
      fetchImpl: jest.fn().mockResolvedValue(makeResponse({ body: 'null' })),
      onTokenChange
    });

    expect(api.getAuthToken()).toBeNull();
    api.setAuthToken('manual-token');
    expect(api.getAuthToken()).toBe('manual-token');
    expect(onTokenChange).toHaveBeenLastCalledWith('manual-token');

    api.setAuthToken(null);
    expect(api.getAuthToken()).toBeNull();
    expect(onTokenChange).toHaveBeenLastCalledWith(null);
  });
});

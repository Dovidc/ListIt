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

  test('stores and reuses bearer tokens from login responses', async () => {
    const loginResponse = makeResponse({ body: '{"token":"abc123","id":2}' });
    const meResponse = makeResponse({ body: '{"ok":true}' });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(loginResponse)
      .mockResolvedValueOnce(meResponse);

    const api = createApiClient({ fetchImpl: fetchMock });

    const loginResult = await api.login('user@test.com', 'secret');
    expect(loginResult).toEqual({ token: 'abc123', id: 2 });

    await api.me();

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer abc123' }),
      credentials: 'include'
    }));
  });
});

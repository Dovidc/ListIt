const request = require('supertest');

jest.mock('../../db-wrapper', () => {
  const mockStatement = () => ({
    get: jest.fn().mockResolvedValue(null),
    all: jest.fn().mockResolvedValue([]),
    run: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowid: null })
  });

  return {
    prepare: jest.fn(() => mockStatement()),
    exec: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn(async (callback) => callback({
      prepare: () => mockStatement(),
      exec: jest.fn().mockResolvedValue(undefined)
    })),
    close: jest.fn().mockResolvedValue(undefined)
  };
});

describe('reverse geocode route', () => {
  function loadAppWithFetch(mock) {
    jest.resetModules();
    global.fetch = mock;
    // eslint-disable-next-line global-require
    const app = require('../../server');
    return app;
  }

  afterEach(() => {
    delete global.fetch;
    jest.resetModules();
  });

  test('returns normalized result when primary provider succeeds', async () => {
    const fakeResponse = {
      ok: true,
      json: async () => ({
        display_name: 'Pittsburgh, Allegheny County, Pennsylvania, United States',
        address: {
          city: 'Pittsburgh',
          state: 'Pennsylvania',
          country_code: 'us'
        }
      })
    };

    const fetchMock = jest.fn().mockResolvedValue(fakeResponse);
    const app = loadAppWithFetch(fetchMock);

    const res = await request(app).get('/api/geo/reverse').query({ lat: 40.4369, lon: -79.9192 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      city: 'Pittsburgh',
      state: 'Pennsylvania',
      country: 'US',
      lat: 40.4369,
      lon: -79.9192
    });
    expect(res.body.display).toContain('Pittsburgh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('falls back to secondary provider when primary throws', async () => {
    const fallbackResponse = {
      ok: true,
      json: async () => ({
        display_name: 'Pittsburgh, Pennsylvania, United States',
        address: {
          city: 'Pittsburgh',
          state: 'Pennsylvania',
          country_code: 'us'
        }
      })
    };

    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(fallbackResponse);

    const app = loadAppWithFetch(fetchMock);

    const res = await request(app).get('/api/geo/reverse').query({ lat: 41.1, lon: -80.2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      city: 'Pittsburgh',
      state: 'Pennsylvania',
      country: 'US',
      lat: 41.1,
      lon: -80.2
    });
    expect(res.body.display).toContain('Pittsburgh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('uses tertiary provider when first two responses are unusable', async () => {
    const unusableResponse = {
      ok: true,
      json: async () => ({ foo: 'bar' })
    };

    const tertiaryResponse = {
      ok: true,
      json: async () => ({
        city: 'Pittsburgh',
        principalSubdivision: 'Pennsylvania',
        countryCode: 'US'
      })
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(unusableResponse)
      .mockResolvedValueOnce(unusableResponse)
      .mockResolvedValueOnce(tertiaryResponse);

    const app = loadAppWithFetch(fetchMock);

    const res = await request(app).get('/api/geo/reverse').query({ lat: 42.1, lon: -81.2 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      city: 'Pittsburgh',
      state: 'Pennsylvania',
      country: 'US',
      lat: 42.1,
      lon: -81.2
    });
    expect(res.body.display).toContain('Pittsburgh');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});


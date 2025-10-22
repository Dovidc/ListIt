const path = require('path');

describe('location helpers integration', () => {
  const locationHelpersPath = path.join(
    __dirname,
    '..',
    '..',
    'public',
    'app',
    'bootstrap',
    'location.js'
  );

  function loadFactory() {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(locationHelpersPath);
    return global.window.ListItApp.bootstrap.createLocationHelpers;
  }

  beforeEach(() => {
    jest.resetModules();
    global.window = { ListItApp: { bootstrap: {} } };
    global.navigator = {
      geolocation: {
        getCurrentPosition: jest.fn()
      }
    };
  });

  afterEach(() => {
    delete global.window;
    delete global.navigator;
  });

  test('fetchCoordsAndReverse resolves coordinates using browser geolocation and API reverse geocode', async () => {
    const getCurrentPosition = global.navigator.geolocation.getCurrentPosition;
    getCurrentPosition.mockImplementation((success, _error, options) => {
      success({ coords: { latitude: 12.34, longitude: 56.78 } });
      expect(options).toEqual(
        expect.objectContaining({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 60000
        })
      );
    });

    const api = {
      reverseGeocode: jest.fn().mockResolvedValue({
        lat: 98.76,
        lon: 54.32,
        display: 'Testopolis'
      })
    };

    const factory = loadFactory();
    const { fetchCoordsAndReverse } = factory({ api });

    const result = await fetchCoordsAndReverse();

    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.any(Object));
    expect(api.reverseGeocode).toHaveBeenCalledWith(12.34, 56.78);
    expect(result).toEqual({ lat: 98.76, lon: 54.32, display: 'Testopolis' });
  });

  test('fetchCoordsAndReverse prefers city and state for display when provided', async () => {
    const getCurrentPosition = global.navigator.geolocation.getCurrentPosition;
    getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 40.44, longitude: -79.94 } });
    });

    const api = {
      reverseGeocode: jest.fn().mockResolvedValue({
        lat: 40.44,
        lon: -79.94,
        display: '1806 Shady Avenue, Pittsburgh, Pennsylvania 15217, United States',
        city: 'Pittsburgh',
        state: 'PA',
        country: 'US'
      })
    };

    const factory = loadFactory();
    const { fetchCoordsAndReverse } = factory({ api });

    const result = await fetchCoordsAndReverse();

    expect(api.reverseGeocode).toHaveBeenCalledWith(40.44, -79.94);
    expect(result).toEqual({ lat: 40.44, lon: -79.94, display: 'Pittsburgh, PA' });
  });

  test('fetchCoordsAndReverse falls back to browser coordinates when API omits overrides', async () => {
    const getCurrentPosition = global.navigator.geolocation.getCurrentPosition;
    getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 10, longitude: 20 } });
    });

    const api = {
      reverseGeocode: jest.fn().mockResolvedValue({ display: 'Somewhere' })
    };

    const factory = loadFactory();
    const { fetchCoordsAndReverse } = factory({ api });

    const result = await fetchCoordsAndReverse();

    expect(api.reverseGeocode).toHaveBeenCalledWith(10, 20);
    expect(result).toEqual({ lat: 10, lon: 20, display: 'Somewhere' });
  });

  test('fetchCoordsAndReverse formats fallback display when API returns nothing', async () => {
    const getCurrentPosition = global.navigator.geolocation.getCurrentPosition;
    getCurrentPosition.mockImplementation((success) => {
      success({ coords: { latitude: 1, longitude: 2 } });
    });

    const api = {
      reverseGeocode: jest.fn().mockResolvedValue(null)
    };

    const factory = loadFactory();
    const { fetchCoordsAndReverse } = factory({ api });

    await expect(fetchCoordsAndReverse()).resolves.toEqual({
      lat: 1,
      lon: 2,
      display: '1.00000, 2.00000'
    });
  });

  test('fetchCoordsAndReverse rejects when geolocation fails', async () => {
    const error = new Error('denied');
    const getCurrentPosition = global.navigator.geolocation.getCurrentPosition;
    getCurrentPosition.mockImplementation((_success, failure) => {
      failure(error);
    });

    const api = {
      reverseGeocode: jest.fn()
    };

    const factory = loadFactory();
    const { fetchCoordsAndReverse } = factory({ api });

    await expect(fetchCoordsAndReverse()).rejects.toBe(error);
  });

  test('fetchCoordsAndReverse throws when geolocation is unavailable', async () => {
    delete global.navigator.geolocation;

    const api = {
      reverseGeocode: jest.fn()
    };

    const factory = loadFactory();
    const { fetchCoordsAndReverse } = factory({ api });

    await expect(fetchCoordsAndReverse()).rejects.toThrow('Geolocation not supported');
  });

  test('createLocationHelpers enforces API contract', () => {
    const factory = loadFactory();

    expect(() => factory()).toThrow('Location helpers require an API client with reverseGeocode.');
    expect(() => factory({ api: {} })).toThrow('Location helpers require an API client with reverseGeocode.');
  });
});
